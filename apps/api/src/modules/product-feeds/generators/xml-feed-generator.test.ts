/**
 * Integration test for the XML feed generator + gzip compressor.
 *
 * Generates a tiny feed with a fixed fixture, validates that:
 *   - the file is valid XML (parses back to an object tree)
 *   - RSS 2.0 structure + Google Shopping namespace are present
 *   - every product variant produced exactly one <item>
 *   - price / sale_price / shipping / custom_label_3 are feed-type aware
 *   - gzip round-trip (compressFile -> gunzip) yields the original bytes
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { XMLParser } from 'fast-xml-parser';

// --- Mocks (must be declared before importing the module under test) ---
// The XML generator transitively imports lib/logger -> config, which
// validates env vars and calls process.exit(1) on failure. For isolated
// unit tests we stub both.
vi.mock('../../../config', () => ({
  config: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
}));
vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  }),
}));

import { generateXmlFeed, type ShippingEntry } from './xml-feed-generator.js';
import { compressAndKeepOriginal, compressFile } from './feed-compressor.js';
import type {
  ProcessedProduct,
  ShippingMethod,
} from '../product-feeds.types.js';

const ukShipping: ShippingMethod[] = [
  {
    id: 'flat',
    module: 'Flat Rates',
    text: 'Flat Rates (Standard Airmail)',
    title: 'Standard Delivery - 2-3',
    cost: '3.99',
    time: '2-3',
  },
  {
    id: 'courier',
    module: 'Courier Shipments',
    text: 'Courier Shipments (DHL Courier)',
    title: 'Express Delivery - 1-2',
    cost: '9.99',
    time: '1-2',
  },
];

function fixtureProducts(): ProcessedProduct[] {
  return [
    {
      item_item_group_id: 'p-100',
      item_variants: [
        {
          item_id: 'SKU-100-S',
          item_item_group_id: 'p-100',
          item_varID: 1000,
          item_size: 'S',
          item_custom_label_1: 'new bestseller',
        },
        {
          item_id: 'SKU-100-M',
          item_item_group_id: 'p-100',
          item_varID: 1001,
          item_size: 'M',
          item_custom_label_1: 'do not use',
        },
      ],
      item_title: 'Arsenal Home Shirt 2025-26',
      item_description: 'The classic red & white.',
      item_link: 'https://www.uksoccershop.com/arsenal-home',
      item_canonical_link: 'https://www.uksoccershop.com/arsenal-home',
      item_condition: 'new',
      item_price: 50,
      item_sale_price: 40,
      item_google_product_category: 212,
      item_product_type: ['Football > European Clubs > English Premier League > Arsenal'],
      item_image_link: 'https://cdn.uksoccershop.com/images/arsenal.jpg',
      item_brand: 'Nike',
      item_age_group: 'adult',
      item_gender: 'male',
      item_material: 'Polyester',
      item_color: 'Red',
      item_mpn: 'ARS-HOME',
      item_shipping: '',
      item_custom_label_0: 'adult',
      item_custom_label_2: 'retro',
      item_custom_label_3: {
        all: 'bestseller-match',
        facebook: 'arsenal',
        shoptimized: 'arsenal',
      },
      item_custom_label_4: '2025-2026',
    },
    {
      // product without item_title should be skipped
      item_item_group_id: 'p-200',
      item_variants: [
        {
          item_id: 'SKIP',
          item_item_group_id: 'p-200',
          item_varID: 2000,
        },
      ],
      item_title: '',
      item_description: '',
      item_link: '',
      item_canonical_link: '',
      item_condition: 'new',
      item_price: 0,
      item_google_product_category: 212,
      item_product_type: [],
      item_shipping: '',
      item_custom_label_2: 'empty',
      item_custom_label_3: { all: '', facebook: '', shoptimized: '' },
      item_custom_label_4: '',
    },
    {
      // product whose first variant is "Default Title" should be skipped
      item_item_group_id: 'p-300',
      item_variants: [
        {
          item_id: 'DEFAULT',
          item_item_group_id: 'p-300',
          item_varID: 3000,
          item_size: 'Default Title',
        },
      ],
      item_title: 'Default Title Product',
      item_description: '',
      item_link: 'https://x/y',
      item_canonical_link: 'https://x/y',
      item_condition: 'new',
      item_price: 10,
      item_google_product_category: 212,
      item_product_type: ['Football > Continent > Team'],
      item_shipping: '',
      item_custom_label_2: 'empty',
      item_custom_label_3: { all: '', facebook: '', shoptimized: '' },
      item_custom_label_4: '',
    },
  ];
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'pf-xml-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('generateXmlFeed', () => {
  it('produces valid XML with RSS 2.0 + Google Shopping namespace', async () => {
    const filePath = path.join(tmpDir, 'UK-United-Kingdom_all.xml');
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    const result = await generateXmlFeed({
      products: fixtureProducts(),
      filePath,
      currencyRate: 1,
      shipping,
      country: 'UK',
      feedType: 'all',
    });

    // Only one valid product out of three -> 2 variants -> 2 items.
    expect(result.itemCount).toBe(2);
    expect(result.bytes).toBeGreaterThan(0);

    const xml = await readFile(filePath, 'utf-8');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</rss>');

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);
    expect(parsed.rss['@_version']).toBe('2.0');
    expect(parsed.rss['@_xmlns:g']).toBe('http://base.google.com/ns/1.0');
    const items = parsed.rss.channel.item;
    expect(Array.isArray(items) ? items.length : 1).toBe(2);

    // Meta Merchant Center rejects feeds with any line > 5,242,880 bytes.
    // Each <item> must end with a newline AND each field within an item
    // must be on its own line (Meta's error: "one field per line"). The
    // longest line in a real feed is bounded by the size of one field.
    const META_LINE_LIMIT = 5_242_880;
    const longestLineBytes = xml
      .split('\n')
      .reduce((max, line) => Math.max(max, Buffer.byteLength(line, 'utf8')), 0);
    expect(longestLineBytes).toBeLessThan(META_LINE_LIMIT);
    expect(xml).toMatch(/<\/item>\n/);
    expect(xml).toMatch(/<g:title>[^\n]*<\/g:title>\n/);
  });

  it('formats prices as "value currency" with 2 decimals and applies currency rate', async () => {
    const filePath = path.join(tmpDir, 'EU-eu-countries_all.xml');
    const shipping: ShippingEntry[] = [{ countryCode: 'DE', methods: ukShipping }];

    await generateXmlFeed({
      products: fixtureProducts(),
      filePath,
      currencyRate: 1.2,
      shipping,
      country: 'EU',
      feedType: 'all',
    });

    const xml = await readFile(filePath, 'utf-8');
    // 50 * 1.2 = 60.00 EUR
    expect(xml).toContain('<g:price>60.00 EUR</g:price>');
    expect(xml).toContain('<g:sale_price>48.00 EUR</g:sale_price>');
  });

  it('builds feed-type-aware link query strings', async () => {
    const products = fixtureProducts();
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    // facebook: ?ovId=<varID>
    const fbPath = path.join(tmpDir, 'UK-United-Kingdom_facebook.xml');
    await generateXmlFeed({
      products, filePath: fbPath, currencyRate: 1, shipping,
      country: 'UK', feedType: 'facebook',
    });
    const fb = await readFile(fbPath, 'utf-8');
    expect(fb).toContain('arsenal-home?ovId=1000');

    // EU: ?currency=EUR&ovId=<varID>
    // Note: `link` is a CDATA-wrapped field so `&` is literal here.
    const euPath = path.join(tmpDir, 'EU-eu-countries_all.xml');
    await generateXmlFeed({
      products, filePath: euPath, currencyRate: 1.1, shipping,
      country: 'EU', feedType: 'all',
    });
    const eu = await readFile(euPath, 'utf-8');
    expect(eu).toContain('arsenal-home?currency=EUR&ovId=1000');

    // Other: ?currency=USD&gcountry=US&ovId=<varID>
    const usPath = path.join(tmpDir, 'US-usa_all.xml');
    await generateXmlFeed({
      products, filePath: usPath, currencyRate: 1.25,
      shipping: [{ countryCode: 'US', methods: ukShipping }],
      country: 'US', feedType: 'all',
    });
    const us = await readFile(usPath, 'utf-8');
    expect(us).toContain('arsenal-home?currency=USD&gcountry=US&ovId=1000');
  });

  it('emits one g:shipping block per country per method', async () => {
    const filePath = path.join(tmpDir, 'EU-multi_all.xml');
    const shipping: ShippingEntry[] = [
      { countryCode: 'DE', methods: [ukShipping[0]] },
      { countryCode: 'FR', methods: [ukShipping[0]] },
      { countryCode: 'IT', methods: [ukShipping[0]] },
    ];

    await generateXmlFeed({
      products: fixtureProducts(), filePath, currencyRate: 1,
      shipping, country: 'EU', feedType: 'all',
    });

    const xml = await readFile(filePath, 'utf-8');
    const shippingCount = (xml.match(/<g:shipping>/g) ?? []).length;
    // 2 variants * 3 countries = 6 shipping blocks
    expect(shippingCount).toBe(6);
    expect(xml).toContain('<g:country>DE</g:country>');
    expect(xml).toContain('<g:country>FR</g:country>');
    expect(xml).toContain('<g:country>IT</g:country>');
  });

  it('picks the feed-type-correct custom_label_3 slot', async () => {
    const products = fixtureProducts();
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    const allPath = path.join(tmpDir, 'cl3-all.xml');
    await generateXmlFeed({ products, filePath: allPath, currencyRate: 1, shipping, country: 'UK', feedType: 'all' });
    const allXml = await readFile(allPath, 'utf-8');
    expect(allXml).toContain('<g:custom_label_3>bestseller-match</g:custom_label_3>');

    const fbPath = path.join(tmpDir, 'cl3-fb.xml');
    await generateXmlFeed({ products, filePath: fbPath, currencyRate: 1, shipping, country: 'UK', feedType: 'facebook' });
    const fbXml = await readFile(fbPath, 'utf-8');
    expect(fbXml).toContain('<g:custom_label_3>arsenal</g:custom_label_3>');

    const shopPath = path.join(tmpDir, 'cl3-shop.xml');
    await generateXmlFeed({ products, filePath: shopPath, currencyRate: 1, shipping, country: 'UK', feedType: 'shoptimized' });
    const shopXml = await readFile(shopPath, 'utf-8');
    expect(shopXml).toContain('<g:custom_label_3>arsenal</g:custom_label_3>');
  });

  it('emits g:size / g:size_system / g:gtin / g:custom_label_1 only when present on variant', async () => {
    const filePath = path.join(tmpDir, 'variant-fields.xml');
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    await generateXmlFeed({
      products: fixtureProducts(), filePath, currencyRate: 1, shipping,
      country: 'UK', feedType: 'all',
    });

    const xml = await readFile(filePath, 'utf-8');
    expect(xml).toContain('<g:size>S</g:size>');
    expect(xml).toContain('<g:size>M</g:size>');
    expect(xml).toContain('<g:size_system>UK</g:size_system>');
    expect(xml).toContain('<g:custom_label_1>new bestseller</g:custom_label_1>');
    expect(xml).toContain('<g:custom_label_1>do not use</g:custom_label_1>');
  });
});

describe('gzip compressor round-trip', () => {
  it('compressAndKeepOriginal keeps the source + produces a readable .gz', async () => {
    const xmlPath = path.join(tmpDir, 'roundtrip-keep.xml');
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    await generateXmlFeed({
      products: fixtureProducts(), filePath: xmlPath, currencyRate: 1, shipping,
      country: 'UK', feedType: 'all',
    });
    const original = await readFile(xmlPath, 'utf-8');

    const gzPath = await compressAndKeepOriginal(xmlPath);
    expect(gzPath).toBe(xmlPath + '.gz');
    // source preserved
    const originalAfter = await readFile(xmlPath, 'utf-8');
    expect(originalAfter).toBe(original);

    // gunzip round-trip
    const decPath = xmlPath + '.out';
    await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(decPath));
    const decoded = await readFile(decPath, 'utf-8');
    expect(decoded).toBe(original);
  });

  it('compressFile deletes the source and leaves only the .gz', async () => {
    const xmlPath = path.join(tmpDir, 'roundtrip-delete.xml');
    const shipping: ShippingEntry[] = [{ countryCode: 'UK', methods: ukShipping }];

    await generateXmlFeed({
      products: fixtureProducts(), filePath: xmlPath, currencyRate: 1, shipping,
      country: 'UK', feedType: 'all',
    });
    const original = await readFile(xmlPath, 'utf-8');

    const gzPath = await compressFile(xmlPath);

    // original gone
    await expect(readFile(xmlPath, 'utf-8')).rejects.toThrow();

    // .gz decodes to original
    const decPath = xmlPath + '.out';
    await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(decPath));
    const decoded = await readFile(decPath, 'utf-8');
    expect(decoded).toBe(original);
  });
});
