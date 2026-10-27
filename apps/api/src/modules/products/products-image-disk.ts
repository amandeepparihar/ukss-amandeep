/**
 * New Product Module — disk I/O + CDN-URL helpers for saved product images.
 * Extracted from products-image.service.ts verbatim (no behaviour change).
 *
 * Disk layout (relative to IMAGES_BASE_DIR):
 *   Primary:    <IMAGES_BASE_DIR>/<filename>
 *   Additional: <IMAGES_BASE_DIR>/adtnl_prodts_img/<filename>
 *   Originals:  <IMAGES_BASE_DIR>/originals/<final-filename>
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from '../../config';
import { ApiError } from '../../lib/errors';
import { compressImage } from './products-image-compress';
import {
  logger,
  IMAGES_BASE_DIR,
  ORIGINALS_SUBDIR,
  UPLOAD_PREFIX,
} from './products-image.constants';

// ---------------------------------------------------------------------------
// Helper: save image buffer to disk
// ---------------------------------------------------------------------------

export async function saveImageToDisk(
  buffer: Buffer,
  filename: string,
  isPrimary: boolean,
): Promise<void> {
  const targetDir = isPrimary
    ? IMAGES_BASE_DIR
    : path.join(IMAGES_BASE_DIR, 'adtnl_prodts_img');

  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, filename);
  await fs.writeFile(filePath, buffer);
}

// ---------------------------------------------------------------------------
// Original persistence (manual crop) — see spec §6.
//
// When an image is manually cropped, its un-cropped source is written
// byte-for-byte under a single flat `originals/` directory keyed by the
// image's FINAL filename (which is already unique across primary + additional).
// A later re-crop starts from this full-resolution original instead of the
// 1080 derivative. No DB column — the path is deterministic.
// ---------------------------------------------------------------------------

/** Write the un-cropped original bytes for a saved image. Not compressed or
 *  trimmed — byte-for-byte fidelity is the whole point. */
export async function saveOriginalToDisk(buffer: Buffer, finalFilename: string): Promise<void> {
  const dir = path.join(IMAGES_BASE_DIR, ORIGINALS_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, finalFilename), buffer);
}

/** Remove a persisted original when its derivative is replaced/deleted. */
async function deleteOriginal(finalFilename: string): Promise<void> {
  if (!finalFilename) return;
  try {
    await fs.unlink(path.join(IMAGES_BASE_DIR, ORIGINALS_SUBDIR, finalFilename));
  } catch {
    // File may not exist (pre-feature image, or never cropped) — ignore.
  }
}

/**
 * Extract the bare on-disk filename from a saved-product CDN URL — primary
 * (`/images/<file>`) or additional (`/images/adtnl_prodts_img/<file>`).
 * Guards path traversal exactly like `uploadFilenameFromUrl`. Returns null for
 * unrecognised URLs so callers never touch a path they don't control.
 */
function savedImageFilenameFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const adtnlMarker = '/images/adtnl_prodts_img/';
    const imgMarker = '/images/';
    let filename: string;
    const adtnlIdx = pathname.indexOf(adtnlMarker);
    if (adtnlIdx !== -1) {
      // Check adtnl first — `/images/` is a prefix of it and would mis-match.
      filename = pathname.slice(adtnlIdx + adtnlMarker.length);
    } else {
      const imgIdx = pathname.indexOf(imgMarker);
      if (imgIdx === -1) return null;
      filename = pathname.slice(imgIdx + imgMarker.length);
    }
    if (!filename || filename.includes('/') || filename.includes('..')) return null;
    return filename;
  } catch {
    return null;
  }
}

/**
 * Given a saved-product CDN URL, return the on-disk path of its persisted
 * original if one exists (only images cropped after this feature shipped have
 * one). Null when there is no original — callers fall back to the derivative.
 */
