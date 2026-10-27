/**
 * Product Feeds - XML Feed Generator
 *
 * Streaming RSS 2.0 + Google Shopping XML writer. Uses the shared
 * `StreamingFileWriter` so we never buffer the full feed (the EU feed
 * alone can exceed 2GB).
 *
 * Output shape:
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
 *     <channel>
 *       <title>UKSoccershop</title>
 *       <link>http://www.uksoccershop.com/</link>
 *       <description></description>
 *       <item>...</item>
 *       ...
 *     </channel>
 *   </rss>
 *
 * Each product produces one `<item>` per variant. The item field order
 * mirrors the PHP XMLWriter sequence in `processChunkXMLWriter`:
 *   g:id, g:title, description, link, g:canonical_link, g:condition,
 *   (variant-level: g:size, g:size_system, g:gtin, g:custom_label_1,
 *                   g:availability),
 *   g:price, g:google_product_category, g:product_type*,
 *   g:image_link?, g:sale_price?, g:brand?, g:age_group?, g:gender?,
 *   g:material?, g:color?, g:mpn?,
 *   g:shipping* (one block per country * per method),
 *   g:custom_label_0?, g:custom_label_2, g:custom_label_3, g:custom_label_4
 *
 * PHP source: ukss-feed/create_xml_feed.php
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { StreamingFileWriter, fileUtils } from '../../marketplaces/utils/file.utils.js';
import { xmlUtils } from '../../marketplaces/utils/xml.utils.js';
import {
  COUNTRY_CURRENCY_MAP,
  GOOGLE_SHOPPING_NAMESPACE,
  WEBSITE_ROOT,
} from '../product-feeds.constants.js';
import type {
  ProcessedProduct,
  ProductVariant,
  CountryCode,
  FeedType,
  ShippingMethod,
  FeedFileResult,
} from '../product-feeds.types.js';

// Fields that wrap their value in `<![CDATA[...]]>`. Mirrors PHP
// `$CDATAcolumns`. Note that g:size is listed in PHP for parity but is
// always emitted via the condition block using writeElement (no CDATA)
// -- we preserve that discrepancy. g:product_type is also in PHP's
// $CDATAcolumns but the `>` separators are emitted as entity-escaped
// `&gt;` in the reference output (PHP's XMLWriter entity-escapes the
// value even though the column is in the CDATA list), so we drop it
// here and let esc() handle the `>` -> `&gt;` conversion. Abhinav Gautam
const CDATA_FIELDS = new Set<string>([
  'g:title',
  'description',
  'link',
  'g:image_link',
  'g:brand',
]);

/** One shipping-country entry with its pre-loaded methods. */
export interface ShippingEntry {
  /** Feed-facing country code (UK, US, EU, AT, ...) written into `<g:country>`. */
  countryCode: string;
  methods: ShippingMethod[];
}

export interface XmlFeedOptions {
  products: ProcessedProduct[];
  /** Final output file path. Written via temp + rename. */
  filePath: string;
  /** Multiplier applied to every price/shipping cost in this feed. */
  currencyRate: number;
  /** Multi-country shipping blocks. UK feed has 1 entry; EU has 12. */
  shipping: ShippingEntry[];
  /** Primary country of the feed (used to build the `<link>` query string). */
  country: CountryCode;
  feedType: FeedType;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return xmlUtils.escape(String(s));
}

