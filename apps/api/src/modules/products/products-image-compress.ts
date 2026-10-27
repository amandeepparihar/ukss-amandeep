/**
 * New Product Module — image compression / normalisation to 1080x1080.
 * Extracted from products-image.service.ts verbatim (no behaviour change).
 */

import sharp from 'sharp';
import {
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  JPEG_QUALITY,
  IMAGE_WHITE,
  IMAGE_MARGIN,
  IMAGE_INNER,
  IMAGE_TRIM_THRESHOLD,
} from './products-image.constants';

// ---------------------------------------------------------------------------
// Helper: compress image to 1080x1080
// ---------------------------------------------------------------------------

export async function compressImage(
  buffer: Buffer,
  opts: { skipTrim?: boolean } = {},
): Promise<Buffer> {
  // Manually-cropped images: the user's framing is final — just normalise to
  // 1080x1080 JPEG without trimming or re-framing. .flatten() still composites
  // any alpha against white so a bg-removed-then-cropped source doesn't encode
  // with a black JPEG background.
  if (opts.skipTrim) {
    return sharp(buffer)
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'contain', background: { ...IMAGE_WHITE, alpha: 1 } })
      .flatten({ background: IMAGE_WHITE })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  }

  // 1. Composite any alpha onto white FIRST so trim() sees a uniform border
  //    (also fixes transparent-PNG-becomes-black: Sharp's default for
  //    alpha→JPEG is black, which is how a transparent PNG source ends up
  //    saved with a black background even though the user never clicked the
  //    bg-removal scissors).
  const flat = await sharp(buffer).flatten({ background: IMAGE_WHITE }).toBuffer();

  // 2. Trim the surrounding near-white border. Guarded: sharp throws if the
  //    whole image would trim away (blank / near-blank image) — fall back to
  //    the untrimmed frame. sharp 0.33 takes the options-object form of trim().
  let trimmed = flat;
  try {
    trimmed = await sharp(flat)
      .trim({ background: '#ffffff', threshold: IMAGE_TRIM_THRESHOLD })
      .toBuffer();
  } catch {
    trimmed = flat;
  }

  // 3. Fit the trimmed subject into the inner box, then extend a uniform
  //    margin out to the full canvas — so the border is even instead of
  //    whatever random amount the source image happened to carry.
  return sharp(trimmed)
    .resize(IMAGE_INNER, IMAGE_INNER, { fit: 'contain', background: { ...IMAGE_WHITE, alpha: 1 } })
    .extend({ top: IMAGE_MARGIN, bottom: IMAGE_MARGIN, left: IMAGE_MARGIN, right: IMAGE_MARGIN, background: { ...IMAGE_WHITE, alpha: 1 } })
    .flatten({ background: IMAGE_WHITE })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