export async function originalPathForSavedUrl(url: string): Promise<string | null> {
  const filename = savedImageFilenameFromUrl(url);
  if (!filename) return null;
  const originalPath = path.join(IMAGES_BASE_DIR, ORIGINALS_SUBDIR, filename);
  try {
    await fs.access(originalPath);
    return originalPath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: delete old image file if it exists
// ---------------------------------------------------------------------------

export async function deleteOldImage(filename: string, isPrimary: boolean): Promise<void> {
  if (!filename) return;
  const filePath = isPrimary
    ? path.join(IMAGES_BASE_DIR, filename)
    : path.join(IMAGES_BASE_DIR, 'adtnl_prodts_img', filename);

  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — ignore
  }

  // Also drop any persisted crop-original for this filename (ignore ENOENT).
  await deleteOriginal(filename);
}

// ---------------------------------------------------------------------------
// Helper: persist a user-uploaded image into the same directory the product
// save flow writes to. Used by POST /api/products/upload-image so the upload
// shows up at a real product CDN URL (not a generic /uploads/ path) and so
// saveProductDetails can delete unselected uploads at finalisation.
//
// The file is compressed to 1080x1080 JPEG to match every other tile that
// ends up in `adtnl_prodts_img/`. The filename is `upload_<ts>_<basename>.jpg`
// so cleanup logic can identify upload-orphans defensively (we never want to
// delete an image that belongs to a saved product).
// ---------------------------------------------------------------------------

export async function persistUploadedImage(
  buffer: Buffer,
  originalFilename: string,
): Promise<{ filename: string; url: string }> {
  const compressed = await compressImage(buffer);

  // Sanitize: strip path components, force .jpg, drop characters that don't
  // play nicely on filesystems / URLs.
  const baseRaw = path.basename(originalFilename || 'upload.jpg').replace(/\.\w+$/, '');
  const sanitized = (baseRaw || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filename = `${UPLOAD_PREFIX}${Math.floor(Date.now() / 1000)}_${sanitized}.jpg`;

  await saveImageToDisk(compressed, filename, false);
  const url = resolveSavedProductImageUrl(filename, false);
  if (!url) {
    // resolveSavedProductImageUrl only returns null for empty filenames —
    // unreachable here, but guard so callers always get a string.
    throw new ApiError(500, 'UPLOAD_URL_RESOLVE_FAILED', 'Could not resolve uploaded image URL');
  }
  return { filename, url };
}

/**
 * Map a CDN URL produced by `persistUploadedImage` (or any other write into
 * `adtnl_prodts_img/`) back to its on-disk filename. Returns null when the
 * URL is not a recognised CDN path — defensive so we never `unlink()` a path
 * we don't fully control.
 */
function uploadFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const marker = '/images/adtnl_prodts_img/';
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;
    const filename = pathname.slice(idx + marker.length);
    // Disallow path traversal segments & insist on the upload prefix so we
    // can never accidentally remove a non-upload tile (e.g. a Saved image
    // the user marked then unmarked, which would also be in this directory).
    if (!filename || filename.includes('/') || filename.includes('..')) return null;
    if (!filename.startsWith(UPLOAD_PREFIX)) return null;
    return filename;
  } catch {
    return null;
  }
}

/**
 * After Save Details writes the product images, delete any user-uploaded
 * images that the user did NOT select (not primary, not back, not in the
 * additional list). Selected uploads are kept on disk — Save Details has
 * downloaded + recompressed them under product-coded filenames, but the
 * literal user request is "delete unselected".
 */
export async function pruneUnselectedUploads(
  uploadedImageUrls: string[],
  selectedUrls: ReadonlyArray<string | null | undefined>,
  log: ReturnType<typeof logger.child>,
): Promise<{ deletedFilenames: string[] }> {
  const selectedSet = new Set(
    selectedUrls.filter((u): u is string => !!u && u.length > 0),
  );
  const deletedFilenames: string[] = [];
  for (const url of uploadedImageUrls) {
    if (selectedSet.has(url)) continue;
    const filename = uploadFilenameFromUrl(url);
    if (!filename) {
      log.warn({ url }, 'Skipping prune: URL does not match upload pattern');
      continue;
    }
    try {
      await fs.unlink(path.join(IMAGES_BASE_DIR, 'adtnl_prodts_img', filename));
      deletedFilenames.push(filename);
    } catch {
      // File may already be gone — ignore.
    }
  }
  return { deletedFilenames };
}

// ---------------------------------------------------------------------------
// Helper: resolve a saved image filename to its CDN URL
// ---------------------------------------------------------------------------

/**
 * Mirror of `saveImageToDisk` for the read path: turn a bare filename from
 * `product_lists.product_code_image` / `product_code_additional_img` into a
 * full CDN URL. Primary images live at `${cdn}/images/<filename>`; additional
 * images live at `${cdn}/images/adtnl_prodts_img/<filename>`. The two paths
 * deliberately match the directory layout used at write time.
 *
 * Reused by the wizard pre-population flow and any future endpoint that needs
 * to surface a saved product image to the browser.
 */
export function resolveSavedProductImageUrl(
  filename: string | null | undefined,
  isPrimary: boolean,
): string | null {
  if (!filename || filename.length === 0) return null;
  const cdn = config.PRODUCT_FEED_CDN_URL.replace(/\/$/, '');
  return isPrimary
    ? `${cdn}/images/${filename}`
    : `${cdn}/images/adtnl_prodts_img/${filename}`;
}
