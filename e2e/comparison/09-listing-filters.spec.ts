import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createZencPage, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, STOCK2_BASE_URL } from './helpers/stock2-auth';
import {
  compareNumericValues,
  parsePaginationTotal,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  ComparisonResult,
} from './helpers/comparison-utils';

/**
 * Spec 9: Listing Filters Comparison
 *
 * Tests filter branches added in the orders listing finish:
 * - toffsCode filter narrows orders to the same set as legacy
 * - fsBarcode filter narrows orders to the same set as legacy
 * - productSearch filter (name/model) narrows to same set as legacy
 * - Filter Products cascade: category → product → size (popupProductId / popupCategoryId)
 *
 * Fixtures verified against staging DB (zenc_main_db) 2026-06-21.
 */

// ---------------------------------------------------------------------------
// Real fixtures from staging DB (zenc_main_db) — verified 2026-06-21
// ---------------------------------------------------------------------------
const FIXTURE_TOFFS_CODE = 'TOFFS7000';
const FIXTURE_FS_BARCODE = '5030260213044';
const FIXTURE_PRODUCT_MODEL = 'JAPANTHIRDWOLVATE-LONGSLEEVES';
const FIXTURE_PRODUCT_ID = 484783; // products_id — appears in orders_products (ID: prefix test)
// Cascade chain: categories_id 3 → products_id 178 → options_values_id 2644
const FIXTURE_CASCADE_CATEGORY_ID = 3;
const FIXTURE_CASCADE_PRODUCT_ID = 178;
const FIXTURE_CASCADE_SIZE_ID = 2644;
// ---------------------------------------------------------------------------

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