/** Wrap content in CDATA, escaping any nested `]]>` sequences. */
function cdata(s: unknown): string {
  const raw = s === null || s === undefined ? '' : String(s);
  // CDATA can't contain "]]>" literally; split and re-join if it appears.
  const safe = raw.split(']]>').join(']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function elem(tag: string, value: unknown, useCdata = false): string {
  const content = useCdata ? cdata(value) : esc(value);
  return `<${tag}>${content}</${tag}>`;
}

/**
 * Format a money value: `rate * value` to 2 decimals + " CODE".
 *
 * Uses PHP-style half-away-from-zero rounding. JS `toFixed(2)` drifts on
 * values like 59.925 (IEEE-754 stores it as 59.924999…) and rounds down
 * to 59.92, whereas PHP `number_format` returns 59.93. We add a small
 * epsilon in the sign direction before Math.round to overcome the
 * representation error. Abhinav Gautam
 */
function formatMoney(value: number, rate: number, currencyCode: string): string {
  const product = value * rate;
  const scaled = product * 100;
  const rounded =
    scaled >= 0
      ? Math.round(scaled + 1e-8) / 100
      : -Math.round(-scaled + 1e-8) / 100;
  return `${rounded.toFixed(2)} ${currencyCode}`;
}

/** Pick the query-string currency for a feed country. */
function currencyFor(country: string): string {
  return COUNTRY_CURRENCY_MAP[country] ?? 'USD';
}

/** Is the first variant's size literally "Default Title"? */
function hasDefaultTitleSize(p: ProcessedProduct): boolean {
  const first = p.item_variants[0];
  return first?.item_size?.toLowerCase() === 'default title';
}

/** Build the feed-type-aware `link` query string. */
function buildLink(
  baseLink: string,
  varId: number,
  feedType: FeedType,
  country: CountryCode,
): string {
  if (feedType === 'facebook') {
    return `${baseLink}?ovId=${varId}`;
  }
  if (country === 'EU') {
    return `${baseLink}?currency=EUR&ovId=${varId}`;
  }
  return `${baseLink}?currency=${currencyFor(country)}&gcountry=${country}&ovId=${varId}`;
}

/**
 * Parse an `N-M` or "Next Working Day" shipping delivery window into
 * min / max transit days.
 */
function parseTransitDays(time: string): { start: number; end: number } {
  if (time === 'Next Working Day') {
    return { start: 1, end: 1 };
  }
  const m = /(\d+)-(\d+)/.exec(time);
  if (m) {
    return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
  }
  return { start: 0, end: 0 };
}

// ---------------------------------------------------------------------------
// Per-variant block builder
// ---------------------------------------------------------------------------

function buildShippingBlocks(
  shipping: ShippingEntry[],
  rate: number,
): string {
  const parts: string[] = [];
  for (const { countryCode, methods } of shipping) {
    const currency = currencyFor(countryCode);
    for (const m of methods) {
      const price = formatMoney(Number(m.cost ?? 0), rate, currency);
      const { start, end } = parseTransitDays(m.time ?? '');
      const inner: string[] = [
        elem('g:country', countryCode),
        elem('g:service', m.title ?? ''),
        elem('g:price', price),
        elem('g:min_handling_time', 0),
        elem('g:max_handling_time', 5),
      ];
      if (start >= 0 && end >= 0) {
        inner.push(elem('g:min_transit_time', start));
        inner.push(elem('g:max_transit_time', end));
      }
      parts.push(`<g:shipping>\n${inner.join('\n')}\n</g:shipping>`);
    }
  }
  return parts.join('\n');
}

function pickCustomLabel3(
  cl3: ProcessedProduct['item_custom_label_3'],
  feedType: FeedType,
): string | null {
  if (feedType === 'shoptimized') return cl3.shoptimized;
  if (feedType === 'all') return cl3.all || null; // all: skip if falsy
  if (feedType === 'facebook') return cl3.facebook;
  return null;
}

function buildItemXml(
  product: ProcessedProduct,
  variant: ProductVariant,
  opts: XmlFeedOptions,
): string {
  const { feedType, country, currencyRate, shipping } = opts;
  const feedCurrency = currencyFor(country);
  const parts: string[] = ['<item>'];

  parts.push(elem('g:id', variant.item_id));
  parts.push(elem('g:item_group_id', product.item_item_group_id));
  parts.push(elem('g:title', product.item_title, CDATA_FIELDS.has('g:title')));
  parts.push(elem('description', product.item_description, CDATA_FIELDS.has('description')));

  const link = buildLink(product.item_link, variant.item_varID, feedType, country);
  parts.push(elem('link', link, CDATA_FIELDS.has('link')));

  parts.push(elem('g:canonical_link', product.item_canonical_link));

  // --- g:condition -> triggers variant-level block ------------------
  parts.push(elem('g:condition', product.item_condition));
  if (variant.item_size) {
    parts.push(elem('g:size', variant.item_size));
    parts.push(elem('g:size_system', 'UK'));
  }
  if (variant.item_gtin) {
    parts.push(elem('g:gtin', variant.item_gtin));
  }
  if (variant.item_custom_label_1) {
    parts.push(elem('g:custom_label_1', variant.item_custom_label_1));
  }
  parts.push(elem('g:availability', 'in stock'));

  // --- price / GPC / product_type ----------------------------------
  parts.push(elem('g:price', formatMoney(product.item_price, currencyRate, feedCurrency)));
  parts.push(elem('g:google_product_category', product.item_google_product_category));
  for (const pt of product.item_product_type) {
    parts.push(elem('g:product_type', pt, CDATA_FIELDS.has('g:product_type')));
  }

  // --- optional envelope fields ------------------------------------
  if (product.item_image_link) {
    parts.push(elem('g:image_link', product.item_image_link, CDATA_FIELDS.has('g:image_link')));
  }
  if (product.item_sale_price !== undefined) {
    parts.push(
      elem('g:sale_price', formatMoney(product.item_sale_price, currencyRate, feedCurrency)),
    );
  }
  if (product.item_brand) {
    parts.push(elem('g:brand', product.item_brand, CDATA_FIELDS.has('g:brand')));
  }
  if (product.item_age_group) parts.push(elem('g:age_group', product.item_age_group));
  if (product.item_gender) parts.push(elem('g:gender', product.item_gender));
  if (product.item_material) parts.push(elem('g:material', product.item_material));
  if (product.item_color) parts.push(elem('g:color', product.item_color));
  if (product.item_mpn) parts.push(elem('g:mpn', product.item_mpn));

  // --- shipping (one block per country * method) -------------------
  parts.push(buildShippingBlocks(shipping, currencyRate));

  // --- custom labels 0, 2, 3, 4 ------------------------------------
  if (product.item_custom_label_0) {
    parts.push(elem('g:custom_label_0', product.item_custom_label_0));
  }
  parts.push(elem('g:custom_label_2', product.item_custom_label_2));

  // PHP's create_xml_feed.php derives its $fileTypes flags from the
  // output filename. The FIFA file (`*_fifa-world-cup.xml`) matches none
  // of "facebook"/"shoptimized"/"all", so all three flags stay false and
  // PHP's column loop falls through with no emission for cl3. Suppress
  // entirely here to match. Abhinav Gautam
  if (feedType !== 'fifa-world-cup') {
    const cl3 = pickCustomLabel3(product.item_custom_label_3, feedType);
    if (cl3 !== null && cl3 !== '') {
      parts.push(elem('g:custom_label_3', cl3));
    } else if (feedType !== 'all') {
      // PHP writes the tag even when empty for facebook/shoptimized
      // (isset('') === true). Preserved for feed parity.
      parts.push(elem('g:custom_label_3', cl3 ?? ''));
    }
  }

  parts.push(elem('g:custom_label_4', product.item_custom_label_4 ?? ''));

  parts.push('</item>');
  // Meta's Merchant Center rejects feeds where any single line exceeds
  // 5,242,880 bytes. Concatenating every field of every <item> end-to-end
  // produced one giant line for the whole <channel>. Joining with "\n"
  // gives one field per line ("one field per line" is the exact wording
  // of Meta's error message). Each <item> is also followed by a newline
  // when written, so items themselves never share a line. Abhinav Gautam
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate a full XML feed to `filePath`. Returns metadata about the
 * written file (`FeedFileResult`). Uses the temp + rename pattern via
 * `StreamingFileWriter.finalize`, and creates the target directory if
 * necessary.
 */
export async function generateXmlFeed(opts: XmlFeedOptions): Promise<FeedFileResult> {
  const { products, filePath } = opts;
  const tempPath = `${filePath}.tmp`;

  await fileUtils.ensureDir(filePath);
  const writer = new StreamingFileWriter(tempPath);

  // --- preamble ---
  await writer.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  await writer.write(`<rss version="2.0" xmlns:g="${GOOGLE_SHOPPING_NAMESPACE}">\n`);
  await writer.write('<channel>\n');
  await writer.write(elem('title', 'UKSoccershop') + '\n');
  await writer.write(elem('link', WEBSITE_ROOT) + '\n');
  await writer.write('<description></description>\n');

  // --- items ---
  // Each <item> block ends with "\n" so Meta sees one row per item
  // (Merchant Center rejects any line over 5,242,880 bytes). Abhinav Gautam
  let itemCount = 0;
  for (const product of products) {
    if (!product.item_title) continue;
    if (hasDefaultTitleSize(product)) continue;

    for (const variant of product.item_variants) {
      await writer.write(buildItemXml(product, variant, opts) + '\n');
      itemCount++;
    }
  }

  // --- postamble ---
  await writer.write('</channel>\n</rss>\n');

  await writer.finalize(filePath, false);
  const { size } = await stat(filePath);

  return {
    file: path.basename(filePath),
    path: filePath,
    bytes: size,
    itemCount,
    compressed: false,
  };
}
