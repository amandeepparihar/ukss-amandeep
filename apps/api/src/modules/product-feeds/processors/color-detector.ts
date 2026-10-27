/**
 * Product Feeds - Color Detector
 *
 * Three-source colour resolution:
 *   1. findColorInTitle  -- regex multi-word + single-colour sweep
 *   2. database column   -- `row.color` from the product variation view
 *   3. getColorFromImage -- sample 3 horizontal points at 75% height and
 *                           map each pixel to the nearest named colour
 *
 * PHP source: ukss-feed/findcolor.php
 *   findColor()          -> findColorInTitle()
 *   getColorFromURL()    -> getColorFromImage()
 *   getColorName()       -> classifyRgb() (private)
 *
 * `getColorFromImage` uses `sharp` to read the raw RGB buffer. The
 * `skipImage` flag on `detectColor` short-circuits the HTTP fetch when
 * running large local test batches (see CLI `--skip-image-color`).
 */

import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Title-based colour detection
// ---------------------------------------------------------------------------

/**
 * Colour list in PHP priority order. Multi-word colours come BEFORE
 * their single-word variant ("Dark Blue" is checked before "Blue") so
 * the first match wins with the more specific label.
 */
const TITLE_COLORS: readonly string[] = [
  // Blues
  'Dark Blue',
  'Faded Blue',
  'Denim Blue',
  'Sky Blue',
  'Atoll Blue',
  'Ultramarine Blue',
  'Caribbean Blue',
  'Light Blue',
  'Lght Blue',
  // Greens
  'Bottle Green',
  'Apple Green',
  'Light Green',
  // Greys
  'Dark Grey',
  'Light Grey',
  'Grey Marl',
  // Singles
  'Blue',
  'Black',
  'Green',
  'Grey',
  'Maroon',
  'Navy',
  'Orange',
  'Red',
  'White',
  'lemon-yellow',
  'Yellow',
  'Beige',
  'Hazy Beige',
  'sail',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive whole-word scan over TITLE_COLORS. Returns the
 * label (as written) of the first matching colour, or null.
 */
export function findColorInTitle(itemTitle: string): string | null {
  for (const color of TITLE_COLORS) {
    const re = new RegExp('\\b' + escapeRegex(color) + '\\b', 'i');
    if (re.test(itemTitle)) {
      return color;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Image-based colour detection
// ---------------------------------------------------------------------------

interface NamedColor {
  name: string;
  rgb: [number, number, number];
}

/**
 * Palette used by the image classifier. Same 28 colours as
 * `findcolor.php::getColorName()`.
 */
const PALETTE: readonly NamedColor[] = [
  { name: 'Red', rgb: [255, 0, 0] },
  { name: 'Orange', rgb: [255, 165, 0] },
  { name: 'Yellow', rgb: [255, 255, 0] },
  { name: 'Green', rgb: [0, 128, 0] },
  { name: 'Cyan', rgb: [0, 255, 255] },
  { name: 'Blue', rgb: [0, 0, 255] },
  { name: 'Light Blue', rgb: [173, 216, 230] },
  { name: 'Magenta', rgb: [255, 0, 255] },
  { name: 'Purple', rgb: [128, 0, 128] },
  { name: 'Lavender', rgb: [230, 230, 250] },
  { name: 'Lilac', rgb: [200, 162, 200] },
  { name: 'White', rgb: [255, 255, 255] },
  { name: 'Black', rgb: [0, 0, 0] },
  { name: 'Grey', rgb: [128, 128, 128] },
  { name: 'Silver', rgb: [192, 192, 192] },
  { name: 'Pink', rgb: [255, 192, 203] },
  { name: 'Maroon', rgb: [128, 0, 0] },
  { name: 'Brown', rgb: [165, 42, 42] },
  { name: 'Beige', rgb: [245, 245, 220] },
  { name: 'Tan', rgb: [210, 180, 140] },
  { name: 'Peach', rgb: [255, 218, 185] },
  { name: 'Lime', rgb: [0, 255, 0] },
  { name: 'Olive', rgb: [128, 128, 0] },
  { name: 'Turquoise', rgb: [64, 224, 208] },
  { name: 'Teal', rgb: [0, 128, 128] },
  { name: 'Navy blue', rgb: [0, 0, 128] },
  { name: 'Indigo', rgb: [75, 0, 130] },
  { name: 'Violet', rgb: [238, 130, 238] },
];

function classifyRgb(r: number, g: number, b: number): string {
  let best = PALETTE[0].name;
  let min = Number.POSITIVE_INFINITY;
  for (const { name, rgb } of PALETTE) {
    const d = Math.sqrt(
      (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2,
    );
    if (d < min) {
      min = d;
      best = name;
    }
  }
  return best;
}

async function fetchImageBytes(url: string, timeoutMs: number): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download the image, sample 3 points along a horizontal line at 75%
 * height (left-15%, centre, right-15%), map each to the nearest named
 * colour, and return the best name by majority vote. Centre wins on
 * ties.
 *
 * Retries the HTTP fetch once before giving up. Returns null on any
 * failure path.
 */
export async function getColorFromImage(
  imageUrl: string,
  timeoutMs = 2000,
): Promise<string | null> {
  // Validate URL shape (matches PHP filter_var FILTER_VALIDATE_URL).
  try {
    const u = new URL(imageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  let bytes = await fetchImageBytes(imageUrl, timeoutMs);
  if (!bytes) {
    bytes = await fetchImageBytes(imageUrl, timeoutMs);
    if (!bytes) return null;
  }

  try {
    const img = sharp(bytes).ensureAlpha(0).removeAlpha();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;

    const width = meta.width;
    const height = meta.height;
    const y = Math.floor(height * 0.75);
    const centerX = Math.floor(width / 2);
    const leftX = Math.max(0, centerX - Math.floor(width * 0.15));
    const rightX = Math.min(width - 1, centerX + Math.floor(width * 0.15));

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels; // typically 3 after removeAlpha

    const pixelAt = (x: number, yy: number): [number, number, number] => {
      const offset = (yy * width + x) * channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };

    const [r1, g1, b1] = pixelAt(leftX, y);
    const [r2, g2, b2] = pixelAt(centerX, y);
    const [r3, g3, b3] = pixelAt(rightX, y);

    const left = classifyRgb(r1, g1, b1);
    const center = classifyRgb(r2, g2, b2);
    const right = classifyRgb(r3, g3, b3);

    // Majority vote, centre wins ties -- matches findcolor.php.
    if (left === center && center === right) return center;
    if (left === center || left === right) return left;
    if (center === right) return center;
    return center;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrated detection
// ---------------------------------------------------------------------------

/**
 * Try title -> DB color -> image, in that order. Returns '' if nothing
 * matches (rather than null, since the consumer writes the string into
 * the feed unconditionally).
 *
 * When `skipImage` is true the image fetch is skipped entirely -- used
 * by the CLI `--skip-image-color` flag for faster local runs.
 */
export async function detectColor(
  title: string,
  dbColor: string | null,
  imageUrl: string | null,
  skipImage: boolean,
): Promise<string> {
  const fromTitle = findColorInTitle(title);
  if (fromTitle) return fromTitle;

  if (dbColor && dbColor.trim().length > 0) return dbColor;

  if (!skipImage && imageUrl) {
    const fromImage = await getColorFromImage(imageUrl);
    if (fromImage) return fromImage;
  }

  return '';
}
