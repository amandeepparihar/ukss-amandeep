/**
 * New Product Module — Image & details save service (barrel).
 *
 * The implementation was split across sibling files purely to keep each file
 * small (no behaviour change). This barrel re-exports the public surface so
 * existing import sites (products routes, replicate service, lookup service)
 * keep working unchanged.
 *
 *   products-image.constants.ts     — shared constants + logger
 *   products-image-compress.ts      — compressImage
 *   products-image-crop.ts          — cropImageFromUrl, resolveCropSource
 *   products-image-naming.ts        — buildSeoSlug, buildImageFilename
 *   products-image-disk.ts          — disk I/O + CDN-URL helpers, persistUploadedImage
 *   products-image-save-helpers.ts  — processImageWithUpscaledUrl, resolveMappedProductIds
 *   products-image-save.ts          — saveProductDetails
 */

import { downloadImage } from '../../lib/utils/image-download';

// Re-export the shared helper so callers that previously imported it from
// this module (e.g. products-replicate.service.ts) keep working without
// changing every import site.
export { downloadImage };

export { compressImage } from './products-image-compress';
export {
  cropImageFromUrl,
  resolveCropSource,
  type CropImageResult,
  type CropSourceResult,
} from './products-image-crop';
export { buildSeoSlug } from './products-image-naming';
export {
  persistUploadedImage,
  pruneUnselectedUploads,
  resolveSavedProductImageUrl,
  originalPathForSavedUrl,
} from './products-image-disk';
export { saveProductDetails } from './products-image-save';
