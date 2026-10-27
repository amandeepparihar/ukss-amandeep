/**
 * Product Feeds - Google Product Category Matcher
 *
 * Matches the product title against ~63 PHP regex patterns in priority
 * order. First match wins; default is 212 (Shirts & Tops) to match the
 * PHP fallback.
 *
 * PHP source: ukss-feed/gpcPatterns.php + build_data_functions.php::g_prod_cats()
 *
 * Pattern order is semantically significant -- keep it identical to
 * the PHP `$patterns` array. Patterns are raw regex strings that will
 * be compiled with /i (case-insensitive) flags, matching PHP `preg_match`.
 */

interface GpcPattern {
  /** PHP regex body (without delimiters) -- applied case-insensitively. */
  pattern: string;
  id: number;
}

const GPC_PATTERNS: readonly GpcPattern[] = [
  { pattern: 'shirt|shrt|shir', id: 212 },
  { pattern: 'lunch bag', id: 100 },
  { pattern: 'sock', id: 209 },
  { pattern: 'duvet', id: 2541 },
  { pattern: '\\btop', id: 212 },
  { pattern: 'hoody', id: 5322 },
  { pattern: 'shorts', id: 207 },
  { pattern: '\\bkey ring', id: 175 },
  { pattern: 'kit', id: 5564 },
  { pattern: 'tee', id: 212 },
  { pattern: 'jacket', id: 5598 },
  { pattern: 'jersey', id: 212 },
  { pattern: 'hoodie', id: 5322 },
  { pattern: 'suit', id: 5322 },
  { pattern: 'blanket', id: 1985 },
  { pattern: 'pant', id: 204 },
  { pattern: 'hooded', id: 5322 },
  { pattern: 'polo', id: 212 },
  { pattern: 'windrunner', id: 203 },
  { pattern: 'backpack', id: 100 },
  { pattern: 'beanie', id: 5625 },
  { pattern: '\\bhat', id: 173 },
  { pattern: 'hood', id: 5322 },
  { pattern: 'mug', id: 2169 },
  { pattern: 'jumper', id: 5322 },
  { pattern: 'calendar', id: 927 },
  { pattern: '\\bcap\\b', id: 173 },
  { pattern: '39THIRTY', id: 173 },
  { pattern: 'glove', id: 203 },
  { pattern: 'sweater', id: 5322 },
  { pattern: 'boot', id: 203 },
  { pattern: 'zip', id: 5322 },
  { pattern: 'phone', id: 3032 },
  { pattern: 'playstation', id: 3576 },
  { pattern: 'gnome', id: 3576 },
  { pattern: 'flag$', id: 3576 },
  { pattern: 'club ball', id: 1112 },
  { pattern: 'match ball', id: 1112 },
  { pattern: '\\bvest\\b', id: 1831 },
  { pattern: 'bib', id: 1110 },
  { pattern: 'towel', id: 1985 },
  { pattern: 'ice bag', id: 3809 },
  { pattern: '\\bbag\\b', id: 100 },
  { pattern: 'xmas stocking', id: 1985 },
  { pattern: 'pro football -', id: 1112 },
  { pattern: 'wrist', id: 1893 },
  { pattern: 'waistbag', id: 100 },
  { pattern: 'shoe bag', id: 100 },
  { pattern: 'scarf', id: 5322 },
  { pattern: '\\bsack\\b', id: 100 },
  { pattern: 'windbreaker', id: 203 },
  { pattern: 'onesie', id: 5411 },
  { pattern: 'sweat', id: 5322 },
  { pattern: 'basic t', id: 212 },
  { pattern: '\\bdog\\b', id: 3576 },
  { pattern: 'Football \\(', id: 1112 },
  { pattern: 'gilet', id: 1831 },
  { pattern: 'fleece', id: 5322 },
  { pattern: 'softshell', id: 203 },
  { pattern: 'cardigan', id: 5322 },
  { pattern: 'parka', id: 5598 },
  { pattern: 'bottoms', id: 204 },
  { pattern: 'crew', id: 5322 },
  { pattern: 'short', id: 207 },
  { pattern: '9FORTY', id: 173 },
  { pattern: 'Card Holder', id: 3032 },
  { pattern: 'stocking', id: 1985 },
  { pattern: 'slippers', id: 173 },
  { pattern: 'windshield', id: 203 },
  { pattern: 'water bottle', id: 3809 },
  { pattern: 'jogger', id: 204 },
];

/** Pre-compiled RegExp objects -- built once at module load. */
const COMPILED: ReadonlyArray<{ re: RegExp; id: number }> = GPC_PATTERNS.map((p) => ({
  re: new RegExp(p.pattern, 'i'),
  id: p.id,
}));

/** Default Google Product Category ID when no pattern matches. */
const DEFAULT_GPC = 212;

/**
 * Return the first-matched GPC id for the title, or 212 if none match.
 * Mirrors PHP g_prod_cats().
 */
export function getGoogleProductCategory(title: string): number {
  for (const { re, id } of COMPILED) {
    if (re.test(title)) return id;
  }
  return DEFAULT_GPC;
}
