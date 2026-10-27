/**
 * New Product Module — Dify AI, upload, enhance, background-removal, crop, and
 * save-details route definitions. Split out of products.routes.ts verbatim (no
 * behaviour change); registered as a sub-plugin so it inherits the parent's
 * `/api/products` prefix + decorators.
 *
 * Requirements: REQ-5 (save details), plus image-processing endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  generateImagesSchema,
  generateDescriptionSchema,
  saveDetailsSchema,
  enhanceImageSchema,
  removeBackgroundSchema,
  cropImageSchema,
  cropSourceSchema,
} from './products.schema';
import { generateImages, generateDescription } from './products-dify.service';
import { uploadFileToDify, DifyError } from '../../lib/dify';
import { config } from '../../config';
import { ApiError } from '../../lib/errors';
import { enhanceImage } from './products-replicate.service';
import { removeBackgroundFromUrl } from './products-background.service';
import { saveProductDetails, persistUploadedImage, cropImageFromUrl, resolveCropSource } from './products-image.service';
import { resolvePhpAdminId } from '../orders/orders.helpers';
import { prisma } from '../../lib/prisma';

// Write an audit-log entry. Mirrors the helper in jobs.routes.ts — the products
// module previously wrote none. `userId` is the Stock2 user id (JWT `sub`).
async function logProductAudit(
  userId: string,
  action: string,
  resourceId: string,
  newValues: unknown,
  request: { ip: string; headers: Record<string, unknown> },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      resource: 'product',
      resourceId,
      newValues: newValues as object,
      metadata: { ip: request.ip, userAgent: request.headers['user-agent'] },
    },
  });
}

export const productImageRoutes: FastifyPluginAsync = async (app) => {

  // =========================================================================
  // Dify AI workflows — Step 3 (Images) & Step 4 (Description)
  // =========================================================================

  // POST /api/products/dify/images
  app.post('/dify/images', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const data = generateImagesSchema.parse(request.body);
    const smsUserId = await resolvePhpAdminId(request.cookies);
    const result = await generateImages(data, smsUserId);
    return { data: result };
  });

  // POST /api/products/dify/description
  app.post('/dify/description', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const data = generateDescriptionSchema.parse(request.body);
    const smsUserId = await resolvePhpAdminId(request.cookies);
    const result = await generateDescription(data, smsUserId);
    return { data: result };
  });

  // POST /api/products/dify/upload-image — multipart upload of a local image
  // file as a reference for the Enhance Description vision flow. Returns a
  // Dify upload_file_id that the frontend then echoes back in the next
  // /dify/description call inside the `images` array as { uploadFileId }.
  // 5MB cap; image MIME types only (jpeg/png/webp/gif).
  const ALLOWED_UPLOAD_MIMES = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  ]);
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  app.post('/dify/upload-image', {
    preHandler: [app.authenticate],
  }, async (request) => {
    if (!config.DIFY_DESCRIPTION_API_KEY) {
      throw new ApiError(400, 'DIFY_NOT_CONFIGURED', 'Dify Description workflow is not configured');
    }
    const file = await request.file();
    if (!file) {
      throw new ApiError(400, 'NO_FILE', 'No file uploaded (expected multipart field "file")');
    }
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype.toLowerCase())) {
      throw new ApiError(400, 'INVALID_MIME', `Unsupported image type: ${file.mimetype}. Allowed: jpeg, png, webp, gif`);
    }
    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiError(400, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
    }
    const smsUserId = await resolvePhpAdminId(request.cookies);
    try {
      const uploaded = await uploadFileToDify(
        config.DIFY_DESCRIPTION_API_KEY,
        buffer,
        file.filename,
        file.mimetype,
        `sms-user-${smsUserId}`,
      );
      return { data: { uploadFileId: uploaded.id, name: uploaded.name, size: uploaded.size } };
    } catch (err) {
      if (err instanceof DifyError) {
        throw new ApiError(err.statusCode, 'DIFY_ERROR', err.message);
      }
      throw err;
    }
  });

  // POST /api/products/upload-image — multipart upload of a user-supplied
  // product image. Compressed to 1080×1080 JPEG and saved into the same
  // directory the Save Details flow writes to (`<IMAGES_BASE_DIR>/adtnl_prodts_img/`),
  // with an `upload_` filename prefix so we can identify and prune unselected
  // uploads at Save Details time. Returns a CDN URL the frontend renders
  // directly as a gallery tile.
  // Distinct from /dify/upload-image — that one goes to Dify ephemeral
  // storage and is only useful as a vision-LLM input.
  app.post('/upload-image', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const file = await request.file();
    if (!file) {
      throw new ApiError(400, 'NO_FILE', 'No file uploaded (expected multipart field "file")');
    }
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype.toLowerCase())) {
      throw new ApiError(400, 'INVALID_MIME', `Unsupported image type: ${file.mimetype}. Allowed: jpeg, png, webp, gif`);
    }
    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiError(400, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
    }
    const { filename, url } = await persistUploadedImage(buffer, file.filename);
    return { data: { url, filename, size: buffer.byteLength } };
  });

  // =========================================================================
  // Replicate per-image enhance — Real-ESRGAN upscale
  // =========================================================================

  // POST /api/products/replicate/enhance-image
  app.post('/replicate/enhance-image', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const data = enhanceImageSchema.parse(request.body);
    const result = await enhanceImage(data);
    return { data: result };
  });

  // =========================================================================
  // remove.bg per-image background removal (click-time, returns data URI)
  // =========================================================================

  // POST /api/products/remove-background
  app.post('/remove-background', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { imageUrl } = removeBackgroundSchema.parse(request.body);
    const result = await removeBackgroundFromUrl(imageUrl);
    return { data: result };
  });

  // =========================================================================
  // Manual crop (click-time, returns a 1080x1080 data URI) — see spec §3, §4
  // =========================================================================

  // POST /api/products/crop-image
  // bodyLimit raised: the request may carry a full-resolution original as a
  // base64 data URI in `imageUrl` (re-crop of a saved product), matching the
  // save-details limit below.
  app.post('/crop-image', {
    preHandler: [app.authenticate],
    bodyLimit: 32 * 1024 * 1024,
  }, async (request) => {
    const input = cropImageSchema.parse(request.body);
    const result = await cropImageFromUrl(input);
    return { data: result };
  });

  // GET /api/products/crop-source?imageUrl=...
  // Resolves a saved-product CDN URL to its persisted un-cropped original (as a
  // data URI) so the crop dialog can re-crop from full resolution. Returns
  // { sourceUrl: null } when no original exists (pre-feature / never cropped).
  app.get('/crop-source', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { imageUrl } = cropSourceSchema.parse(request.query);
    const result = await resolveCropSource(imageUrl);
    return { data: result };
  });

  // =========================================================================
  // Save Details — Images + Description (REQ-5)
  // =========================================================================

  // POST /api/products/save-details
  // bodyLimit raised from Fastify's 1 MB default: bg-removed images are sent
  // as base64 data URIs (~1.5–2 MB each at 1080×1080 PNG with transparency),
  // and the payload may include up to ~10 of them.
  app.post('/save-details', {
    preHandler: [app.requirePermission('products:create')],
    bodyLimit: 32 * 1024 * 1024,
  }, async (request) => {
    const data = saveDetailsSchema.parse(request.body);
    const result = await saveProductDetails(data);

    // Audit: record who manually cropped images (spec §7). One entry per save
    // that included at least one manual crop. request.user.sub is the Stock2
    // user id set by app.authenticate (JWT payload). Non-fatal on failure.
    const croppedFilenames = result.manualCropFilenames ?? [];
    if (croppedFilenames.length > 0) {
      try {
        await logProductAudit(
          request.user.sub,
          'crop-image',
          data.productCode,
          { productListsId: data.productListsId, croppedImages: croppedFilenames },
          { ip: request.ip, headers: request.headers as Record<string, unknown> },
        );
      } catch (err) {
        request.log.warn({ err }, 'Failed to write crop-image audit log');
      }
    }

    return { data: result };
  });
};
