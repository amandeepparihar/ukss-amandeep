/**
 * Product Feeds - Custom Labels
 *
 * Determines age group, custom_label_2, custom_label_3, custom_label_4
 * from the product row, title, size, and (for CL3) the feed type.
 *
 * PHP source:
 *   ukss-feed/customLabels.php
 *   ukss-feed/build_data_functions.php::determineAgeGroup()
 *   ukss-feed/build_data.php lines 191-208 (customLabel3 block)
 *   ukss-feed/build_data.php lines 293-305 (customLabel2 block)
 */

import type { CustomLabel3, ProductVariationRow } from '../product-feeds.types.js';

// ---------------------------------------------------------------------------
// age group
// ---------------------------------------------------------------------------

const AGE_KEYWORDS: readonly string[] = ['newborn', 'infant', 'toddler', 'kids'];

/**
 * Pick the age group from title keyword (unique match) > size pattern >
 * DB `agegroup` > "adult".
 *
 * Mirrors PHP determineAgeGroup() exactly including the unique-title-
 * match short-circuit.
 */
export function determineAgeGroup(
  dbAge: string | null | undefined,
  title: string,
  size: string,
): string {
  const lowerTitle = title.toLowerCase();
  const titleMatches = AGE_KEYWORDS.filter((ag) => lowerTitle.includes(ag));
  if (titleMatches.length === 1) {
    return titleMatches[0];
  }

  // PHP lowercases `$size` then runs the regex below without the /i
  // flag, so the literal "Mo" can never match (the string is lowercase,
  // the pattern is uppercase). The newborn / infant branches are
  // effectively dead code in PHP. We run the exact same semantics here
  // by dropping /i and testing against the lowercased size. Abhinav Gautam
  const lowerSize = (size ?? '').toLowerCase();

  if (lowerSize.includes('toddler')) return 'toddler';
  if (/\b(0-3|1-2)\s*Mo\b/.test(lowerSize)) return 'newborn';
  if (/\b(3-12|6-9|9-12|12-18|18-24)\s*Mo\b/.test(lowerSize)) return 'infant';
  if (/\b1-5\s*years\b/.test(lowerSize) || /^(1|2|3|4)-(2|3|4|5)$/.test(lowerSize)) {
    return 'toddler';
  }
  if (/^(6|7|8|9|10|11|12)-(7|8|9|10|11|12|13)$/.test(lowerSize)) return 'kids';

  if (dbAge && dbAge.trim().length > 0) return dbAge;
  return 'adult';
}

// ---------------------------------------------------------------------------
// custom_label_2 (product-type category)
// ---------------------------------------------------------------------------

/**
 * Category -> regex word list. Whole-word case-insensitive match wins
 * the first category whose word list hits the title.
 */
const CATEGORIES: ReadonlyArray<{ category: string; words: readonly string[] }> = [
  { category: 'goalkeeper', words: ['goalkeeper', 'goalie'] },
  { category: 'retro', words: [
    'retro', 'vintage', 'classic', 'nostalgic', 'old-school', 'old school',
    'throwback', 'antique', 'traditional', 'timeless', 'yesteryear', 'bygone era',
  ] },
  { category: 'polo', words: ['polo', 'golf shirt', 'tennis shirt', 'collared shirt', 'button-up'] },
  { category: 'pants', words: ['pants', 'trousers', 'slacks', 'bottoms', 'jeans', 'chinos', 'khakis'] },
  { category: 'headwear', words: ['hat', 'cap', 'beanie', 'snapback', 'headwear', 'lid', 'bucket hat'] },
  { category: 'shorts', words: ['shorts', 'short pants', 'briefs', 'trunks', 'board shorts'] },
  { category: 'jacket', words: ['jacket', 'coat', 'windbreaker', 'blazer', 'parka', 'anorak'] },
  { category: 'hoodies', words: ['hoodie', 'sweatshirt', 'pullover', 'zip-up', 'jumper'] },
  { category: 'socks', words: ['socks', 'stockings', 'hose', 'footwear'] },
  { category: 'tracksuits', words: ['tracksuit', 'warm-up suit', 'jogging suit', 'sweat suit'] },
  { category: 'flags', words: ['flag'] },
  { category: 'sweat tops', words: ['sweat top', 'sweatshirt', 'crew neck', 'pullover'] },
  { category: 'fleeces', words: ['fleece', 'microfleece', 'soft shell'] },
  { category: 'slippers', words: ['slippers', 'house shoes', 'slides', 'flip-flops', 'thongs'] },
  { category: 'mini kit', words: ['mini kit', 'mini-kit'] },
  { category: 'bed covering', words: ['duvet', 'blanket'] },
  { category: 'bags', words: ['bag', 'backpack', 'duffle', 'crossbody', 'tote'] },
];

