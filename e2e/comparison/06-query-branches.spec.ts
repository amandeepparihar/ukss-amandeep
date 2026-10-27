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
 * Spec 6: Special Query Branches Comparison
 *
 * Tests special status codes and query branches that use different
 * SQL logic between zenc and Stock2:
 * - Status 200 (delivered today)
 * - Status 101 (FC despatched not shipped)
 * - Status 102 (FC undespatched)
 * - Status 1224 (refund review)
 * - Status 1225 (delivery review)
 * - Marketplace search with known order ID
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

test.describe('Special Query Branches Comparison', () => {
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

  /**
   * Helper: get zenc listing count for a status.
   */
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
      // Also check for "0 results" type messages
      const body = document.body.textContent || '';
      if (body.includes('no orders') || body.includes('No orders') || body.includes('0 orders')) return '(of 0)';
      return '';
    });

    return parsePaginationTotal(paginationText);
  }

  /**
   * Helper: get Stock2 page count for a status.
   */
  async function getStock2PageInfo(params: Record<string, string>): Promise<{
    pages: number;
    isEmpty: boolean;
  }> {
    const url = new URL(`${STOCK2_BASE_URL}/orders`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    await stock2Page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30000 });
    await waitForStableContent(stock2Page);

    return await stock2Page.evaluate(() => {
      // Check for "Page X of Y"
      const pageTexts = document.querySelectorAll('div.text-sm.font-medium, [class*="text-sm"][class*="font-medium"]');
      for (const el of pageTexts) {
        const text = el.textContent?.trim() || '';
        const match = text.match(/Page\s+(\d+)\s+of\s+(\d+)/);
        if (match) {
          return { pages: parseInt(match[2], 10), isEmpty: false };
        }
      }

      // Check for empty state
      const emptyState = document.querySelector('[class*="text-muted-foreground"]');
      if (emptyState?.textContent?.includes('No orders found')) {
        return { pages: 0, isEmpty: true };
      }

      return { pages: 0, isEmpty: false };
    });
  }

  const specialStatuses = [
    {
      value: '200',
      name: 'Delivered Today (Orders Being Picked Before 3PM)',
      description: 'Uses subquery for delivery status within today',
    },
    {
      value: '101',
      name: 'FC Despatched Not Shipped',
      description: 'FC orders despatched but not yet shipped',
    },
    {
      value: '102',
      name: 'FC Undespatched',
      description: 'FC orders that are undespatched',
    },
    {
      value: '1224',
      name: 'Refund Review',
      description: 'Orders flagged for refund review',
    },
    {
      value: '1225',
      name: 'Delivery Review',
      description: 'Orders flagged for delivery review',
    },
  ];

  for (const status of specialStatuses) {
    test(`Special status ${status.value} (${status.name}) — count matches`, async () => {
      test.setTimeout(60000);

      const result: ComparisonResult = {
        matches: 0,
        mismatches: [],
        skipped: [],
      };

      console.log(`\n=== Testing Special Status ${status.value}: ${status.name} ===`);

      const zencCount = await getZencCount({ status: status.value });
      const stock2Info = await getStock2PageInfo({ status: status.value });

      console.log(`Zenc count: ${zencCount}`);
      console.log(`Stock2 pages: ${stock2Info.pages}, isEmpty: ${stock2Info.isEmpty}`);

      if (zencCount === null) {
        result.skipped.push(`Zenc count not available for status ${status.value}`);
      } else if (stock2Info.pages === 0 && !stock2Info.isEmpty) {
        result.skipped.push(`Stock2 page info not available for status ${status.value}`);
      } else {
        // Compare: Stock2 uses 20 per page, so total ≈ pages × 20
        const stock2ApproxTotal = stock2Info.isEmpty ? 0 : stock2Info.pages * 20;
        const tolerance = 20; // ±1 page worth due to timing

        // For empty/small result sets, compare more precisely
        if (zencCount <= 20 && stock2Info.pages <= 1) {
          // Both should either be empty or have results on a single page
          if ((zencCount === 0 && !stock2Info.isEmpty) || (zencCount > 0 && stock2Info.isEmpty)) {
            result.mismatches.push({
              field: `Status ${status.value} (${status.name})`,
              zencValue: `${zencCount} orders`,
              stock2Value: stock2Info.isEmpty ? '0 orders' : `${stock2Info.pages} pages`,
              severity: 'critical',
            });
          } else {
            result.matches++;
          }
        } else {
          const mismatch = compareNumericValues(
            `Status ${status.value} (${status.name})`,
            String(zencCount),
            String(stock2ApproxTotal),
            tolerance,
            'major'
          );

          if (mismatch) {
            result.mismatches.push(mismatch);
          } else {
            result.matches++;
          }
        }
      }

      logComparisonResult(result);
      if (result.mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));

        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-status-${status.value}.png`,
          fullPage: false,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-status-${status.value}.png`,
          fullPage: false,
        }).catch(() => {});
      }
    });
  }

  test('Marketplace search — Amazon order returns matching result', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // We know order 1768953 is an Amazon order — let's get its amazon_orders_id
    // Navigate to the order edit page on zenc to get the amazon_orders_id
    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php?oID=1768953&action=edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForStableContent(zencPage);

    const amazonOrderId = await zencPage.evaluate(() => {
      const spans = document.querySelectorAll('td.main strong span');
      for (const span of spans) {
        const text = span.textContent?.trim() || '';
        if (text.includes('Amazon Order Id')) {
          const parent = span.closest('strong');
          return parent?.textContent?.replace(text, '').trim() || '';
        }
      }
      return '';
    });

    console.log(`Amazon Order ID for order 1768953: ${amazonOrderId}`);

    if (!amazonOrderId) {
      result.skipped.push('Could not find Amazon Order ID on zenc');
      logComparisonResult(result);
      return;
    }

    // Search for this Amazon order ID on zenc
    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForStableContent(zencPage);

    // Select Amazon marketplace and search
    const zencMarketplaceSelect = zencPage.locator('select[name="select_marketplace"]');
    if (await zencMarketplaceSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zencMarketplaceSelect.selectOption('amazon');
      await zencPage.waitForTimeout(1000);

      const amazonInput = zencPage.locator('input[name="amazon_order_id"]');
      if (await amazonInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await amazonInput.fill(amazonOrderId);
        // Submit the form
        const form = zencPage.locator('input[name="amazon_order_id"]').locator('xpath=ancestor::form');
        await form.locator('input[type="submit"]').first().click().catch(async () => {
          await amazonInput.press('Enter');
        });
        await waitForStableContent(zencPage);
      }
    }

    // Check if order 1768953 appears in zenc results
    const zencFoundOrder = await zencPage.evaluate(() => {
      const rows = document.querySelectorAll('tr.dataTableRow, tr[class^="dataTableRow"]');
      for (const row of rows) {
        if (row.textContent?.includes('1768953')) return true;
      }
      return false;
    });

    // Search on Stock2
    await stock2Page.goto(`${STOCK2_BASE_URL}/orders?marketplace=amazon&marketplaceSearchValue=${encodeURIComponent(amazonOrderId)}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await waitForStableContent(stock2Page);

    const stock2FoundOrder = await stock2Page.evaluate(() => {
      const links = document.querySelectorAll('table tbody td a');
      for (const link of links) {
        if (link.textContent?.includes('1768953')) return true;
      }
      return false;
    });

    console.log(`Zenc found order 1768953: ${zencFoundOrder}`);
    console.log(`Stock2 found order 1768953: ${stock2FoundOrder}`);

    if (zencFoundOrder && stock2FoundOrder) {
      result.matches++;
      console.log('OK: Both systems find the Amazon order via marketplace search');
    } else if (zencFoundOrder && !stock2FoundOrder) {
      result.mismatches.push({
        field: 'Marketplace search (Amazon)',
        zencValue: 'Found order 1768953',
        stock2Value: 'Order NOT found',
        severity: 'critical',
      });
    } else if (!zencFoundOrder && stock2FoundOrder) {
      result.mismatches.push({
        field: 'Marketplace search (Amazon)',
        zencValue: 'Order NOT found',
        stock2Value: 'Found order 1768953',
        severity: 'critical',
      });
    } else {
      result.skipped.push('Neither system found the order via marketplace search');
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Fruugo marketplace search returns matching result', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Get Fruugo order ID from zenc for order 1586835
    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php?oID=1586835&action=edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForStableContent(zencPage);

    const fruugoOrderId = await zencPage.evaluate(() => {
      const spans = document.querySelectorAll('td.main strong span');
      for (const span of spans) {
        const text = span.textContent?.trim() || '';
        if (text.includes('Fruugo Order Id')) {
          const parent = span.closest('strong');
          return parent?.textContent?.replace(text, '').trim() || '';
        }
      }
      return '';
    });

    console.log(`Fruugo Order ID for order 1586835: ${fruugoOrderId}`);

    if (!fruugoOrderId) {
      result.skipped.push('Could not find Fruugo Order ID');
      logComparisonResult(result);
      return;
    }

    // Search on Stock2
    await stock2Page.goto(
      `${STOCK2_BASE_URL}/orders?marketplace=fruugo&marketplaceSearchValue=${encodeURIComponent(fruugoOrderId)}`,
      { waitUntil: 'networkidle', timeout: 30000 }
    );
    await waitForStableContent(stock2Page);

    const stock2Found = await stock2Page.evaluate(() => {
      const links = document.querySelectorAll('table tbody td a');
      for (const link of links) {
        if (link.textContent?.includes('1586835')) return true;
      }
      return false;
    });

    if (stock2Found) {
      result.matches++;
      console.log('OK: Stock2 finds Fruugo order via marketplace search');
    } else {
      result.mismatches.push({
        field: 'Marketplace search (Fruugo)',
        zencValue: `Fruugo ID: ${fruugoOrderId}`,
        stock2Value: 'Order NOT found',
        severity: 'critical',
      });
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Sort by order status changed', async () => {
    test.setTimeout(60000);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Get first 5 order IDs when sorted by status changed on zenc
    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php?hid_sort_by=order_status_changed`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForStableContent(zencPage);

    const zencFirstOrders = await zencPage.evaluate(() => {
      const orderIds: string[] = [];
      const rows = document.querySelectorAll('tr.dataTableRow, tr[class^="dataTableRow"]');
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const firstCell = rows[i].querySelector('td.dataTableContent-first, td.dataTableContent');
        const text = firstCell?.textContent?.trim().replace('EX', '') || '';
        if (text && /^\d+$/.test(text)) orderIds.push(text);
      }
      return orderIds;
    });

    // Get first 5 from Stock2 with same sort
    await stock2Page.goto(`${STOCK2_BASE_URL}/orders?sortBy=statusChanged`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await waitForStableContent(stock2Page);

    const stock2FirstOrders = await stock2Page.evaluate(() => {
      const orderIds: string[] = [];
      const links = document.querySelectorAll('table tbody tr td a[href^="/orders/"]');
      for (let i = 0; i < Math.min(5, links.length); i++) {
        const text = links[i].textContent?.trim().replace('EX', '') || '';
        if (text && /^\d+$/.test(text)) orderIds.push(text);
      }
      return orderIds;
    });

    console.log('Zenc first 5 (status changed sort):', zencFirstOrders);
    console.log('Stock2 first 5 (status changed sort):', stock2FirstOrders);

    // Compare — first few orders should match if the sort is working correctly
    // Allow some tolerance since orders may change status between page loads
    let matchCount = 0;
    for (let i = 0; i < Math.min(zencFirstOrders.length, stock2FirstOrders.length); i++) {
      if (zencFirstOrders[i] === stock2FirstOrders[i]) matchCount++;
    }

    if (matchCount >= 3) {
      result.matches++;
      console.log(`OK: ${matchCount}/5 orders match in sort-by-status-changed order`);
    } else {
      result.mismatches.push({
        field: 'Sort by status changed — first 5 orders',
        zencValue: zencFirstOrders.join(', '),
        stock2Value: stock2FirstOrders.join(', '),
        severity: 'major',
      });
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });
});
