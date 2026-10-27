/**
 * New Product Module — shared constants + logger for the image/save services.
 * Extracted from products-image.service.ts verbatim (no behaviour change) so
 * the split image modules share a single source of truth.
 */

import * as path from 'path';
import { config } from '../../config';
import { createLogger } from '../../lib/logger';

export const logger = createLogger('products-image');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1080;
export const JPEG_QUALITY = 90;

// White padding kept around the product after trimming, on every side (px).
// The product is fitted into an INNER x INNER box, then an even MARGIN is
// extended out to the full 1080x1080 canvas — so the border is uniform instead
// of whatever random amount the source image happened to carry.
export const IMAGE_WHITE = { r: 255, g: 255, b: 255 } as const;
export const IMAGE_MARGIN = 40;
export const IMAGE_INNER = IMAGE_WIDTH - IMAGE_MARGIN * 2; // 1000
// Trim sensitivity for surrounding whitespace: lower = more aggressive (risks
// eating light parts of the product touching the edge), higher = more
// conservative. 15 suits studio-on-white product shots.
export const IMAGE_TRIM_THRESHOLD = 15;

// Base images directory: resolved from PRODUCT_IMAGES_PATH (default ./images).
// In staging/prod this env var is overridden to point at the host bind mount
// of the legacy SMS web root (the deploy's docker-compose.yml on the server
// — not this repo's — wires the bind, since CI excludes docker-compose.yml).
export const IMAGES_BASE_DIR = path.resolve(config.PRODUCT_IMAGES_PATH);

// Flat directory holding byte-for-byte un-cropped originals for manually-cropped
// images, keyed by the image's FINAL filename. See products-image-disk.ts.
export const ORIGINALS_SUBDIR = 'originals';

// Filename prefix for user-uploaded gallery images (POST /upload-image), so
// unselected uploads can be identified and pruned at Save Details time.
export const UPLOAD_PREFIX = 'upload_';

// Cap slug length so we don't overrun NTFS / ext4 filename limits (255 bytes)
// once timestamp + role suffix + extension are added.
export const SLUG_MAX_LEN = 100;