/**
 * UKSS product_type id -> category label. Falls back to this map when
 * the title-based category match is empty.
 */
const UKSS_PRODUCT_TYPES: Readonly<Record<number, string>> = {
  12: 'mini kit',
  13: 'goalkeeper',
  14: 'shorts',
  15: 'socks',
  16: 'polo',
  17: 'jacket',
  18: 'sleeveless',
  21: 'sweat tops',
  22: 'hoodies',
  23: 'headwear',
  24: 'fleeces',
  25: 'pants',
  27: 'tracksuits',
  28: 'retro',
  29: 'retro',
  32: 'mugs',
  33: 'bed covering',
  36: 'bags',
  38: 'flags',
  41: 'shoes',
  44: 'water bottles',
  46: 'headwear',
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkCategories(tempTitle: string): string | null {
  for (const { category, words } of CATEGORIES) {
    for (const word of words) {
      const re = new RegExp('\\b' + escapeRegex(word) + '\\b', 'i');
      if (re.test(tempTitle)) return category;
    }
  }
  return null;
}

/**
 * Priority: print flag > title category match > product-type-id map >
 * "current season" if the title contains the current-season year.
 * Returns "empty" if nothing matches.
 *
 * Mirrors build_data.php lines 293-305 + typeOfProduct().
 */
export function getCustomLabel2(
  productsType: number | null | undefined,
  title: string,
  isPrint: boolean,
  currentSeason: number,
): string {
  if (isPrint) return 'print';

  const fromTitle = checkCategories(title);
  if (fromTitle) return fromTitle;

  if (productsType != null) {
    const mapped = UKSS_PRODUCT_TYPES[productsType];
    if (mapped) return mapped.toLowerCase();
  }

  if (title.toLowerCase().includes(String(currentSeason))) {
    return 'current season';
  }

  return 'empty';
}

// ---------------------------------------------------------------------------
// custom_label_3 (feed-type-specific bucket)
// ---------------------------------------------------------------------------

/**
 * Bestseller-word dictionary: title substring -> normalised label.
 *
 * Keys preserve the exact case of PHP's `$bestsellerWords` because the
 * PHP lookup is case-sensitive (`strpos($lowercaseTitle, $key)`). Keys
 * that contain any uppercase letters can never match a lowercased
 * title, making them effectively dead entries in PHP -- but we keep
 * them here so JS matches the same products PHP does (and misses the
 * same ones). Later duplicate keys overwrite earlier ones to match PHP
 * array semantics. Abhinav Gautam
 */
const BESTSELLER_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['trainer', 'trainer'],
  ['training', 'training'],
  ['Shearer', 'Alan Shearer'],
  ['Del Piero', 'Alessandro Del Piero'],
  ['Putellas', 'Alexia Putellas'],
  ['Palmer', 'Cole Palmer'],
  ['yamal', 'lamine yamal'],
  ['Drogba', 'Didier Drogba'],
  ['Maradona', 'Diego Maradona'],
  ['Cantona', 'Eric Cantona'],
  ['Lampard', 'Frank Lampard'],
  ['Buffon', 'Gianluigi Buffon'],
  ['Casillas', 'Iker Casillas'],
  ['Iniesta', 'Iniesta'],
  ['Musiala', 'Musiala'],
  ['Cruyff', 'Cruyff'],
  ['Kaka', 'Kaka'],
  ['Benzema', 'Karim Benzema'],
  ['Modric', 'Luka Modric'],
  ['Neuer', 'Manuel Neuer'],
  ['Odegaard', 'Martin Odegaard'],
  ['Maldini', 'Paolo Maldini'],
  ['Gascoigne', 'Paul Gascoigne'],
  ['Scholes', 'Paul Scholes'],
  ['Pedri', 'Pedri'],
  ['Pele', 'Pele'],
  ['Foden', 'Phil Foden'],
  ['Leao', 'Leao'],
  ['Hojlund', 'Hojlund'],
  ['James', 'Reece James'],
  ['Baggio', 'Roberto Baggio'],
  ['Rodrygo', 'Rodrygo'],
  ['Ronaldinho', 'Ronaldinho'],
  ['Keane', 'Roy Keane'],
  ['Aguero', 'Sergio Aguero'],
  ['Ramos', 'Sergio Ramos'],
  ['Henry', 'Thierry Henry'],
  ['Muller', 'Thomas Muller'],
  ['Rooney', 'Wayne Rooney'],
  ['Xavi', 'Xavi'],
  ['Toure', 'Yaya Toure'],
  ['Zidane', 'Zinedine Zidane'],
  ['Ibrahimovic', 'Zlatan Ibrahimovic'],
  ['Haaland', 'Erling Haaland'],
  ['Ronaldo', 'Cristiano Ronaldo'],
  ['Bellingham', 'Jude Bellingham'],
  ['Saka', 'Bukayo Saka'],
  ['Mbappe', 'Kylian Mbappe'],
  ['Vinicius', 'Vinicius'],
  ['Jesus', 'Gabriel Jesus'],
  ['Grealish', 'Jack Grealish'],
  ['de Bruyne', 'Kevin de Bruyne'],
  ['Lukaku', 'Romelu Lukaku'],
  ['Rashford', 'Marcus Rashford'],
  ['Fernandes', 'Bruno Fernandes'],
  ['Son', 'Heung-Min Son'],
  ['Salah', 'Mohammed Salah'],
  ['Diaz', 'Luis Diaz'],
  // "Garnacho" appears twice in PHP -- the second overwrites the first.
  ['Garnacho', 'Garnacho'],
  ['Neymar', 'Neymar'],
  ['Guimaraes', 'Bruno Guimaraes'],
  ['Lewandowski', 'Robert Lewandowski'],
  // "Dybala" appears twice -- second wins.
  ['Dybala', 'Dybala'],
  ['Harry Kane', 'Harry Kane'],
  // "Martinez" appears twice -- second wins ("Lisandro Martinez").
  ['Martinez', 'Lisandro Martinez'],
  ['Rice', 'Declan Rice'],
  ['Griezmann', 'Antoine Griezmann'],
  ['Felix', 'Joao Felix'],
  ['Saliba', 'William Saliba'],
  ['Sane', 'Leroy Sane'],
  ['Maddison', 'James Maddison'],
  ['Van Dijk', 'Virgil Van Dijk'],
  ['Heung-Min', 'Heung-Min'],
  ['Nesta', 'Alessandro Nesta'],
  ['Pirlo', 'Andrea Pirlo'],
  ['Shevchenko', 'Andriy Shevchenko'],
  ['Pulisic', 'Christian Pulisic'],
  ['McGinn', 'John McGinn'],
  ['Bergkamp', 'Dennis Bergkamp'],
  ['Ozil', 'Mesut Ozil'],
  ['Gavi', 'Gavi'],
  ['De Jong', 'Frenkie De Jong'],
  ['Coman', 'Kingsley Coman'],
  ['Kimmich', 'Joshua Kimmich'],
  ['Di Maria', 'Angel Di Maria'],
  ['Reus', 'Marco Reus'],
  ['Sterling', 'Raheem Sterling'],
  ['Zola', 'Gianfranco Zola'],
  ['Silva', 'Thiago Silva'],
  ['Batistuta', 'Gabriel Batistuta'],
  ['Adriano', 'Adriano'],
  ['Crespo', 'Hernan Crespo'],
  ['Szoboszlai', 'Dominik Szoboszlai'],
  ['Alisson', 'Alisson'],
  ['Alexander-Arnold', 'Trent Alexander-Arnold'],
  ['Dias', 'Ruben Dias'],
  ['Kvaratskhelia', 'Khvicha Kvaratskhelia'],
  ['Ginola', 'David Ginola'],
  ['Dembele', 'Ousmane Dembele'],
  ['messi', 'Lionel Messi'],
  ['david beckham', 'david beckham'],
  ['beckham 32', 'david beckham'],
  ['beckham 7', 'david beckham'],
  ['beckham 24', 'david beckham'],
  ['beckham 23', 'david beckham'],
  ['hagi', 'hagi'],
  ['kroos', 'kroos'],
  ['Schmeichel', 'Schmeichel'],
  ['2025', 'current sesason'], // PHP typo preserved
];

