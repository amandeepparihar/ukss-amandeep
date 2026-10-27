/**
 * New Product Module — saveProductDetails: download images, save to legacy SMS
 * disk paths, and update 4 DB tables (stock_home_grid_lists, product_lists,
 * products, new_products). Extracted from products-image.service.ts verbatim
 * (no behaviour change).
 */

import { prisma, Prisma } from '../../lib/prisma';
import { nanoid } from 'nanoid';
import { descriptionPlainToHtml } from '@admin/shared';
import { downloadImage } from '../../lib/utils/image-download';
import { upscaleImages } from './products-dify.service';
import { logger } from './products-image.constants';
import { compressImage } from './products-image-compress';
import { buildSeoSlug, buildImageFilename } from './products-image-naming';
import { deleteOldImage, saveImageToDisk, saveOriginalToDisk, pruneUnselectedUploads } from './products-image-disk';
import { processImageWithUpscaledUrl, resolveMappedProductIds } from './products-image-save-helpers';
import type { TxClient, SaveDetailsInput, SaveDetailsResult } from './products.types';

export async function saveProductDetails(
  data: SaveDetailsInput,
): Promise<SaveDetailsResult> {
  const executionId = nanoid(10);
  const log = logger.child({ executionId });

  const {
    productListsId,
    productCode,
    primaryImageUrl,
    backImageUrl,
    additionalImageUrls,
    descriptionNotes: descriptionNotesRaw,
    productAttributes,
    removeBackgroundForPrimary,
    removeBackgroundForBack,
    removeBackgroundImageUrls,
    manualCropForPrimary = false,
    manualCropForBack = false,
    manualCropImageUrls = [],
    manualCropOriginals = {},
    uploadedImageUrls,
  } = data;

  // Storefront + marketplace feeds expect HTML so paragraph/list structure
  // survives the .replace(/\s+/g, ' ') normalisation that adapters apply on
  // export. Wizard textarea works in plain text — convert at the boundary.
  // Idempotent: input that already looks like HTML is passed through unchanged.
  const descriptionNotes = descriptionPlainToHtml(descriptionNotesRaw);

  log.info({ productListsId, productCode, removeBackgroundForPrimary, removeBackgroundForBack, removeBackgroundImageUrls }, 'Starting saveProductDetails');

  const attributesJson = Object.keys(productAttributes).length > 0 ? JSON.stringify(productAttributes) : null;

  // Track background removal results
  const bgRemovalResults = {
    primaryRemoved: false,
    backRemoved: false,
    additionalRemoved: [] as string[],
    errors: [] as string[],
  };

  // 1. Fetch existing images + SEO slug inputs from product_lists.
  //    Single row trip covers re-save detection (existing image filenames)
  //    and the team/season/manufacturer/name strings used to build the
  //    on-disk SEO slug applied to every new image filename below.
  const existingRows = await prisma.$queryRaw<Array<{
    product_code_image: string | null;
    product_code_additional_img: string | null;
    product_name: string | null;
    team_name: string | null;
    season: string | null;
    manufacturer_name: string | null;
  }>>(
    Prisma.sql`
      SELECT
        pl.product_code_image,
        pl.product_code_additional_img,
        pl.product_name,
        t.team_name,
        s.season,
        m.manufacturers_name AS manufacturer_name
      FROM product_lists pl
      LEFT JOIN teams t ON pl.teams_id = t.teams_id
      LEFT JOIN seasons s ON pl.seasons_id = s.seasons_id
      LEFT JOIN manufacturers m ON pl.manufacturers_id = m.manufacturers_id
      WHERE pl.product_lists_id = ${productListsId}
      LIMIT 1
    `
  );

  const existingPrimary = existingRows[0]?.product_code_image ?? null;
  const existingAdditional = existingRows[0]?.product_code_additional_img ?? null;
  const hasExistingPrimary = !!existingPrimary && existingPrimary.length > 0;
  const hasExistingAdditional = !!existingAdditional && existingAdditional.length > 0;

  // Build SEO slug once per save so every image (primary, back, detail-N)
  // shares the same `{ts}_{slug}` prefix — matches the example URLs where
  // all three filenames carry the same timestamp and slug stem.
  const seoSlug = buildSeoSlug({
    teamName: existingRows[0]?.team_name ?? null,
    season: existingRows[0]?.season ?? null,
    manufacturerName: existingRows[0]?.manufacturer_name ?? null,
    productName: existingRows[0]?.product_name ?? null,
    productCode,
  });
  const saveTimestamp = Math.floor(Date.now() / 1000);
  log.info({ seoSlug, saveTimestamp }, 'Built SEO slug for image filenames');

  // 2. Collect all image URLs and call Dify upscale API once.
  // Bg-removed AND manually-cropped images (both data URIs) skip upscaling —
  // they're already final bytes and Dify doesn't accept data URIs anyway.
  const additionalBgRemovalSet = new Set(removeBackgroundImageUrls);
  const additionalManualCropSet = new Set(manualCropImageUrls);
  const allImageUrls: string[] = [];
  if (primaryImageUrl && !removeBackgroundForPrimary && !manualCropForPrimary) allImageUrls.push(primaryImageUrl);
  if (backImageUrl && !removeBackgroundForBack && !manualCropForBack) allImageUrls.push(backImageUrl);
  for (const url of additionalImageUrls) {
    if (!additionalBgRemovalSet.has(url) && !additionalManualCropSet.has(url)) allImageUrls.push(url);
  }

  log.info({ allImageUrls, count: allImageUrls.length }, 'Calling Dify upscale API for all images');
  const upscaledUrlsMap = await upscaleImages(allImageUrls);
  log.info({ upscaledCount: [...upscaledUrlsMap.values()].filter(Boolean).length }, 'Dify upscale API completed');

  // ---------------------------------------------------------------------------
  // PHASE 1: Download ALL images first (before deleting anything)
  // This ensures we don't lose old images if any download fails
  // ---------------------------------------------------------------------------

  interface DownloadedImage {
    buffer: Buffer;
    filename: string;
    url: string;
    isPrimary: boolean;
    isBack: boolean;
    index: number;
    needsBgRemoval: boolean;
    isManualCrop: boolean;
  }

  // Build download tasks upfront so all fetches run in parallel (wall-clock
  // latency is the slowest download, not the sum of all downloads).
  interface DownloadTask {
    url: string;
    isBgRemoved: boolean;
    isManualCrop: boolean;
    filename: string;
    isPrimary: boolean;
    isBack: boolean;
    index: number;
  }

  const downloadTasks: DownloadTask[] = [];
  let primaryFilename: string | null = null;
  let backFilename: string | null = null;
  const additionalFilenames: string[] = [];

  if (primaryImageUrl) {
    const ext = removeBackgroundForPrimary ? 'png' : 'jpg';
    const filename = buildImageFilename({
      slug: seoSlug,
      role: 'primary',
      extension: ext,
      timestamp: saveTimestamp,
      isResave: hasExistingPrimary,
    });
    primaryFilename = filename;
    downloadTasks.push({ url: primaryImageUrl, isBgRemoved: removeBackgroundForPrimary, isManualCrop: manualCropForPrimary, filename, isPrimary: true, isBack: false, index: 0 });
  }

  if (backImageUrl) {
    const ext = removeBackgroundForBack ? 'png' : 'jpg';
    const filename = buildImageFilename({
      slug: seoSlug,
      role: 'back',
      extension: ext,
      timestamp: saveTimestamp,
      isResave: hasExistingAdditional,
    });
    backFilename = filename;
    downloadTasks.push({ url: backImageUrl, isBgRemoved: removeBackgroundForBack, isManualCrop: manualCropForBack, filename, isPrimary: false, isBack: true, index: 0 });
  }

  for (let i = 0; i < additionalImageUrls.length; i++) {
    const url = additionalImageUrls[i];
    const isBgRemoved = additionalBgRemovalSet.has(url);
    const isManualCrop = additionalManualCropSet.has(url);
    const ext = isBgRemoved ? 'png' : 'jpg';
    const filename = buildImageFilename({
      slug: seoSlug,
      role: 'detail',
      detailIndex: i + 1,
      extension: ext,
      timestamp: saveTimestamp,
      isResave: hasExistingAdditional,
    });
    additionalFilenames.push(filename);
    downloadTasks.push({ url, isBgRemoved, isManualCrop, filename, isPrimary: false, isBack: false, index: i + 1 });
  }

  log.info({ taskCount: downloadTasks.length }, 'Downloading all images in parallel');

  const downloadedImages: DownloadedImage[] = await Promise.all(
    downloadTasks.map(async (task): Promise<DownloadedImage> => {
      let buffer: Buffer;
      if (task.isBgRemoved) {
        // Bg-removed data URI: already a final transparent PNG. Save raw (bg
        // wins over crop for extension/alpha — a bg-removed image never runs
        // through compressImage). See spec §4 interaction note.
        buffer = await downloadImage(task.url);
      } else if (task.isManualCrop) {
        // Manually-cropped data URI: the user's framing is final — decode the
        // bytes and normalise to 1080 JPEG WITHOUT auto-trim/re-frame.
        const raw = await downloadImage(task.url);
        buffer = await compressImage(raw, { skipTrim: true });
      } else {
        buffer = await processImageWithUpscaledUrl(task.url, upscaledUrlsMap.get(task.url) ?? null, log);
      }
      log.info({ filename: task.filename, bufferSize: buffer.length, isPrimary: task.isPrimary, isBack: task.isBack, isManualCrop: task.isManualCrop }, 'Image downloaded');
      return { buffer, filename: task.filename, url: task.url, isPrimary: task.isPrimary, isBack: task.isBack, index: task.index, needsBgRemoval: task.isBgRemoved, isManualCrop: task.isManualCrop };
    }),
  );

  log.info({ downloadedCount: downloadedImages.length }, 'All images downloaded successfully, proceeding to delete old images');

  // ---------------------------------------------------------------------------
  // PHASE 2: Delete old images (only after ALL downloads succeeded)
  // ---------------------------------------------------------------------------

  if (primaryImageUrl && hasExistingPrimary) {
    log.info({ existingPrimary }, 'Deleting old primary image');
    await deleteOldImage(existingPrimary!, true);
  }

  if (hasExistingAdditional) {
    const oldFiles = existingAdditional!.split(',').map((f) => f.trim()).filter(Boolean);
    log.info({ oldFiles, count: oldFiles.length }, 'Deleting old additional images');
    for (const oldFile of oldFiles) {
      await deleteOldImage(oldFile, false);
    }
  }

  // ---------------------------------------------------------------------------
  // PHASE 3: Save new images to disk
  // ---------------------------------------------------------------------------

  for (const img of downloadedImages) {
    log.info({ filename: img.filename, isPrimary: img.isPrimary, isBack: img.isBack }, 'Saving image to disk');
    await saveImageToDisk(img.buffer, img.filename, img.isPrimary);
  }

  // ---------------------------------------------------------------------------
  // PHASE 3b: Persist un-cropped originals for manual crops (see spec §6)
  // ---------------------------------------------------------------------------
  // For each manually-cropped image, write its pre-crop source byte-for-byte
  // under originals/<final-filename> so a later re-crop starts from full
  // resolution. The pre-crop source is provided by the frontend in
  // manualCropOriginals (cropped data URI → pre-crop source URL). Missing
  // entries are non-fatal — re-crop then falls back to the CDN derivative.
  const manualCropFilenames: string[] = [];
  for (const img of downloadedImages) {
    if (!img.isManualCrop) continue;
    manualCropFilenames.push(img.filename);
    const originalSource = manualCropOriginals[img.url];
    if (!originalSource) {
      log.warn({ filename: img.filename }, 'Manual crop has no pre-crop source — skipping original persistence');
      continue;
    }
    try {
      const originalBytes = await downloadImage(originalSource);
      await saveOriginalToDisk(originalBytes, img.filename);
      log.info({ filename: img.filename, bytes: originalBytes.length }, 'Persisted crop original');
    } catch (err) {
      log.warn({ filename: img.filename, error: err }, 'Failed to persist crop original — re-crop will use derivative');
    }
  }

  // ---------------------------------------------------------------------------
  // PHASE 4: Background removal accounting
  // ---------------------------------------------------------------------------
  // Bg removal now happens at click-time on the frontend (see
  // products-background.service#removeBackgroundFromUrl + the /remove-background
  // route). By the time we get here the bytes are already a transparent PNG and
  // the filename ends in .png — no further work needed beyond bookkeeping for
  // the response payload.

  for (const img of downloadedImages) {
    if (!img.needsBgRemoval) continue;
    if (img.isPrimary) bgRemovalResults.primaryRemoved = true;
    else if (img.isBack) bgRemovalResults.backRemoved = true;
    else bgRemovalResults.additionalRemoved.push(img.url);
  }

  // 5. Build the comma-separated additional images string (back image + additional images)
  const allAdditionalFilenames = backFilename
    ? [backFilename, ...additionalFilenames]
    : additionalFilenames;
  const additionalImagesStr = allAdditionalFilenames.join(',');

  // 5. Update database tables within a transaction
  await prisma.$transaction(async (tx: TxClient) => {
    // --- Tables 1 & 2: matched by product_code ---

    // Build update fields dynamically (only set columns that have data)
    if (primaryFilename || additionalImagesStr || descriptionNotes || attributesJson) {
      // UPDATE stock_home_grid_lists
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE stock_home_grid_lists
          SET
            product_code_image = CASE WHEN ${primaryFilename} IS NOT NULL THEN ${primaryFilename} ELSE product_code_image END,
            product_code_additional_img = CASE WHEN ${additionalImagesStr} != '' THEN ${additionalImagesStr} ELSE product_code_additional_img END,
            description_notes = CASE WHEN ${descriptionNotes} != '' THEN ${descriptionNotes} ELSE description_notes END
          WHERE product_code = ${productCode}
        `
      );

      // UPDATE product_lists
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE product_lists
          SET
            product_code_image = CASE WHEN ${primaryFilename} IS NOT NULL THEN ${primaryFilename} ELSE product_code_image END,
            product_code_additional_img = CASE WHEN ${additionalImagesStr} != '' THEN ${additionalImagesStr} ELSE product_code_additional_img END,
            product_code_back_img = CASE WHEN ${backFilename} != '' THEN ${backFilename} ELSE product_code_back_img END,
            description_notes = CASE WHEN ${descriptionNotes} != '' THEN ${descriptionNotes} ELSE description_notes END,
            products_attributes = CASE WHEN ${attributesJson} IS NOT NULL THEN ${attributesJson} ELSE products_attributes END
          WHERE product_code = ${productCode}
        `
      );
    }

    // --- Tables 3 & 4: matched by products_id ---
    const mappedIds = await resolveMappedProductIds(tx, productCode);

    if (mappedIds.length > 0 && (primaryFilename || additionalImagesStr || descriptionNotes)) {
      // UPDATE products
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE products
          SET
            products_image = CASE WHEN ${primaryFilename} IS NOT NULL THEN ${primaryFilename} ELSE products_image END,
            additional_img = CASE WHEN ${additionalImagesStr} != '' THEN ${additionalImagesStr} ELSE additional_img END
          WHERE products_id IN (${Prisma.join(mappedIds)})
        `
      );

      // UPDATE new_products
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE new_products
          SET
            products_image = CASE WHEN ${primaryFilename} IS NOT NULL THEN ${primaryFilename} ELSE products_image END,
            additional_img = CASE WHEN ${additionalImagesStr} != '' THEN ${additionalImagesStr} ELSE additional_img END,
            products_description = CASE WHEN ${descriptionNotes} != '' THEN ${descriptionNotes} ELSE products_description END
          WHERE products_id IN (${Prisma.join(mappedIds)})
        `
      );
    }
  }, { timeout: 30_000 });

  // Prune any user-upload that didn't get selected at save time. Save Details
  // has already downloaded + recompressed the selected uploads under product-
  // coded filenames, but per spec the literal request is "delete unselected"
  // — so selected uploads are kept on disk as-is, unselected ones are deleted.
  if (uploadedImageUrls && uploadedImageUrls.length > 0) {
    const selectedUrls = [
      primaryImageUrl,
      backImageUrl,
      ...additionalImageUrls,
    ];
    const { deletedFilenames } = await pruneUnselectedUploads(
      uploadedImageUrls,
      selectedUrls,
      log,
    );
    log.info({ deletedFilenames, total: uploadedImageUrls.length }, 'Pruned unselected uploads');
  }

  log.info({
    productListsId,
    productCode,
    primaryImage: primaryFilename,
    backImage: backFilename,
    additionalImagesCount: additionalFilenames.length,
    bgRemovalResults,
  }, 'saveProductDetails completed successfully');

  return {
    success: true,
    primaryImage: primaryFilename,
    backImage: backFilename,
    additionalImages: additionalFilenames,
    descriptionSaved: descriptionNotes.length > 0,
    attributesSaved: attributesJson !== null,
    backgroundRemovalResults: bgRemovalResults,
    manualCropFilenames,
  };
}
