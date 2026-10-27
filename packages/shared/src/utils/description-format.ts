/**
 * Product description formatter.
 *
 * Storage contract (legacy SMS + Stock2): `product_lists.description_notes`
 * is HTML so the storefront and marketplace feed adapters preserve structure
 * (paragraphs + bullet lists) when they re-render or normalise whitespace.
 *
 * Authoring/editing contract: the wizard textarea works in plain text — a
 * narrative paragraph followed by `•`-prefixed lines, separated by `\n`,
 * extended with markdown-style heading markers (`#`, `##`, `###`) for the
 * sectioned six-part product descriptions (Overview, Heritage & Inspiration,
 * Key Features & Technical Specifications, Why You'll Love It, Ideal For,
 * Summary) the Dify description workflow produces today. `#` → `<h1>`,
 * `##` → `<h3>` (section headings), `###` → a bolded standalone `<p>` (the
 * sub-heading above a feature-group's bullets).
 *
 * These helpers bridge the two formats:
 *   - `descriptionPlainToHtml` — wizard → DB
 *   - `descriptionHtmlToPlain` — DB → wizard (so existing products can be edited)
 *   - `looksLikeHtml`           — guard: skip the plain→html conversion if the
 *                                 input is already HTML (defensive against
 *                                 callers that pass an already-converted value).
 *
 * Pure functions, zero dependencies — safe to use in both Node (api save path)
 * and browser (frontend pre-fill of the textarea).
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const HTML_UNESCAPES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Bullet-line markers we recognise in plain-text input. */
const BULLET_PATTERN = /^\s*(?:[•·●◦▪–\-*]|\d+[.)])\s+/;

/** Heading-line markers, checked longest-prefix-first (`###` before `##` before `#`). */
const SUBHEADING_PATTERN = /^###\s+(.*)$/; // -> <p><strong>...</strong></p>
const SECTION_HEADING_PATTERN = /^##\s+(.*)$/; // -> <h3><strong>...</strong></h3>
const TITLE_HEADING_PATTERN = /^#\s+(.*)$/; // -> <h1><strong>...</strong></h1>

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_UNESCAPES[m] ?? m);
}

/**
 * Returns true when the input already contains HTML block markup we'd produce.
 * Used as a guard so calling `descriptionPlainToHtml` on already-converted
 * input is a no-op rather than double-escaping.
 */
export function looksLikeHtml(text: string | null | undefined): boolean {
  if (!text) return false;
  return /<\s*(p|ul|ol|li|br|div|strong|em|b|i|h1|h3)\b/i.test(text);
}

/**
 * Convert wizard-format plain text into storefront-safe HTML.
 *
 * Rules:
 *  - Consecutive non-bullet lines collapse into a single `<p>` (joined by spaces).
 *  - Blank line → end of paragraph (next non-bullet group starts a new `<p>`).
 *  - Consecutive bullet lines (any marker recognised by BULLET_PATTERN) become
 *    a `<ul>` with one `<li>` each. The marker character is stripped.
 *  - Each line's text content is HTML-escaped (no markup is forwarded).
 *  - If the input already looks like HTML, returns it unchanged.
 */
export function descriptionPlainToHtml(text: string | null | undefined): string {
  if (!text) return '';
  if (looksLikeHtml(text)) return text;

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];

  // Buffer for the current paragraph or bullet group.
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${escapeHtml(paragraph.join(' ').trim())}</p>`);
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      '<ul>' + bullets.map((b) => `<li>${escapeHtml(b.trim())}</li>`).join('') + '</ul>',
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      // Blank line ends whatever's currently buffered.
      flushParagraph();
      flushBullets();
      continue;
    }
    // Heading markers are emitted immediately (not buffered) — checked
    // longest-prefix-first so `### ` isn't mistaken for `## `/`# `.
    const subheadingMatch = line.match(SUBHEADING_PATTERN);
    if (subheadingMatch) {
      flushParagraph();
      flushBullets();
      out.push(`<p><strong>${escapeHtml(subheadingMatch[1].trim())}</strong></p>`);
      continue;
    }
    const sectionHeadingMatch = line.match(SECTION_HEADING_PATTERN);
    if (sectionHeadingMatch) {
      flushParagraph();
      flushBullets();
      out.push(`<h3><strong>${escapeHtml(sectionHeadingMatch[1].trim())}</strong></h3>`);
      continue;
    }
    const titleHeadingMatch = line.match(TITLE_HEADING_PATTERN);
    if (titleHeadingMatch) {
      flushParagraph();
      flushBullets();
      out.push(`<h1><strong>${escapeHtml(titleHeadingMatch[1].trim())}</strong></h1>`);
      continue;
    }
    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch) {
      // Switching from paragraph to bullets — flush paragraph first.
      flushParagraph();
      bullets.push(line.slice(bulletMatch[0].length));
    } else {
      // Switching from bullets back to paragraph — flush bullets first.
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();

  return out.join('');
}

/** Strip all tags from a fragment, leaving just its text content. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/**
 * Convert storefront HTML back into wizard-format plain text so an existing
 * description can be loaded into the textarea for editing.
 *
 * Rules:
 *  - `<h1>...</h1>` → `# ...` (the reverse of `descriptionPlainToHtml`'s title heading).
 *  - `<h3>...</h3>` → `## ...` (section heading).
 *  - `<p><strong>...</strong></p>` (a paragraph whose *entire* content is one
 *    `<strong>` — the sub-heading shape our own generator produces) → `### ...`.
 *  - `<li>` → `• ` prefix on its own line.
 *  - `</p>`, `</ul>`, `</ol>` → blank-line separator.
 *  - `<br>` (any variant) → newline.
 *  - All other tags stripped.
 *  - HTML entities decoded.
 *  - Collapses runs of 3+ newlines down to 2 (single blank line).
 *  - If the input doesn't look like HTML, returns it unchanged.
 */
export function descriptionHtmlToPlain(html: string | null | undefined): string {
  if (!html) return '';
  if (!looksLikeHtml(html)) return html;

  const replaced = html
    // Heading passes must run before the generic tag stripper below, or the
    // distinction between h1/h3/bolded-subheading and a normal paragraph is lost.
    .replace(/<\s*h1\b[^>]*>([\s\S]*?)<\s*\/\s*h1\s*>/gi, (_, inner: string) => `\n# ${stripTags(inner).trim()}\n\n`)
    .replace(/<\s*h3\b[^>]*>([\s\S]*?)<\s*\/\s*h3\s*>/gi, (_, inner: string) => `\n## ${stripTags(inner).trim()}\n\n`)
    .replace(
      /<\s*p\b[^>]*>\s*<\s*strong\s*>([\s\S]*?)<\s*\/\s*strong\s*>\s*<\s*\/\s*p\s*>/gi,
      (_, inner: string) => `\n### ${stripTags(inner).trim()}\n`,
    )
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*\/\s*(?:p|ul|ol|div)\s*>/gi, '\n\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(replaced)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