/**
 * First substring match wins. Returns null on no match.
 *
 * PHP: `strpos($lowercaseTitle, $key)` -- the title is lowercased but
 * the key retains its original case. JS mirrors this by testing
 * `lowercaseTitle.includes(key)` against the mixed-case keys above.
 * Keys with any uppercase letters can never match the lowercased title
 * (PHP parity bug). Abhinav Gautam
 */
export function findFirstMatch(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [key, value] of BESTSELLER_WORDS) {
    if (lower.includes(key)) return value;
  }
  return null;
}

/**
 * Build the 3-slot custom_label_3 object for all feed variants.
 *
 * all:         t-shirts > your-name > hero-shirts > airo-concept-kit >
 *              first-bestseller-match > ''
 * facebook:    lowercase(teamName) or ''
 * shoptimized: lowercase(teamName) or ''
 *
 * `longTitle` is the improved title used for the bestseller lookup;
 * `rawTitle` is the pre-improve title used for the "Your Name" check
 * (matches PHP which passes $tempTitle there).
 *
 * Mirrors build_data.php lines 191-208.
 */
export function getCustomLabel3(
  row: ProductVariationRow,
  teamName: string,
  rawTitle: string,
  longTitle: string,
): CustomLabel3 {
  let all: string;

  if (row.virtual_product_type_id != null && Number(row.virtual_product_type_id) === 4) {
    all = 't-shirts';
  } else if (rawTitle.toLowerCase().includes('your name')) {
    all = 'your-name';
  } else if (row.hero_shirts != null && Number(row.hero_shirts) === 1) {
    all = 'hero-shirts';
  } else if (row.manufacturer_name === 'Airo Sportswear') {
    all = 'airo-concept-kit';
  } else {
    all = 'empty';
  }

  if (all === 'empty') {
    all = findFirstMatch(longTitle) ?? '';
  }

  const teamLower = teamName ? teamName.toLowerCase() : '';

  return {
    all,
    facebook: teamLower,
    shoptimized: teamLower,
  };
}

