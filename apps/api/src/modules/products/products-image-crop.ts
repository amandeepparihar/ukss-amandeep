/**
 * New Product Module — manual crop + crop-source resolution.
 * Extracted from products-image.service.ts verbatim (no behaviour change).
 */

import * as fs from 'fs/promises';
import sharp from 'sharp';
import { ApiError } from '../../lib/errors';
import { downloadImage } from '../../lib/utils/image-download';
import { IMAGE_WIDTH, IMAGE_HEIGHT, JPEG_QUALITY, IMAGE_WHITE } from './products-image.constants';
import { originalPathForSavedUrl } from './products-image-disk';

// ---------------------------------------------------------------------------
// Manual crop (see spec §3, §4) — the frontend only collects a square crop
// rectangle in the source image's natural pixels; the server does the pixel
// work with sharp (tiles come from CDNs, so a browser <canvas> would taint on
// CORS). Mirrors the click-time remove-bg pattern.
// ---------------------------------------------------------------------------

export interface CropImageResult {
  croppedUrl: string; // data URI
  elapsedMs: number;
}

export async function cropImageFromUrl(input: {
  imageUrl: string;
  crop: { left: number; top: number; width: number; height: number };
}): Promise<CropImageResult> {
  const start = Date.now();

  // 1. Load source bytes — downloadImage handles both http(s) and data: URIs.
  const source = await downloadImage(input.imageUrl);

  // 2. CLAMP the crop rect against the real image bounds — never trust client
  //    coordinates. If clamping breaks the square, shrink to the smaller side
  //    so the output stays distortion-free.
  const meta = await sharp(source).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (!imgW || !imgH) {
    throw new ApiError(400, 'INVALID_IMAGE', 'Could not read source image dimensions');
  }
  const left = Math.max(0, Math.min(Math.round(input.crop.left), imgW - 1));
  const top = Math.max(0, Math.min(Math.round(input.crop.top), imgH - 1));
  let size = Math.round(Math.min(input.crop.width, input.crop.height));
  size = Math.min(size, imgW - left, imgH - top);
  if (size < 1) {
    throw new ApiError(400, 'INVALID_CROP', 'Crop rectangle is out of image bounds');
  }

  // 3. Extract the square + resize to 1080 (square in → fit:'fill' is exact).
  const pipeline = sharp(source)
    .extract({ left, top, width: size, height: size })
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'fill' });

  // 4. Keep alpha for bg-removed sources (PNG); otherwise flatten to white JPEG.
  if (meta.hasAlpha === true) {
    const png = await pipeline.png().toBuffer();
    return { croppedUrl: `data:image/png;base64,${png.toString('base64')}`, elapsedMs: Date.now() - start };
  }
  const jpg = await pipeline
    .flatten({ background: IMAGE_WHITE })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { croppedUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`, elapsedMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Crop source resolution (see spec §4) — when re-cropping a SAVED product, the
// crop dialog should display the persisted full-resolution original (if one
// exists) so react-easy-crop's coordinates are in the original's pixel space
// and the resulting crop keeps full quality. Returns null when there is no
// original on disk (pre-feature image / never cropped) → the caller falls back
// to displaying the CDN derivative.
// ---------------------------------------------------------------------------

export interface CropSourceResult {
  sourceUrl: string | null; // data URI of the persisted original, or null
  width: number | null;
  height: number | null;
}

export async function resolveCropSource(imageUrl: string): Promise<CropSourceResult> {
  const originalPath = await originalPathForSavedUrl(imageUrl);
  if (!originalPath) return { sourceUrl: null, width: null, height: null };
  const buffer = await fs.readFile(originalPath);
  const meta = await sharp(buffer).metadata();
  const mime =
    meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg';
  return {
    sourceUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}
