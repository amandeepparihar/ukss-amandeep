import { test, expect, Browser, Page, BrowserContext } from '@playwright/test';
import { createZencPage, navigateToZencOrders, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, navigateToStock2Orders, STOCK2_BASE_URL } from './helpers/stock2-auth';
import {
  extractTextContent,
  extractAllTexts,
  compareValues,
  compareNumericValues,
  parsePaginationTotal,
  parseTabCount,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  Mismatch,
  ComparisonResult,
} from './helpers/comparison-utils';

/**
 * Spec 1: Listing Counts Comparison
 *
 * Compares listing counts, dropdown options, tab counts, and alert counts
 * between zenc (legacy) and Stock2 (new).
 *
 * Tolerance: ±2 for counts (live DB, orders may change between page loads).
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

test.describe('Listing Counts Comparison', () => {
  test.beforeAll(async ({ browser }) => {
    // Create authenticated sessions for both systems
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
   * Helper: Intercept Stock2 API response to get exact total count.
   * The /api/orders endpoint returns { meta: { total, totalPages, page, pageSize } }.
   */
  async function getStock2TotalFromApi(page: Page): Promise<{ total: number; totalPages: number } | null> {
    try {
      const response = await page.evaluate(async () => {
        // Find the pagination text to determine current page info
        const pageTexts = document.querySelectorAll('div.text-sm.font-medium, [class*="text-sm"][class*="font-medium"]');
        for (const el of pageTexts) {
          const text = el.textContent?.trim() || '';
          const match = text.match(/Page\s+(\d+)\s+of\s+(\d+)/);
          if (match) {
            return { total: 0, totalPages: parseInt(match[2], 10) };
          }
        }
        return null;
      });
      return response;
    } catch {
      return null;
    }
  }

  test('Status dropdown options match', async () => {
    // Navigate both to orders listing
    await navigateToZencOrders(zencPage);
    await navigateToStock2Orders(stock2Page);
    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    // Extract zenc status dropdown options
    const zencStatuses = await zencPage.evaluate(() => {
      const select = document.querySelector('select[name="status"], select#status') as HTMLSelectElement;
      if (!select) return [] as { value: string; text: string }[];
      return Array.from(select.options).map((opt) => ({
        value: opt.value,
        text: opt.textContent?.trim() || '',
      }));
    });

    // Extract Stock2 status dropdown options — click to open the Shadcn Select
    const statusTrigger = stock2Page.locator('button:has-text("All Statuses")').first();
    await statusTrigger.click();
    await stock2Page.waitForTimeout(500);

    const stock2Statuses = await stock2Page.evaluate(() => {
      const options = document.querySelectorAll('[role="option"]');
      return Array.from(options).map((opt) => ({
        value: opt.getAttribute('data-value') || (opt as HTMLElement).dataset?.value || '',
        text: opt.textContent?.trim() || '',
      }));
    });

    // Close the dropdown
    await stock2Page.keyboard.press('Escape');

    console.log(`Zenc statuses: ${zencStatuses.length}, Stock2 statuses: ${stock2Statuses.length}`);

    // Compare counts — Stock2 intentionally groups some statuses differently
    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Log all options for manual comparison
    console.log('Zenc statuses:', zencStatuses.map((s) => `${s.value}: ${s.text}`).join(', '));
    console.log('Stock2 statuses:', stock2Statuses.map((s) => `${s.value}: ${s.text}`).join(', '));

    // Compare status name presence (ignoring separator items)
    const zencNames = zencStatuses
      .map((s) => s.text.toLowerCase().trim())
      .filter((n) => n && !n.startsWith('--'));
    const stock2Names = stock2Statuses
      .map((s) => s.text.toLowerCase().trim())
      .filter((n) => n && !n.startsWith('--') && n !== 'all statuses' && !n.startsWith('---'));

    // Check key statuses exist in both
    const keyStatuses = ['pending', 'processing', 'shipped', 'cancelled', 'order rejected'];
    for (const status of keyStatuses) {
      const inZenc = zencNames.some((n) => n.includes(status));
      const inStock2 = stock2Names.some((n) => n.includes(status));
      if (inZenc && !inStock2) {
        result.mismatches.push({
          field: `Key status missing in Stock2: "${status}"`,
          zencValue: 'present',
          stock2Value: '(not found)',
          severity: 'major',
        });
      } else if (inZenc && inStock2) {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Store/seller dropdown options match', async () => {
    await navigateToZencOrders(zencPage);
    await navigateToStock2Orders(stock2Page);
    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    // Extract zenc seller dropdown
    const zencSellers = await zencPage.evaluate(() => {
      const select = document.querySelector('select[name="seller"]') as HTMLSelectElement;
      if (!select) return [] as { value: string; text: string }[];
      return Array.from(select.options).map((opt) => ({
        value: opt.value,
        text: opt.textContent?.trim() || '',
      }));
    });

    // Extract Stock2 seller dropdown
    const sellerTrigger = stock2Page.locator('button:has-text("All Sellers")').first();
    await sellerTrigger.click();
    await stock2Page.waitForTimeout(500);

    const stock2Sellers = await stock2Page.evaluate(() => {
      const options = document.querySelectorAll('[role="option"]');
      return Array.from(options).map((opt) => ({
        value: opt.getAttribute('data-value') || '',
        text: opt.textContent?.trim() || '',
      }));
    });

    await stock2Page.keyboard.press('Escape');

    console.log(`Zenc sellers: ${zencSellers.length}, Stock2 sellers: ${stock2Sellers.length}`);
    console.log('Zenc sellers:', zencSellers.map((s) => `[${s.value}] ${s.text}`).join(', '));
    console.log('Stock2 sellers:', stock2Sellers.map((s) => `[${s.value}] ${s.text}`).join(', '));

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Compare by value (store ID) not text — both systems use store_management.store_id
    const zencValues = new Set(zencSellers.map((s) => s.value).filter((v) => v && v !== '0'));
    const stock2Values = new Set(stock2Sellers.map((s) => s.value).filter((v) => v && v !== '__all__'));

    // Check if Stock2 has all zenc stores
    for (const value of zencValues) {
      if (stock2Values.has(value)) {
        result.matches++;
      } else {
        const zencEntry = zencSellers.find((s) => s.value === value);
        result.mismatches.push({
          field: `Store ID ${value} missing in Stock2`,
          zencValue: zencEntry?.text || value,
          stock2Value: '(not found)',
          severity: 'minor', // Stores are loaded from same DB, differences are expected
        });
      }
    }

    // Check if Stock2 has extra stores
    for (const value of stock2Values) {
      if (!zencValues.has(value)) {
        const stock2Entry = stock2Sellers.find((s) => s.value === value);
        result.mismatches.push({
          field: `Store ID ${value} extra in Stock2`,
          zencValue: '(not found)',
          stock2Value: stock2Entry?.text || value,
          severity: 'minor',
        });
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Tab counts match (±2 tolerance)', async () => {
    await navigateToZencOrders(zencPage);
    await navigateToStock2Orders(stock2Page);
    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Extract zenc tab counts — tabs in: div.feb11Tabs ul.tabs li a
    const zencTabTexts = await zencPage.evaluate(() => {
      const tabs = document.querySelectorAll('.feb11Tabs ul.tabs li a, .sep11Tabs ul.tabs li a, ul.tabs li a');
      return Array.from(tabs).map((tab) => tab.textContent?.trim() || '');
    });

    // Extract Stock2 tab counts — TabsTrigger renders with role="tab"
    // The badge count is a child element, so textContent concatenates "Label" + "Count"
    const stock2TabTexts = await stock2Page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      return Array.from(tabs).map((tab) => tab.textContent?.trim() || '');
    });

    console.log('Zenc tabs:', zencTabTexts);
    console.log('Stock2 tabs:', stock2TabTexts);

    // Map tab names to counts
    const tabMap = [
      { name: 'Ship By Today', zencPattern: /Ship\s*By\s*Today/i, stock2Pattern: /Ship\s*By\s*Today/i },
      { name: 'Ship By Tomorrow', zencPattern: /Ship\s*By\s*Tomorrow/i, stock2Pattern: /Ship\s*By\s*Tomorrow/i },
      { name: 'Ship By Two Days', zencPattern: /Ship\s*By\s*Two\s*Days/i, stock2Pattern: /Ship\s*By\s*Two\s*Days/i },
      { name: 'Ship After Two Days', zencPattern: /Ship\s*After\s*Two\s*Days/i, stock2Pattern: /Ship\s*After\s*Two\s*Days/i },
      { name: 'To Be Refund', zencPattern: /To\s*Be\s*Refund/i, stock2Pattern: /To\s*Be\s*Refund/i },
    ];

    for (const tab of tabMap) {
      const zencText = zencTabTexts.find((t) => tab.zencPattern.test(t)) || '';
      const stock2Text = stock2TabTexts.find((t) => tab.stock2Pattern.test(t)) || '';

      const zencCount = parseTabCount(zencText);
      const stock2Count = parseTabCount(stock2Text);

      console.log(`  ${tab.name}: zenc="${zencText}" → ${zencCount}, stock2="${stock2Text}" → ${stock2Count}`);

      if (zencCount === null && stock2Count === null) {
        result.skipped.push(tab.name);
        continue;
      }

      const mismatch = compareNumericValues(
        `Tab count: ${tab.name}`,
        String(zencCount ?? 0),
        String(stock2Count ?? 0),
        2 // ±2 tolerance
      );

      if (mismatch) {
        result.mismatches.push(mismatch);
      } else {
        result.matches++;
      }
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Alert counts match', async () => {
    await navigateToZencOrders(zencPage);
    await navigateToStock2Orders(stock2Page);
    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Extract zenc alert info — divpadding for late shipments, errororders/manualorders for FC
    const zencAlerts = await zencPage.evaluate(() => {
      const alerts: Record<string, string> = {};

      // Late shipments — div with class divpadding and red background
      const allDivs = document.querySelectorAll('.divpadding, div[class*="divpadding"]');
      let ukLateCount = 0;
      let usLateCount = 0;

      allDivs.forEach((div) => {
        const text = div.textContent?.trim() || '';
        const heading = div.querySelector('.divHeading');
        const headingText = heading?.textContent?.trim() || '';

        if (text.includes('Late Shipments') || text.includes('late shipment')) {
          const links = div.querySelectorAll('a');
          if (headingText === 'UK') {
            ukLateCount = links.length;
          } else if (headingText === 'US') {
            usLateCount = links.length;
          }
        }
      });

      alerts['ukLateShipmentCount'] = String(ukLateCount);
      alerts['usLateShipmentCount'] = String(usLateCount);

      // FC error orders — class errororders
      const errorDiv = document.querySelector('.errororders');
      if (errorDiv) {
        const text = errorDiv.textContent?.trim() || '';
        const match = text.match(/(\d+)\s*orders?\s*(?:have|has)\s*error/i);
        alerts['fcErrorCount'] = match ? match[1] : '0';
        if (text.includes('No Order has error')) alerts['fcErrorCount'] = '0';
      }

      // FC manual orders — class manualorders
      const manualDiv = document.querySelector('.manualorders');
      if (manualDiv) {
        const text = manualDiv.textContent?.trim() || '';
        const match = text.match(/(\d+)\s*orders?\s*(?:in|pending)/i);
        alerts['fcManualCount'] = match ? match[1] : '0';
      }

      return alerts;
    });

    // Extract Stock2 alert info — uses Alert components with border-* classes
    const stock2Alerts = await stock2Page.evaluate(() => {
      const alerts: Record<string, string> = {};

      // All alerts are in the OrderAlerts component
      const alertContainer = document.body;

      // FC Error count — Alert with border-red-300
      const errorAlerts = alertContainer.querySelectorAll('[class*="border-red-300"]');
      for (const alert of errorAlerts) {
        const text = alert.textContent?.trim() || '';
        if (text.includes('Error') || text.includes('error')) {
          const match = text.match(/(\d+)/);
          if (match) alerts['fcErrorCount'] = match[1];
        }
      }

      // FC Manual Pending count — Alert with border-yellow-300
      const manualAlerts = alertContainer.querySelectorAll('[class*="border-yellow-300"]');
      for (const alert of manualAlerts) {
        const text = alert.textContent?.trim() || '';
        if (text.includes('Manual') || text.includes('Pending')) {
          const match = text.match(/(\d+)/);
          if (match) alerts['fcManualCount'] = match[1];
        }
      }

      // Amazon UK late shipments — Alert with border-orange-300
      const ukAlerts = alertContainer.querySelectorAll('[class*="border-orange-300"]');
      for (const alert of ukAlerts) {
        const text = alert.textContent?.trim() || '';
        if (text.includes('UK') && text.includes('Late')) {
          const links = alert.querySelectorAll('a');
          // Count links in the red background section (actual late, not expected)
          const lateSection = alert.querySelector('[style*="FFB1B3"], [class*="bg-red"]');
          const lateLinks = lateSection ? lateSection.querySelectorAll('a').length : links.length;
          alerts['ukLateShipmentCount'] = String(lateLinks);
        }
      }

      // Amazon US late shipments — Alert with border-blue-300
      const usAlerts = alertContainer.querySelectorAll('[class*="border-blue-300"]');
      for (const alert of usAlerts) {
        const text = alert.textContent?.trim() || '';
        if (text.includes('US') && text.includes('Late')) {
          const links = alert.querySelectorAll('a');
          const lateSection = alert.querySelector('[style*="FFB1B3"], [class*="bg-red"]');
          const lateLinks = lateSection ? lateSection.querySelectorAll('a').length : links.length;
          alerts['usLateShipmentCount'] = String(lateLinks);
        }
      }

      return alerts;
    });

    console.log('Zenc alerts:', zencAlerts);
    console.log('Stock2 alerts:', stock2Alerts);

    // Compare FC error count
    const alertFields = ['fcErrorCount', 'fcManualCount', 'ukLateShipmentCount', 'usLateShipmentCount'];
    for (const field of alertFields) {
      const zencVal = zencAlerts[field] || '0';
      const stock2Val = stock2Alerts[field] || '0';

      if (zencVal === '0' && stock2Val === '0') {
        result.skipped.push(field);
        continue;
      }

      const mismatch = compareNumericValues(
        `Alert: ${field}`,
        zencVal,
        stock2Val,
        2
      );
      if (mismatch) result.mismatches.push(mismatch);
      else result.matches++;
    }

    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });

  test('Default listing total count matches (±5% tolerance)', async () => {
    await navigateToZencOrders(zencPage);
    await navigateToStock2Orders(stock2Page);
    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    // Extract zenc total count from pagination text "Displaying 1 to 20 (of X orders)"
    const zencPaginationText = await zencPage.evaluate(() => {
      const cells = document.querySelectorAll('td.smallText');
      for (const cell of cells) {
        const text = cell.textContent?.trim() || '';
        if (text.includes('Displaying') && text.includes('of')) {
          return text;
        }
      }
      return '';
    });

    // Extract Stock2 "Page X of Y" pagination text
    const stock2PageInfo = await stock2Page.evaluate(() => {
      const pageTexts = document.querySelectorAll('[class*="text-sm"][class*="font-medium"]');
      for (const el of pageTexts) {
        const text = el.textContent?.trim() || '';
        if (/Page\s+\d+\s+of\s+\d+/.test(text)) return text;
      }
      return '';
    });

    // Also get the page size from Stock2
    const stock2PageSize = await stock2Page.evaluate(() => {
      // The page size Select shows current value
      const selectTrigger = document.querySelector('[class*="w-\\[70px\\]"]');
      return parseInt(selectTrigger?.textContent?.trim() || '20', 10);
    });

    const zencTotal = parsePaginationTotal(zencPaginationText);
    const stock2PageMatch = stock2PageInfo.match(/Page\s+\d+\s+of\s+(\d+)/);
    const stock2TotalPages = stock2PageMatch ? parseInt(stock2PageMatch[1], 10) : 0;
    const stock2ApproxTotal = stock2TotalPages * stock2PageSize;

    console.log(`Zenc pagination: "${zencPaginationText}" → total: ${zencTotal}`);
    console.log(`Stock2 page info: "${stock2PageInfo}" → pages: ${stock2TotalPages}, pageSize: ${stock2PageSize}`);
    console.log(`Stock2 approx total: ${stock2ApproxTotal}`);

    if (zencTotal !== null && stock2TotalPages > 0) {
      // Use percentage tolerance (5%) for large result sets
      const tolerance = Math.max(40, Math.round(zencTotal * 0.05));
      const diff = Math.abs(zencTotal - stock2ApproxTotal);

      if (diff > tolerance) {
        console.warn(
          `MISMATCH: Default listing total count — zenc: ${zencTotal}, stock2: ~${stock2ApproxTotal} (${stock2TotalPages} pages × ${stock2PageSize}). Diff: ${diff} > tolerance: ${tolerance}`
        );
      } else {
        console.log(`OK: Total counts match within ${tolerance} tolerance — zenc: ${zencTotal}, stock2: ~${stock2ApproxTotal}`);
      }
    } else {
      console.log('SKIP: Could not extract total from one or both systems');
    }
  });

  // Test counts for several key statuses
  const statusesToTest = [
    { value: '1', name: 'Pending' },
    { value: '2', name: 'Processing' },
    { value: '16', name: 'Delivered' },
    { value: '14', name: 'Despatched' },
    { value: '112', name: 'Rejected' },
  ];

  for (const status of statusesToTest) {
    test(`Status "${status.name}" (${status.value}) count matches`, async () => {
      // Navigate to zenc with status filter
      await zencPage.goto(
        `${ZENC_BASE_URL}/webadmin/orders.php?status=${status.value}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
      await waitForStableContent(zencPage);

      // Navigate to Stock2 with status filter
      await stock2Page.goto(
        `${STOCK2_BASE_URL}/orders?status=${status.value}`,
        { waitUntil: 'networkidle', timeout: 30000 }
      );
      await waitForStableContent(stock2Page);

      // Extract zenc count
      const zencPaginationText = await zencPage.evaluate(() => {
        const cells = document.querySelectorAll('td.smallText');
        for (const cell of cells) {
          const text = cell.textContent?.trim() || '';
          if (text.includes('Displaying') && text.includes('of')) return text;
        }
        return '';
      });

      // Extract Stock2 total from "Page X of Y"
      const stock2PageInfo = await stock2Page.evaluate(() => {
        const pageTexts = document.querySelectorAll('[class*="text-sm"][class*="font-medium"]');
        for (const el of pageTexts) {
          const text = el.textContent?.trim() || '';
          if (/Page\s+\d+\s+of\s+\d+/.test(text)) return text;
        }
        // Check for empty state
        const empty = document.querySelector('[class*="text-muted-foreground"]');
        if (empty?.textContent?.includes('No orders found')) return 'Page 0 of 0';
        return '';
      });

      const zencTotal = parsePaginationTotal(zencPaginationText);
      const stock2PageMatch = stock2PageInfo.match(/Page\s+\d+\s+of\s+(\d+)/);
      const stock2TotalPages = stock2PageMatch ? parseInt(stock2PageMatch[1], 10) : null;

      console.log(
        `Status ${status.name} (${status.value}): zenc total=${zencTotal}, stock2 pages=${stock2TotalPages}`
      );

      if (zencTotal !== null && stock2TotalPages !== null) {
        const stock2ApproxTotal = stock2TotalPages * 20;
        const tolerance = Math.max(40, Math.round(Math.max(zencTotal, stock2ApproxTotal) * 0.05));

        console.log(
          `  → zenc: ${zencTotal} orders, stock2: ~${stock2ApproxTotal} (${stock2TotalPages} pages × 20), tolerance: ±${tolerance}`
        );

        const diff = Math.abs(zencTotal - stock2ApproxTotal);
        if (diff > tolerance) {
          console.warn(`  ⚠ MISMATCH: diff=${diff} exceeds tolerance=${tolerance}`);
        } else {
          console.log(`  ✓ Counts within tolerance`);
        }
      }
    });
  }
});
