/**
 * New Product Module — internal helpers for saveProductDetails.
 * Extracted from products-image.service.ts verbatim (no behaviour change).
 */

import { Prisma } from '../../lib/prisma';
import { downloadImage } from '../../lib/utils/image-download';
import { compressImage } from './products-image-compress';
import { logger } from './products-image.constants';
import type { TxClient } from './products.types';

// ---------------------------------------------------------------------------
// Helper: process image using pre-fetched upscaled URL (with fallback to local compression)
// ---------------------------------------------------------------------------

export async function processImageWithUpscaledUrl(
  originalUrl: string,
  upscaledUrl: string | null,
  log: ReturnType<typeof logger.child>,
): Promise<Buffer> {
  if (upscaledUrl) {
    log.info({ originalUrl, upscaledUrl }, 'Using upscaled URL from Dify');
    try {
      // Download the upscaled image from Dify, then normalise to white-BG JPEG.
      // Dify's upscale workflow can return PNG (sometimes with alpha) — without
      // this re-encode we'd write PNG bytes into a .jpg file and the saved image
      // would render with a transparent or black background even though the
      // user never clicked the bg-removal scissors. The bg-removed path is
      // handled separately upstream and skips this function entirely.
      const upscaledBuffer = await downloadImage(upscaledUrl);
      log.info({ upscaledUrl, bufferSize: upscaledBuffer.length }, 'Upscaled image downloaded successfully');
      const normalised = await compressImage(upscaledBuffer);
      return normalised;
    } catch (downloadErr) {
      log.warn({ upscaledUrl, error: downloadErr }, 'Failed to download upscaled image, falling back to local compression');
    }
  } else {
    log.info({ originalUrl }, 'No upscaled URL available, using local compression');
  }

  // Fallback: download original and compress locally
  log.info({ originalUrl }, 'Using local compression fallback');
  const originalBuffer = await downloadImage(originalUrl);
  const compressedBuffer = await compressImage(originalBuffer);
  log.info({ originalUrl, originalSize: originalBuffer.length, compressedSize: compressedBuffer.length }, 'Local compression completed');
  return compressedBuffer;
}

// ---------------------------------------------------------------------------
// Helper: resolve mapped products_id(s) from product_code
// Replicates PHP logic: LIKE '%code%' then filter exact match by splitting
// comma-separated products_model
// ---------------------------------------------------------------------------

export async function resolveMappedProductIds(
  tx: TxClient,
  productCode: string,
): Promise<number[]> {
  const rows = await tx.$queryRaw<Array<{ products_id: number; products_model: string }>>(
    Prisma.sql`
      SELECT products_id, products_model
      FROM new_products
      WHERE products_model LIKE CONCAT('%', ${productCode}, '%')
    `
  );

  const ids: number[] = [];
  for (const row of rows) {
    const model = (row.products_model ?? '').trim().replace(/^,|,$/g, '');
    const models = model.split(',').map((m) => m.trim());
    if (models.includes(productCode)) {
      ids.push(Number(row.products_id));
    }
  }

  return ids;
}
