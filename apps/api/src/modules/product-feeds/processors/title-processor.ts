/**
 * Product Feeds - Title Processor
 *
 * Pure-string transformations for product titles and descriptions:
 *   - fixEncoding     -- replace mojibake
 *   - standardizeTitle-- normalise season years ("'86-'87 ...")
 *   - cleanDescription-- decode HTML, strip tags, collapse whitespace
 *   - improveTitle    -- append missing attributes up to 150 chars
 *   - checkTitle4X    -- whole-word containment checks
 *
 * PHP source: ukss-feed/build_data_functions.php
 *   findErrors()        -> fixEncoding()
 *   standardizeTitle()  -> standardizeTitle()
 *   cleanDescription()  -> cleanDescription()
 *   improveTitle()      -> improveTitle()
 *   checkTitle4Player() -> checkTitle4Player()
 *   checkTitle4Team()   -> checkTitle4Team()
 *   createItemDetails() -> createItemDetails()
 */

import { MAX_TITLE_LENGTH } from '../product-feeds.constants.js';

/**
 * Loop over the encoding map until no more replacements happen.
 * Mirrors PHP findErrors() which re-runs until stable.
 */
export function fixEncoding(title: string, map: Record<string, string>): string {
  let out = title;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [bad, good] of Object.entries(map)) {
      if (out.includes(bad)) {
        out = out.split(bad).join(good);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Return true if `pos` in `str` sits inside an unclosed parenthesis.
 * Mirrors PHP isWithinParentheses().
 */
function isWithinParentheses(str: string, pos: number): boolean {
  let openCount = 0;
  for (let i = 0; i < pos; i++) {
    const ch = str.charAt(i);
    if (ch === '(') openCount++;
    else if (ch === ')') openCount--;
  }
  return openCount > 0;
}

/**
 * Extract the first season-style year pair from the title and
 * prepend it as "'YY-'YY " while removing it from the body.
 *
 * Patterns tried in order:
 *   1. 4-digit years:      "1986-87" / "1986-1987"
 *   2. 2-digit years:      "86-87"
 *   3. Slash separator:    "86/87"
 *
 * Skips matches inside parentheses and 4-digit years before 1800.
 *
 * Mirrors PHP standardizeTitle() exactly.
 */
export function standardizeTitle(title: string): string {
  if (!/\d/.test(title)) {
    return title;
  }
  // Already normalised ("'YY-'YY ").
  if (/^'\d{2}-'\d{2}\s/.test(title)) {
    return title;
  }

  const patterns: RegExp[] = [
    /(\d{4})-(\d{2,4})/,
    /(\d{2})-(\d{2})/,
    /(\d{2})\/(\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(title);
    if (!match) continue;

    const pos = match.index;
    if (isWithinParentheses(title, pos)) {
      continue;
    }

    let year1 = match[1];
    let year2 = match[2];

    if (year1.length === 4) {
      if (parseInt(year1, 10) < 1800) {
        continue;
      }
      year1 = year1.slice(-2);
      if (year2.length === 4) {
        year2 = year2.slice(-2);
      }
    }

    const before = title.substring(0, pos);
    const after = title.substring(pos + match[0].length);
    const newTitle = (before + ' ' + after).trim();
    return `'${year1}-'${year2} ${newTitle}`;
  }

  return title;
}

/**
 * Decode HTML entities and strip tags from the product description.
 * Note: PHP's html_entity_decode handles named entities (&amp; &nbsp; etc).
 * We cover the common ones used in UKSS descriptions.
 */
export function cleanDescription(description: string): string {
  if (!description) return '';

  // Entity decode -- named + numeric. Mirrors PHP's
  // html_entity_decode($description, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
  // which decodes ALL HTML5 named entities. We replicate the subset
  // that actually appears in UKSS product descriptions: the generic
  // HTML + typography entities (/gi, case-insensitive is safe -- these
  // have a single case-only form), plus the full Latin-1 supplement
  // (/g, case-sensitive -- `&Eacute;` != `&eacute;`). Abhinav Gautam
  let out = description
    // Generic HTML + typography (case-insensitive safe)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&deg;/gi, '°')
    .replace(/&pound;/gi, '£')
    .replace(/&euro;/gi, '€')
    .replace(/&bull;/gi, '•')
    // Latin-1 accented letters (case-sensitive: upper/lower are distinct)
    .replace(/&Aacute;/g, 'Á').replace(/&aacute;/g, 'á')
    .replace(/&Acirc;/g, 'Â').replace(/&acirc;/g, 'â')
    .replace(/&Agrave;/g, 'À').replace(/&agrave;/g, 'à')
    .replace(/&Atilde;/g, 'Ã').replace(/&atilde;/g, 'ã')
    .replace(/&Auml;/g, 'Ä').replace(/&auml;/g, 'ä')
    .replace(/&Aring;/g, 'Å').replace(/&aring;/g, 'å')
    .replace(/&AElig;/g, 'Æ').replace(/&aelig;/g, 'æ')
    .replace(/&Ccedil;/g, 'Ç').replace(/&ccedil;/g, 'ç')
    .replace(/&Eacute;/g, 'É').replace(/&eacute;/g, 'é')
    .replace(/&Ecirc;/g, 'Ê').replace(/&ecirc;/g, 'ê')
    .replace(/&Egrave;/g, 'È').replace(/&egrave;/g, 'è')
    .replace(/&Euml;/g, 'Ë').replace(/&euml;/g, 'ë')
    .replace(/&Iacute;/g, 'Í').replace(/&iacute;/g, 'í')
    .replace(/&Icirc;/g, 'Î').replace(/&icirc;/g, 'î')
    .replace(/&Igrave;/g, 'Ì').replace(/&igrave;/g, 'ì')
    .replace(/&Iuml;/g, 'Ï').replace(/&iuml;/g, 'ï')
    .replace(/&Ntilde;/g, 'Ñ').replace(/&ntilde;/g, 'ñ')
    .replace(/&Oacute;/g, 'Ó').replace(/&oacute;/g, 'ó')
    .replace(/&Ocirc;/g, 'Ô').replace(/&ocirc;/g, 'ô')
    .replace(/&Ograve;/g, 'Ò').replace(/&ograve;/g, 'ò')
    .replace(/&Otilde;/g, 'Õ').replace(/&otilde;/g, 'õ')
    .replace(/&Ouml;/g, 'Ö').replace(/&ouml;/g, 'ö')
    .replace(/&Oslash;/g, 'Ø').replace(/&oslash;/g, 'ø')
    .replace(/&Uacute;/g, 'Ú').replace(/&uacute;/g, 'ú')
    .replace(/&Ucirc;/g, 'Û').replace(/&ucirc;/g, 'û')
    .replace(/&Ugrave;/g, 'Ù').replace(/&ugrave;/g, 'ù')
    .replace(/&Uuml;/g, 'Ü').replace(/&uuml;/g, 'ü')
    .replace(/&Yacute;/g, 'Ý').replace(/&yacute;/g, 'ý')
    .replace(/&yuml;/g, 'ÿ')
    .replace(/&szlig;/g, 'ß')
    .replace(/&THORN;/g, 'Þ').replace(/&thorn;/g, 'þ')
    .replace(/&ETH;/g, 'Ð').replace(/&eth;/g, 'ð')
    // Latin-1 symbols (case-insensitive safe: single-form)
    .replace(/&iexcl;/gi, '¡').replace(/&iquest;/gi, '¿')
    .replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»')
    .replace(/&cent;/gi, '¢').replace(/&yen;/gi, '¥')
    .replace(/&sect;/gi, '§').replace(/&para;/gi, '¶')
    .replace(/&middot;/gi, '·').replace(/&times;/gi, '×').replace(/&divide;/gi, '÷')
    .replace(/&frac12;/gi, '½').replace(/&frac14;/gi, '¼').replace(/&frac34;/gi, '¾')
    .replace(/&sup1;/gi, '¹').replace(/&sup2;/gi, '²').replace(/&sup3;/gi, '³')
    .replace(/&plusmn;/gi, '±').replace(/&minus;/gi, '−')
    // Numeric entities (&#N; and &#xN;)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCodePoint(parseInt(code, 16)));

  // Collapse all whitespace (incl. non-breaking spaces) then strip tags.
  out = out.replace(WHITESPACE_RE, ' ');
  out = out.replace(/<[^>]*>/g, '');
  out = out.replace(/[\r\n]/g, ' ');
  out = out.replace(/ +/g, ' ').trim();
  return out;
}

/**
 * Whitespace class matching PCRE `\s` in `u` mode. Notably excludes
 * U+FEFF (ZWNBSP/BOM), which PHP preserves but JavaScript's `\s`
 * collapses. Abhinav Gautam
 */
const WHITESPACE_RE =
  /[\t\n\v\f\r \xA0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

// ---------------------------------------------------------------------------
// improveTitle and helpers
// ---------------------------------------------------------------------------

export interface ItemDetails {
  agegroup: string;
  title: string;
  gender: string;
  color: string;
  size: string;
  material: string;
  playerName: string;
  teamName: string;
  brand: string;
}

/**
 * Mirrors PHP createItemDetails() -- just a struct builder preserving
 * the key order that improveTitle() iterates over.
 */
export function createItemDetails(
  itemTitle: string,
  itemColor: string,
  playerName: string,
  teamName: string,
  brand: string,
  material: string,
  size: string,
  agegroup: string,
  gender: string,
): ItemDetails {
  return {
    agegroup,
    title: itemTitle,
    gender,
    color: itemColor,
    size,
    material,
    playerName,
    teamName,
    brand,
  };
}

/**
 * Append any of the itemDetails fields to the title that are not
 * already present, up to MAX_TITLE_LENGTH (150). Applies gender
 * mapping (male/female/unisex), brand "Made By:" prefix, and skips
 * material containing "poly".
 *
 * Mirrors PHP improveTitle() -- including the iteration order and
 * the `break` on max-length overflow.
 */
export function improveTitle(itemDetails: ItemDetails, _validSizes: readonly string[]): string {
  const titleText = itemDetails.title;
  let baseTitle = titleText;

  // PHP writes `$material == ""` (comparison) not assignment -- the
  // original bug means the material is never cleared and "Polyester"
  // ends up appended to the title. Preserved verbatim for feed parity.
  // Abhinav Gautam
  const material = itemDetails.material;

  const agegroup = itemDetails.agegroup;

  // Iteration order matches PHP's foreach on the assoc array keys.
  const keys: (keyof ItemDetails)[] = [
    'agegroup',
    'title',
    'gender',
    'color',
    'size',
    'material',
    'playerName',
    'teamName',
    'brand',
  ];

  for (const key of keys) {
    if (key === 'title') continue;
    if (key === 'agegroup') continue;

    let value: string = itemDetails[key];
    if (key === 'material' && material === '') {
      value = '';
    }
    if (!value) continue;
    if (titleText.toLowerCase().includes(value.toLowerCase())) continue;

    // Gender mapping.
    if (key === 'gender') {
      const g = value.toLowerCase();
      if (g === 'female') value = "Women's";
      else if (g === 'male') value = "Men's";
      else if (g === 'unisex') {
        const ag = (agegroup ?? '').toLowerCase();
        if (ag === 'kids') value = 'Kids';
        else if (ag === 'toddler') value = "Toddler's";
        else value = 'Adults';
      }
    }

    // Brand prefix.
    if (key === 'brand' && value !== 'UKSoccershop') {
      value = 'Made By: ' + value;
    }

    // Skip if already appended via a prior iteration.
    if (baseTitle.toLowerCase().includes(value.toLowerCase())) continue;

    const candidate = baseTitle + ' ' + value;
    if (candidate.length <= MAX_TITLE_LENGTH) {
      baseTitle = baseTitle + ' ' + ucwords(value);
    } else {
      break;
    }
  }

  return baseTitle;
}

/**
 * PHP ucwords(): capitalise the first letter of each whitespace-
 * separated word, leaving the rest untouched.
 */
function ucwords(input: string): string {
  return input.replace(/(^|\s)(\S)/g, (_m, pre, ch) => pre + ch.toUpperCase());
}

// ---------------------------------------------------------------------------
// Title containment checks (whole-word)
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true if any whitespace-separated word of `playerName` is a
 * whole-word match inside `itemTitle` (case-sensitive, matching PHP).
 *
 * PHP's `explode(' ', $str)` keeps empty strings produced by leading,
 * trailing, or double spaces. An empty word compiles to /\b\b/ which
 * matches at position 0 of any non-empty title -- so any playerName
 * with stray whitespace (e.g. " Roy") is treated as already in the
 * title. We preserve that behaviour by NOT filtering empty words.
 * Abhinav Gautam
 */
export function checkTitle4Player(playerName: string, itemTitle: string): boolean {
  if (!playerName) return false;
  const words = playerName.split(' ');
  for (const word of words) {
    const re = new RegExp('\\b' + escapeRegex(word) + '\\b');
    if (re.test(itemTitle)) return true;
  }
  return false;
}

/** Identical semantics to checkTitle4Player, kept separate to match PHP. */
export function checkTitle4Team(teamName: string, itemTitle: string): boolean {
  if (!teamName) return false;
  const words = teamName.split(' ');
  for (const word of words) {
    const re = new RegExp('\\b' + escapeRegex(word) + '\\b');
    if (re.test(itemTitle)) return true;
  }
  return false;
}
