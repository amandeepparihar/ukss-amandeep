/**
 * Product Feeds - Size Normalizer
 *
 * Three-stage size normalisation matching the PHP `sizer.php` pipeline:
 *
 *   1. removeBFromSize  -- "XLB" -> "XL" etc.
 *   2. finalSizeClean   -- map "Large", "Extra Large" text to its code
 *   3. fixSize          -- first matching function from a 12-function
 *                          chain wins; otherwise the input is returned
 *                          unchanged.
 *
 * Chain order matters -- the PHP `$functions` array is the source of
 * truth. Each helper returns the normalised string on match or `null`
 * on miss (equivalent to PHP returning `false`).
 *
 * PHP source: ukss-feed/sizer.php (entire file, 222 lines).
 */

const SIZE_SUFFIXES: readonly string[] = ['XLB', 'XSB', 'LB', 'MB', 'SB'];

/**
 * Valid size codes -> display names. Ordering preserved from PHP; the
 * matcher does a case-insensitive whole-word check against both the
 * code and the display name, returning the code on match.
 */
const VALID_SIZES: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'One Size', value: 'One Size' },
  { key: 'XXS', value: 'Extra Extra Small' },
  { key: 'XS', value: 'Extra Small' },
  { key: 'S', value: 'Small' },
  { key: 'M', value: 'Medium' },
  { key: 'L', value: 'Large' },
  { key: 'XL', value: 'Extra Large' },
  { key: 'XXL', value: 'Extra Extra Large' },
  { key: '2XL', value: '2 Extra Large' },
  { key: '3XL', value: '3 Extra Large' },
  { key: '4XL', value: '4 Extra Large' },
  { key: '5XL', value: '5 Extra Large' },
  { key: '6XL', value: '6 Extra Large' },
  { key: '7XL', value: '7 Extra Large' },
];

const VALID_SIZE_KEYS = new Set(VALID_SIZES.map((v) => v.key));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Stage 1: removeBFromSize
// ---------------------------------------------------------------------------

/**
 * Remove the trailing "B" from size codes "XLB", "MB", "SB", "XLB",
 * "XSB" (substring match, then replace). Returns the original string
 * if no suffix matches.
 *
 * Note: PHP checks substring presence then does str_replace on the
 * whole suffix -- so "XLB" in "XLB sleeve" becomes "XL sleeve".
 * We preserve that behaviour.
 */
export function removeBFromSize(size: string): string {
  for (const suffix of SIZE_SUFFIXES) {
    if (size.includes(suffix)) {
      const trimmed = suffix.slice(0, -1); // drop trailing 'B'
      const next = size.split(suffix).join(trimmed);
      if (next !== size) {
        return next;
      }
    }
  }
  return size;
}

// ---------------------------------------------------------------------------
// Stage 2: finalSizeClean
// ---------------------------------------------------------------------------

/**
 * Case-insensitive whole-word match against VALID_SIZES keys OR values.
 * On match, returns the canonical code (key). Falls through to the raw
 * input on no match.
 */
export function finalSizeClean(size: string): string {
  const normalised = size.trim().toUpperCase();
  for (const { key, value } of VALID_SIZES) {
    const keyRe = new RegExp('\\b' + escapeRegex(key.toUpperCase()) + '\\b');
    const valRe = new RegExp('\\b' + escapeRegex(value.toUpperCase()) + '\\b');
    if (keyRe.test(normalised) || valRe.test(normalised)) {
      return key;
    }
  }
  return size;
}

// ---------------------------------------------------------------------------
// Stage 3: the 12-function chain (order matters)
// ---------------------------------------------------------------------------

type SizeFn = (size: string) => string | null;

function returnRawSizeIfMatched(size: string): string | null {
  return VALID_SIZE_KEYS.has(size) ? size : null;
}

function extractWaistSize(size: string): string | null {
  const m = /(\d+-?\d*)\s*"?\s*Waist\b/.exec(size);
  return m ? `${m[1]} Waist` : null;
}

function fix4yr(size: string): string | null {
  return size === '4YR' ? '4' : null;
}

function findAgeRange(input: string): string | null {
  const pattern = /\b(\d+)-(\d+)\s*M\b|\b(\d+)-(\d+)\s*Mth\b|\b(\d+)-(\d+)M\b|\b(\d+)-(\d+)Mth\b/i;
  const m = pattern.exec(input);
  if (!m) return null;
  if (m[1] && m[2]) return `${m[1]}-${m[2]} Mo`;
  if (m[3] && m[4]) return `${m[3]}-${m[4]} Mo`;
  if (m[5] && m[6]) return `${m[5]}-${m[6]} Mo`;
  if (m[7] && m[8]) return `${m[7]}-${m[8]} Mo`;
  return null;
}

function formatToddlerSize(size: string): string | null {
  // ^(1-3|1|2|3)(\s*-\s*\d+)?\s+years?
  const m = /^(1-3|1|2|3)(\s*-\s*\d+)?\s+years?/i.exec(size);
  if (!m) return null;
  const second = m[2] ? m[2].replace(/\s+/g, '') : '';
  return `${(m[1] + second).trim()} Toddler`;
}

function extractSockShoeSize(size: string): string | null {
  const lower = size.toLowerCase();
  if (!(lower.includes('foot') || /^UK /.test(size))) {
    return null;
  }
  const m = /(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/.exec(size);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

function replaceMthsWithMo(size: string): string | null {
  return size.includes(' mths') ? size.split(' mths').join(' Mo') : null;
}

function convertExtendedSizes(size: string): string | null {
  const normalised = size.trim().toUpperCase();
  const m = /^X{3,}L\b/.exec(normalised);
  if (!m) return null;
  const xCount = (m[0].match(/X/g) ?? []).length;
  return `${xCount}XL`;
}

function transformSize(size: string): string | null {
  if (!size.includes('Months')) return null;
  const m = /(\d+)[/-](\d+)/.exec(size);
  return m ? `${m[1]}-${m[2]} Mo` : null;
}

function transformSizeYears(size: string): string | null {
  if (!size.includes('Years')) return null;
  const m = /(\d+)[/-](\d+)/.exec(size);
  return m ? `${m[1]}-${m[2]}` : null;
}

function extractNumberRange(size: string): string | null {
  const m = /(\d+)-(\d+)/.exec(size);
  return m ? `${m[1]}-${m[2]}` : null;
}

function extractChestSize(size: string): string | null {
  const m = /(\d+)"\s*Chest/i.exec(size);
  return m ? m[1] : null;
}

/**
 * PHP `$functions` array, in order. First non-null return wins.
 */
const CHAIN: readonly SizeFn[] = [
  returnRawSizeIfMatched,
  extractWaistSize,
  fix4yr,
  findAgeRange,
  formatToddlerSize,
  extractSockShoeSize,
  replaceMthsWithMo,
  convertExtendedSizes,
  transformSize,
  transformSizeYears,
  extractNumberRange,
  extractChestSize,
];

function fixSize(size: string): string {
  for (const fn of CHAIN) {
    const result = fn(size);
    if (result !== null) return result;
  }
  return size;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the full three-stage pipeline: remove trailing B, apply the
 * large/small text -> code map, then the 12-function fix chain.
 */
export function normalizeSize(raw: string | null | undefined): string {
  if (!raw) return '';
  const afterB = removeBFromSize(raw);
  const afterClean = finalSizeClean(afterB);
  return fixSize(afterClean);
}