// ---------------------------------------------------------------------------
// custom_label_4 (season label)
// ---------------------------------------------------------------------------

/**
 * Returns true if the title contains the full ("2024-2025") or
 * abbreviated ("2024-25") season range starting at `firstYear`.
 * Case-insensitive.
 */
function checkSeasonYears(title: string, firstYear: number): boolean {
  const secondYear = firstYear + 1;
  const lower = title.toLowerCase();
  const full = `${firstYear}-${secondYear}`;
  const abbrev = `${firstYear}-${String(secondYear).slice(-2)}`;
  return lower.includes(full) || lower.includes(abbrev);
}

/**
 * Detect the season label from the title, checking (in order):
 *   next > current > last > last-to-last > historical (year..1960).
 *
 * Returns the "YYYY-YYYY" label or '' if nothing matched.
 *
 * Mirrors customLabel4() but drives all labels off `currentSeason`
 * (the PHP hard-codes "2025-2026" / "2024-2025" / "2023-2024" which
 * happen to equal the dynamic values when CURRENT_SEASON=2026).
 */
export function getCustomLabel4(title: string, currentSeason: number): string {
  // Next season
  if (checkSeasonYears(title, currentSeason)) {
    return `${currentSeason}-${currentSeason + 1}`;
  }
  // Current, last, last-to-last
  for (let back = 1; back <= 3; back++) {
    const year = currentSeason - back;
    if (checkSeasonYears(title, year)) {
      return `${year}-${year + 1}`;
    }
  }
  // Historical -- year goes from currentSeason-4 down to 1960.
  for (let year = currentSeason - 4; year >= 1960; year--) {
    if (checkSeasonYears(title, year)) {
      return `${year}-${year + 1}`;
    }
  }

  return '';
}