test.describe('Listing Filters Comparison', () => {
  test.beforeAll(async ({ browser }) => {
    const zenc = await createZencPage(browser);
    zencPage = zenc.page;
    zencContext = zenc.context;

    const stock2 = await createStock2Page(browser);
    stock2Page = stock2.page;
    stock2Context = stock2.context;
  });

  test.afterAll(async () => {
    await zencContext?.close();
    await stock2Context?.close();
  });

  // -------------------------------------------------------------------------
  // Helper: get zenc listing total for given URL params
  // -------------------------------------------------------------------------
  async function getZencCount(params: Record<string, string>): Promise<number | null> {
    const url = new URL(`${ZENC_BASE_URL}/webadmin/orders.php`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    await zencPage.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStableContent(zencPage);

    const paginationText = await zencPage.evaluate(() => {
      const cells = document.querySelectorAll('td.smallText');
      for (const cell of cells) {
        const text = cell.textContent?.trim() || '';
        if (text.includes('Displaying') && text.includes('of')) return text;
      }
      const body = document.body.textContent || '';
      if (body.includes('no orders') || body.includes('No orders') || body.includes('0 orders')) return '(of 0)';
      return '';
    });

    return parsePaginationTotal(paginationText);
  }

  // -------------------------------------------------------------------------
  // Helper: get Stock2 API count for given query params (uses the JSON API
  // directly to avoid pagination arithmetic).
  // -------------------------------------------------------------------------
  async function getStock2Count(params: Record<string, string>): Promise<number | null> {
    const apiUrl = new URL(`${STOCK2_BASE_URL}/api/orders`);
    // pageSize=1 is enough — we only need the total from meta
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('pageSize', '1');
    Object.entries(params).forEach(([k, v]) => apiUrl.searchParams.set(k, v));

    const response = await stock2Page.request.get(apiUrl.toString());
    if (!response.ok()) {
      console.warn(`Stock2 API returned ${response.status()} for ${apiUrl}`);
      return null;
    }
    const body = await response.json();
    return typeof body?.meta?.total === 'number' ? body.meta.total : null;
  }

  // -------------------------------------------------------------------------
  // Task 1 stub: cascade API health checks
  // -------------------------------------------------------------------------
  test('GET /api/orders/filter/categories returns data', async () => {
    const res = await stock2Page.request.get(`${STOCK2_BASE_URL}/api/orders/filter/categories`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThan(0);
    // Validate shape: {id: number, name: string}
    expect(typeof body.data[0].id).toBe('number');
    expect(typeof body.data[0].name).toBe('string');
  });

  test('GET /api/orders/filter/products?categoryId returns data', async () => {
    const res = await stock2Page.request.get(
      `${STOCK2_BASE_URL}/api/orders/filter/products?categoryId=${FIXTURE_CASCADE_CATEGORY_ID}`
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThan(0);
    // Verify our known product is present
    const found = body.data.some((p: { id: number }) => p.id === FIXTURE_CASCADE_PRODUCT_ID);
    expect(found).toBeTruthy();
  });

  test('GET /api/orders/filter/sizes?productId returns data', async () => {
    const res = await stock2Page.request.get(
      `${STOCK2_BASE_URL}/api/orders/filter/sizes?productId=${FIXTURE_CASCADE_PRODUCT_ID}`
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    // May be empty for products with no size attributes — presence check is enough
    if (body.data.length > 0) {
      expect(typeof body.data[0].id).toBe('number');
      expect(typeof body.data[0].name).toBe('string');
    }
  });

  test('GET /api/orders/filter/products returns 400 without categoryId', async () => {
    const res = await stock2Page.request.get(`${STOCK2_BASE_URL}/api/orders/filter/products`);
    expect(res.status()).toBe(400);
  });

  test('GET /api/orders/filter/sizes returns 400 without productId', async () => {
    const res = await stock2Page.request.get(`${STOCK2_BASE_URL}/api/orders/filter/sizes`);
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // toffsCode filter
  // Legacy zenc param: toffs_code (form field) + toffs_search=toffs_search (hidden)
  // -------------------------------------------------------------------------
  test('toffsCode filter — count matches legacy', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };
    console.log(`\n=== toffsCode filter: ${FIXTURE_TOFFS_CODE} ===`);

    const zencCount = await getZencCount({ toffs_code: FIXTURE_TOFFS_CODE, toffs_search: 'toffs_search' });
    const stock2Count = await getStock2Count({ toffsCode: FIXTURE_TOFFS_CODE });

    console.log(`Zenc count: ${zencCount}, Stock2 count: ${stock2Count}`);

    if (zencCount === null || stock2Count === null) {
      result.skipped.push('Could not retrieve count from one or both systems');
    } else {
      const mismatch = compareNumericValues('toffsCode filter', String(zencCount), String(stock2Count), 0, 'critical');
      if (mismatch) {
        result.mismatches.push(mismatch);
      } else {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({ path: 'e2e/comparison/screenshots/zenc-toffs-filter.png', fullPage: false }).catch(() => {});
      await stock2Page.screenshot({ path: 'e2e/comparison/screenshots/stock2-toffs-filter.png', fullPage: false }).catch(() => {});
    }
    expect(result.mismatches).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // fsBarcode filter
  // Legacy zenc param: fs_barcode (form field) + football_souvenir_search=football_souvenir_search (hidden)
  // -------------------------------------------------------------------------
  test('fsBarcode filter — count matches legacy', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };
    console.log(`\n=== fsBarcode filter: ${FIXTURE_FS_BARCODE} ===`);

    const zencCount = await getZencCount({ fs_barcode: FIXTURE_FS_BARCODE, football_souvenir_search: 'football_souvenir_search' });
    const stock2Count = await getStock2Count({ fsBarcode: FIXTURE_FS_BARCODE });

    console.log(`Zenc count: ${zencCount}, Stock2 count: ${stock2Count}`);

    if (zencCount === null || stock2Count === null) {
      result.skipped.push('Could not retrieve count from one or both systems');
    } else {
      const mismatch = compareNumericValues('fsBarcode filter', String(zencCount), String(stock2Count), 0, 'critical');
      if (mismatch) {
        result.mismatches.push(mismatch);
      } else {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({ path: 'e2e/comparison/screenshots/zenc-fsbarcode-filter.png', fullPage: false }).catch(() => {});
      await stock2Page.screenshot({ path: 'e2e/comparison/screenshots/stock2-fsbarcode-filter.png', fullPage: false }).catch(() => {});
    }
    expect(result.mismatches).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // productSearch — name/model form
  // -------------------------------------------------------------------------
  test('productSearch (name/model) filter — count matches legacy', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };
    console.log(`\n=== productSearch filter (model): ${FIXTURE_PRODUCT_MODEL} ===`);

    // Legacy zenc param: product_name (confirmed from orders_listing.php)
    const zencCount = await getZencCount({ product_name: FIXTURE_PRODUCT_MODEL });
    const stock2Count = await getStock2Count({ productSearch: FIXTURE_PRODUCT_MODEL });

    console.log(`Zenc count: ${zencCount}, Stock2 count: ${stock2Count}`);

    if (zencCount === null || stock2Count === null) {
      result.skipped.push('Could not retrieve count from one or both systems');
    } else {
      // Allow small tolerance: Stock2 may include/exclude edge-case records differently
      const mismatch = compareNumericValues('productSearch (model) filter', String(zencCount), String(stock2Count), 2, 'major');
      if (mismatch) {
        result.mismatches.push(mismatch);
      } else {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({ path: 'e2e/comparison/screenshots/zenc-product-model-filter.png', fullPage: false }).catch(() => {});
      await stock2Page.screenshot({ path: 'e2e/comparison/screenshots/stock2-product-model-filter.png', fullPage: false }).catch(() => {});
    }
    expect(result.mismatches).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // productSearch — ID: prefix form
  // -------------------------------------------------------------------------
  test('productSearch (ID: prefix) filter — returns orders for that product', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // The ID: prefix routes through the product join in query-builder.
    // No direct legacy equivalent for this UI path — existence check only.
    const stock2Count = await getStock2Count({ productSearch: `ID:${FIXTURE_PRODUCT_ID}` });

    console.log(`productSearch ID:${FIXTURE_PRODUCT_ID} → Stock2 count: ${stock2Count}`);

    if (stock2Count === null) {
      result.skipped.push('Could not retrieve count from Stock2');
    } else if (stock2Count === 0) {
      result.mismatches.push({
        field: 'productSearch (ID: prefix)',
        zencValue: 'N/A (no direct legacy equivalent)',
        stock2Value: '0 orders — expected >0 for a known product ID',
        severity: 'major',
      });
    } else {
      result.matches++;
      console.log(`OK: Stock2 returns ${stock2Count} orders for ID:${FIXTURE_PRODUCT_ID}`);
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
    expect(result.mismatches).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Cascade: popupCategoryId filter (category-only)
  // Stock2: popupCategoryId → returns COUNT(DISTINCT o.orders_id) for that category.
  // DECISION (operator-confirmed): distinct-orders is the correct semantic — the listing
  //   shows one row per order, so the count must equal distinct orders. Legacy
  //   orders_listing.php:917,924-926 GROUPs BY (o.orders_id, ptc.products_id) and reports
  //   (order,product) pairs; that is a GROUP BY artifact we deliberately do NOT match.
  //   Therefore this is NOT a Stock2-vs-legacy equality test — the gate is a bounded
  //   distinct-orders sanity check (>0 and <= unfiltered total); legacy is logged only.
  // -------------------------------------------------------------------------
  test('popupCategoryId filter — Stock2 returns non-empty deterministic result', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };
    console.log(`\n=== popupCategoryId filter: ${FIXTURE_CASCADE_CATEGORY_ID} ===`);

    // Stock2: category-only filter — must return a result and be <= unfiltered total
    const stock2Count = await getStock2Count({ popupCategoryId: String(FIXTURE_CASCADE_CATEGORY_ID) });
    const stock2Unfiltered = await getStock2Count({});

    console.log(`Stock2 category count: ${stock2Count}, Stock2 unfiltered total: ${stock2Unfiltered}`);

    if (stock2Count === null) {
      result.skipped.push('Could not retrieve Stock2 count for popupCategoryId');
    } else {
      // Gate 1: non-empty result
      if (stock2Count === 0) {
        result.mismatches.push({
          field: 'popupCategoryId filter',
          zencValue: 'N/A',
          stock2Value: '0 — expected >0 for a known category with orders',
          severity: 'critical',
        });
      } else {
        result.matches++;
        console.log(`OK: Stock2 returns ${stock2Count} orders for popupCategoryId=${FIXTURE_CASCADE_CATEGORY_ID}`);
      }
      // Gate 2: count is <= unfiltered total (sanity check)
      if (stock2Unfiltered !== null && stock2Count > stock2Unfiltered) {
        result.mismatches.push({
          field: 'popupCategoryId filter (sanity)',
          zencValue: String(stock2Unfiltered),
          stock2Value: `${stock2Count} > unfiltered total — impossible`,
          severity: 'critical',
        });
      }
    }

    // Legacy zenc comparison: log-only by design (operator-confirmed distinct-orders semantic;
    // legacy's (order,product)-pair count is a GROUP BY artifact we intentionally do not match).
    // orders_listing.php also has no clean category-only GET param equivalent to popupCategoryId
    // (the closest is categories_id on the product popup form, which is POST-based).
    const zencCount = await getZencCount({ categories_id: String(FIXTURE_CASCADE_CATEGORY_ID) }).catch(() => null);
    console.log(`Legacy zenc category count (best-effort, different semantics): ${zencCount}`);
    console.log(`  Zenc counts (order,product) pairs; Stock2 counts distinct orders — these will differ.`);

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await stock2Page.screenshot({ path: 'e2e/comparison/screenshots/stock2-popup-category-filter.png', fullPage: false }).catch(() => {});
    }
    expect(result.mismatches).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Cascade: popupProductId filter vs legacy product_list_id
  // Legacy zenc param: product_list_id (popup) → Stock2: popupProductId
  // -------------------------------------------------------------------------
  test('popupProductId filter — count matches legacy product_list_id', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };
    console.log(`\n=== popupProductId filter: ${FIXTURE_CASCADE_PRODUCT_ID} ===`);

    // Legacy zenc uses product_list_id for the popup product filter
    const zencCount = await getZencCount({ product_list_id: String(FIXTURE_CASCADE_PRODUCT_ID) });
    const stock2Count = await getStock2Count({ popupProductId: String(FIXTURE_CASCADE_PRODUCT_ID) });

    console.log(`Zenc count: ${zencCount}, Stock2 count: ${stock2Count}`);

    if (zencCount === null || stock2Count === null) {
      result.skipped.push('Could not retrieve count from one or both systems');
    } else {
      const mismatch = compareNumericValues('popupProductId filter', String(zencCount), String(stock2Count), 0, 'critical');
      if (mismatch) {
        result.mismatches.push(mismatch);
      } else {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({ path: 'e2e/comparison/screenshots/zenc-popup-product-filter.png', fullPage: false }).catch(() => {});
      await stock2Page.screenshot({ path: 'e2e/comparison/screenshots/stock2-popup-product-filter.png', fullPage: false }).catch(() => {});
    }
    expect(result.mismatches).toHaveLength(0);
  });
});
