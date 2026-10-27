/**
 * Product Feeds - GTIN Validator
 *
 * Returns true when a GTIN is a 12- or 13-digit number that:
 *   - is numeric
 *   - does not start with a restricted/coupon prefix (02, 04, 2, 05, 98, 99)
 *   - is not on the 14-entry invalid list
 *
 * PHP source: ukss-feed/gtin.php::isValidGTIN()
 *
 * NOTE: The PHP ends with two back-to-back `return true;` branches --
 * the brand list is effectively dead code. We preserve the observable
 * behaviour (a GTIN passing the first three checks is always valid,
 * regardless of brand) and keep `brand` in the signature for interface
 * compatibility with the PHP caller.
 */

const INVALID_GTINS = new Set<string>([
  '5362050207',
  '5362050208',
  '5332020503',
  '780330901283',
  '780330901238',
  '780330901245',
  '780330901252',
  '780330901269',
  '780330901276',
  '780330901290',
  '780330901306',
  '780330901313',
  '780330901320',
  '505624761558',
]);

/** Restricted prefixes (coupons, internal codes). */
const RESTRICTED_PREFIX_RE = /^(?!02|04|2|05|98|99)[0-9]{12,13}$/;
const LENGTH_RE = /^[a-zA-Z0-9]{12,13}$/;

/**
 * @param gtin   candidate GTIN (may be null/undefined -- returns false)
 * @param _brand preserved for parity with PHP; unused (see file header)
 */
export function isValidGTIN(
  gtin: string | null | undefined,
  _brand?: string | null,
): boolean {
  if (!gtin) return false;

  // PHP is_numeric allows leading sign / decimals; for GTINs we want
  // pure digits only -- the second regex enforces this, but we check
  // Number() first to mirror is_numeric behaviour for the early-return.
  if (!/^\d+$/.test(gtin) && Number.isNaN(Number(gtin))) return false;

  if (!LENGTH_RE.test(gtin)) return false;
  if (!RESTRICTED_PREFIX_RE.test(gtin)) return false;
  // PHP in_array() uses loose comparison; numeric strings are compared
  // as numbers, so "005362050207" matches "5362050207". Strip leading
  // zeros before lookup to mirror that behaviour. Abhinav Gautam
  const normalized = gtin.replace(/^0+/, '') || '0';
  if (INVALID_GTINS.has(gtin) || INVALID_GTINS.has(normalized)) return false;

  return true;
}
