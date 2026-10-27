import { test, expect, Browser, Page, BrowserContext } from '@playwright/test';
import { createZencPage, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, STOCK2_BASE_URL } from './helpers/stock2-auth';
import {
  compareValues,
  compareNumericValues,
  normalizeColor,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  ComparisonResult,
  Mismatch,
} from './helpers/comparison-utils';

/**
 * Spec 2: Listing Row Data Comparison
 *
 * Strategy: Navigate both systems to the same status filter, extract visible
 * rows from each, find overlapping order IDs, and compare matched rows.
 *
 * Tests all visible columns + row background color.
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

interface ListingRow {
  orderId: string;
  paymentMethod: string;
  shippingMethod: string;
  customer: string;
  companyName: string;
  shipDate: string;
  orderTotal: string;
  datePurchased: string;
  status: string;
  orderType: string;
  siftScore: string;
  riskScore: string;
  rowBgColor: string;
}

test.describe('Row Data Comparison', () => {
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
   * Extract all visible listing rows from zenc.
   * Zenc uses: tr.dataTableRow* with td.dataTableContent / td.dataTableContent-first
   * Column order: OrderID, Payment+Shipping, Customer, ShipDate, Total, Purchased, Status, [Refund], Type, Sift, Risk
   */
  async function extractZencRows(): Promise<ListingRow[]> {
    return await zencPage.evaluate(() => {
      const rows: ListingRow[] = [];
      // Match all data table row variants (dataTableRow, dataTableRowAmazon, dataTableRowEbay, etc.)
      const tableRows = document.querySelectorAll('tr[class*="dataTableRow"]');

      for (const row of tableRows) {
        const cells = row.querySelectorAll('td.dataTableContent, td.dataTableContent-first');
        if (cells.length < 7) continue;

        // First cell: order ID (right-aligned, numeric, possibly with EX suffix)
        const firstCellText = (cells[0]?.textContent?.trim() || '').replace(/\s+/g, '');
        const orderIdMatch = firstCellText.match(/(\d+(?:EX)?)/);
        if (!orderIdMatch) continue;

        // Second cell: Payment method + Shipping method (separated by line break)
        const paymentCell = cells[1];
        const paymentParts = paymentCell?.innerHTML?.split(/<br\s*\/?>/i) || [];
        const paymentMethod = paymentParts[0]?.replace(/<[^>]*>/g, '').trim() || '';
        const shippingMethod = paymentParts[1]?.replace(/<[^>]*>/g, '').trim() || '';

        // Third cell: Customer name
        const customerText = (cells[2]?.textContent?.trim() || '').replace(/\s+/g, ' ');

        rows.push({
          orderId: orderIdMatch[1],
          paymentMethod,
          shippingMethod,
          customer: customerText,
          companyName: '', // Not separately available in zenc listing
          shipDate: cells[3]?.textContent?.trim() || '',
          orderTotal: cells[4]?.textContent?.trim() || '',
          datePurchased: cells[5]?.textContent?.trim() || '',
          status: cells[6]?.textContent?.trim() || '',
          // Cells after status depend on whether refund column is shown
          // Try to get type from cells 7-8
          orderType: cells[8]?.textContent?.trim() || cells[7]?.textContent?.trim() || '',
          siftScore: (cells.length > 9 ? cells[9]?.textContent?.trim() : cells[8]?.textContent?.trim()) || '',
          riskScore: (cells.length > 10 ? cells[10]?.textContent?.trim() : cells[9]?.textContent?.trim()) || '',
          rowBgColor: window.getComputedStyle(row).backgroundColor || '',
        });
      }

      return rows;
    });
  }

  /**
   * Extract all visible listing rows from Stock2.
   * Stock2 uses: table > tbody > tr with standard td cells.
   * Column order: OrderID (link), Payment+Shipping, Customer, ShipDate, Total, Purchased, Status, [Refund], Type, Sift, Risk, [Touchpoints], Actions
   */
  async function extractStock2Rows(): Promise<ListingRow[]> {
    return await stock2Page.evaluate(() => {
      const rows: ListingRow[] = [];
      const tableRows = document.querySelectorAll('table tbody tr');

      for (const row of tableRows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) continue;

        // Find the order ID link — it's an <a> element pointing to /orders/{id}
        const orderLink = row.querySelector('a[href^="/orders/"]');
        if (!orderLink) continue;

        const orderId = orderLink.textContent?.trim() || '';
        if (!orderId || !/^\d+/.test(orderId)) continue;

        // Find the index of the order ID cell
        let idCellIdx = 0;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].querySelector('a[href^="/orders/"]')) {
            idCellIdx = i;
            break;
          }
        }

        // Extract text from each cell after the ID cell
        const getText = (offset: number) => {
          const cell = cells[idCellIdx + offset];
          return cell?.textContent?.trim().replace(/\s+/g, ' ') || '';
        };

        // Payment cell contains payment + shipping stacked (two divs)
        const paymentCell = cells[idCellIdx + 1];
        const paymentDivs = paymentCell?.querySelectorAll('div');
        const paymentMethod = paymentDivs?.[0]?.textContent?.trim() || '';
        const shippingMethod = paymentDivs?.[1]?.textContent?.trim() || '';

        // Customer cell — has link and company name div
        const customerCell = cells[idCellIdx + 2];
        const customerLink = customerCell?.querySelector('a');
        const customerName = customerLink?.textContent?.trim() || '';
        const companyDiv = customerCell?.querySelector('[class*="text-muted-foreground"]');
        const companyName = companyDiv?.textContent?.trim() || '';

        // Status cell — contains Badge component
        const statusCell = cells[idCellIdx + 6];
        const statusBadge = statusCell?.querySelector('[class*="badge"], [class*="Badge"]');
        const status = statusBadge?.textContent?.trim() || statusCell?.textContent?.trim() || '';

        // Order total
        const totalCell = cells[idCellIdx + 4];
        const orderTotal = totalCell?.textContent?.trim() || '';

        rows.push({
          orderId,
          paymentMethod,
          shippingMethod,
          customer: customerName,
          companyName,
          shipDate: getText(3), // Ship Date
          orderTotal,
          datePurchased: getText(5), // Date Purchased
          status,
          orderType: getText(7), // Type (may shift if Refund column is shown)
          siftScore: getText(8),
          riskScore: getText(9),
          rowBgColor: (row as HTMLElement).style.backgroundColor || window.getComputedStyle(row).backgroundColor || '',
        });
      }

      return rows;
    });
  }

  /**
   * Compare matching rows between two row sets.
   */
  function compareMatchingRows(
    zencRows: ListingRow[],
    stock2Rows: ListingRow[],
    statusLabel: string
  ): ComparisonResult {
    const result: ComparisonResult = { matches: 0, mismatches: [], skipped: [] };

    // Build a map of Stock2 rows by order ID
    const stock2Map = new Map<string, ListingRow>();
    for (const row of stock2Rows) {
      const cleanId = row.orderId.replace('EX', '');
      stock2Map.set(cleanId, row);
    }

    let matchedCount = 0;

    for (const zencRow of zencRows) {
      const cleanId = zencRow.orderId.replace('EX', '');
      const stock2Row = stock2Map.get(cleanId);

      if (!stock2Row) continue;
      matchedCount++;

      const prefix = `[${statusLabel}] Order #${cleanId}`;

      // Compare fields
      const fields: Array<{
        field: string;
        zencVal: string;
        stock2Val: string;
        severity: Mismatch['severity'];
        isNumeric?: boolean;
        tolerance?: number;
      }> = [
        { field: `${prefix} — orderId`, zencVal: zencRow.orderId, stock2Val: stock2Row.orderId, severity: 'critical' },
        { field: `${prefix} — customer`, zencVal: zencRow.customer, stock2Val: stock2Row.customer, severity: 'major' },
        { field: `${prefix} — orderTotal`, zencVal: zencRow.orderTotal, stock2Val: stock2Row.orderTotal, severity: 'critical', isNumeric: true, tolerance: 0.01 },
        { field: `${prefix} — status`, zencVal: zencRow.status, stock2Val: stock2Row.status, severity: 'critical' },
        { field: `${prefix} — orderType`, zencVal: zencRow.orderType, stock2Val: stock2Row.orderType, severity: 'major' },
        { field: `${prefix} — paymentMethod`, zencVal: zencRow.paymentMethod, stock2Val: stock2Row.paymentMethod, severity: 'minor' },
        { field: `${prefix} — shipDate`, zencVal: zencRow.shipDate, stock2Val: stock2Row.shipDate, severity: 'major' },
        { field: `${prefix} — datePurchased`, zencVal: zencRow.datePurchased, stock2Val: stock2Row.datePurchased, severity: 'major' },
      ];

      for (const { field, zencVal, stock2Val, severity, isNumeric, tolerance } of fields) {
        if (!zencVal && !stock2Val) {
          result.skipped.push(field);
          continue;
        }

        let mismatch: Mismatch | null;
        if (isNumeric) {
          mismatch = compareNumericValues(field, zencVal, stock2Val, tolerance, severity);
        } else {
          mismatch = compareValues(field, zencVal, stock2Val, severity);
        }

        if (mismatch) result.mismatches.push(mismatch);
        else result.matches++;
      }

      // Compare row background color
      const zencColor = normalizeColor(zencRow.rowBgColor);
      const stock2Color = normalizeColor(stock2Row.rowBgColor);
      if (zencColor && stock2Color && zencColor !== stock2Color) {
        result.mismatches.push({
          field: `${prefix} — rowBgColor`,
          zencValue: zencRow.rowBgColor,
          stock2Value: stock2Row.rowBgColor,
          severity: 'minor',
        });
      } else if (zencColor === stock2Color) {
        result.matches++;
      }
    }

    console.log(`  ${matchedCount} orders found in both systems for status "${statusLabel}"`);
    return result;
  }

  // Test listing rows for several key statuses
  const statusesToTest = [
    { value: '2', name: 'Processing', zencParam: 'status=2', stock2Param: 'status=2' },
    { value: '5', name: 'Shipped', zencParam: 'status=5', stock2Param: 'status=5' },
    { value: '112', name: 'Rejected', zencParam: 'status=112', stock2Param: 'status=112' },
    { value: '23', name: 'Awaiting Delivery', zencParam: 'status=23', stock2Param: 'status=23' },
  ];

  for (const status of statusesToTest) {
    test(`Status "${status.name}" (${status.value}) — row data matches`, async () => {
      test.setTimeout(90000);

      console.log(`\n=== Comparing listing rows for status ${status.value}: ${status.name} ===`);

      // Navigate both to the same status filter
      await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php?${status.zencParam}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await stock2Page.goto(`${STOCK2_BASE_URL}/orders?${status.stock2Param}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await waitForStableContent(zencPage);
      await waitForStableContent(stock2Page);

      // Extract visible rows from both
      const zencRows = await extractZencRows();
      const stock2Rows = await extractStock2Rows();

      console.log(`  Zenc rows: ${zencRows.length}, Stock2 rows: ${stock2Rows.length}`);

      if (zencRows.length > 0) {
        console.log(`  Zenc first row: #${zencRows[0].orderId} | ${zencRows[0].customer} | ${zencRows[0].orderTotal} | ${zencRows[0].status}`);
      }
      if (stock2Rows.length > 0) {
        console.log(`  Stock2 first row: #${stock2Rows[0].orderId} | ${stock2Rows[0].customer} | ${stock2Rows[0].orderTotal} | ${stock2Rows[0].status}`);
      }

      // Compare matching rows
      const result = compareMatchingRows(zencRows, stock2Rows, status.name);

      logComparisonResult(result);
      if (result.mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      }
    });
  }

  test('Default listing (all orders) — first page rows compare', async () => {
    test.setTimeout(90000);

    console.log(`\n=== Comparing default listing rows ===`);

    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await stock2Page.goto(`${STOCK2_BASE_URL}/orders`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await waitForStableContent(zencPage);
    await waitForStableContent(stock2Page);

    const zencRows = await extractZencRows();
    const stock2Rows = await extractStock2Rows();

    console.log(`  Zenc rows: ${zencRows.length}, Stock2 rows: ${stock2Rows.length}`);

    // Log first 3 rows from each for comparison
    for (let i = 0; i < Math.min(3, zencRows.length); i++) {
      console.log(`  Zenc [${i}]: #${zencRows[i].orderId} | ${zencRows[i].customer} | ${zencRows[i].orderTotal} | ${zencRows[i].status}`);
    }
    for (let i = 0; i < Math.min(3, stock2Rows.length); i++) {
      console.log(`  Stock2 [${i}]: #${stock2Rows[i].orderId} | ${stock2Rows[i].customer} | ${stock2Rows[i].orderTotal} | ${stock2Rows[i].status}`);
    }

    const result = compareMatchingRows(zencRows, stock2Rows, 'Default');
    logComparisonResult(result);
    if (result.mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }
  });
});
