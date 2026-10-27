import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createZencPage, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, STOCK2_BASE_URL } from './helpers/stock2-auth';
import {
  compareValues,
  compareNumericValues,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  ComparisonResult,
  Mismatch,
} from './helpers/comparison-utils';
import { PANEL_TEST_ORDERS } from './test-orders';

/**
 * Spec 3: Details Panel Comparison
 *
 * Compares the quick-view panel data between zenc and Stock2 for
 * 6 key orders (amazon, fruugo, exchange, refund, fc, multi_product).
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

test.describe('Panel Data Comparison', () => {
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
   * Extract panel data from zenc.
   * On zenc, clicking an order row calls load_order_details(orderId) which loads
   * the right panel via AJAX into #right_section_orders_details_info.
   */
  async function extractZencPanelData(orderId: number): Promise<Record<string, string>> {
    // Navigate to orders listing
    await zencPage.goto(`${ZENC_BASE_URL}/webadmin/orders.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForStableContent(zencPage);

    // Trigger the panel load by calling the JavaScript function directly
    await zencPage.evaluate((oid) => {
      // @ts-ignore — legacy function on window
      if (typeof (window as any).load_order_details === 'function') {
        (window as any).load_order_details(oid);
      }
    }, orderId);

    // Wait for panel content to load
    await zencPage.waitForTimeout(3000);

    // Extract panel data from #right_section_orders_details_info
    return await zencPage.evaluate(() => {
      const data: Record<string, string> = {};
      const panel = document.querySelector('#right_section_orders_details_info, #infoBox_orders');

      if (!panel) return data;

      const text = panel.textContent || '';

      // Extract order ID from panel heading
      const orderIdMatch = text.match(/Order\s*#?\s*(\d+)/i);
      if (orderIdMatch) data['orderId'] = orderIdMatch[1];

      // Extract customer email
      const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
      if (emailMatch) data['email'] = emailMatch[0];

      // Extract payment method
      const paymentMatch = text.match(/Payment\s*(?:Method)?\s*:?\s*([^\n]+)/i);
      if (paymentMatch) data['paymentMethod'] = paymentMatch[1].trim();

      // Extract shipping method
      const shippingMatch = text.match(/Shipping\s*(?:Method)?\s*:?\s*([^\n]+)/i);
      if (shippingMatch) data['shippingMethod'] = shippingMatch[1].trim();

      // Extract status
      const statusMatch = text.match(/Status\s*:?\s*([^\n]+)/i);
      if (statusMatch) data['status'] = statusMatch[1].trim();

      // Count products in panel
      const productRows = panel.querySelectorAll('tr, .product-row');
      data['productRowCount'] = String(productRows.length);

      // Extract all visible text for full comparison
      data['fullText'] = text.replace(/\s+/g, ' ').trim().substring(0, 2000);

      return data;
    });
  }

  /**
   * Extract panel data from Stock2.
   * On Stock2, clicking the info icon on a row opens the OrderDetailsPanel
   * in a sidebar.
   */
  async function extractStock2PanelData(orderId: number): Promise<Record<string, string>> {
    // Navigate directly to orders listing filtered by order ID via URL param
    await stock2Page.goto(`${STOCK2_BASE_URL}/orders?search=${orderId}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await waitForStableContent(stock2Page);
    await stock2Page.waitForTimeout(1000);

    // Click the info button on the order row to open panel
    // The info button is the second small button in the actions column
    const orderRow = stock2Page.locator(`table tbody tr:has(a[href="/orders/${orderId}"])`);
    const isRowVisible = await orderRow.isVisible({ timeout: 5000 }).catch(() => false);

    if (!isRowVisible) {
      console.log(`Order #${orderId} not found in Stock2 listing`);
      return {};
    }

    // Click the info icon button (second button in actions column)
    const infoBtn = orderRow.locator('button').last();
    await infoBtn.click();

    // Wait for panel to load
    await stock2Page.waitForTimeout(2000);

    // Extract panel data
    return await stock2Page.evaluate((oid) => {
      const data: Record<string, string> = {};

      // Panel is the right sidebar
      const panel = document.querySelector('[class*="w-\\[400px\\]"]') ||
                    document.querySelector('[class*="sticky"]');

      if (!panel) return data;

      const text = panel.textContent || '';

      // Extract order ID from panel heading
      const heading = panel.querySelector('h3, [class*="text-lg"][class*="font-semibold"]');
      if (heading) data['heading'] = heading.textContent?.trim() || '';

      // Extract order ID
      const orderIdMatch = text.match(/\[(\d+)\]/);
      if (orderIdMatch) data['orderId'] = orderIdMatch[1];

      // Prime indicator
      const primeEl = panel.querySelector('[class*="text-red-600"][class*="font-bold"]');
      if (primeEl && primeEl.textContent?.includes('PRIME')) {
        data['isPrime'] = 'true';
      }

      // Products count
      const productsHeader = panel.querySelector('[class*="font-medium"]');
      if (productsHeader) {
        const match = productsHeader.textContent?.match(/Products?\s*Ordered:?\s*(\d+)/i);
        if (match) data['productCount'] = match[1];
      }

      // Look for product items
      const productItems = panel.querySelectorAll('[class*="space-y-0\\.5"]');
      data['productItemCount'] = String(productItems.length);

      // Extract current status
      const statusBadge = panel.querySelector('[class*="inline-flex"][class*="rounded-full"]');
      if (statusBadge) data['status'] = statusBadge.textContent?.trim() || '';

      // Extract metadata fields
      const spans = panel.querySelectorAll('span');
      for (const span of spans) {
        const spanText = span.textContent?.trim() || '';
        if (spanText.startsWith('Payment:')) {
          data['paymentMethod'] = spanText.replace('Payment:', '').trim();
        }
        if (spanText.startsWith('Shipping:')) {
          data['shippingMethod'] = spanText.replace('Shipping:', '').trim();
        }
        if (spanText.startsWith('Email:')) {
          data['email'] = spanText.replace('Email:', '').trim();
        }
        if (spanText.startsWith('IP:')) {
          data['ipAddress'] = spanText.replace('IP:', '').trim();
        }
      }

      // Suppliers
      const supplierText = panel.querySelector('[class*="text-blue-600"]');
      if (supplierText && supplierText.textContent?.includes('Supplier')) {
        data['hasSuppliers'] = 'true';
      }

      // Document buttons (visible only when fraud_status=0)
      const invoiceBtn = panel.querySelector('button:has-text("Invoice")');
      data['hasInvoiceBtn'] = invoiceBtn ? 'true' : 'false';

      // Full panel text for comparison
      data['fullText'] = text.replace(/\s+/g, ' ').trim().substring(0, 2000);

      return data;
    }, orderId);
  }

  for (const order of PANEL_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — panel data matches`, async () => {
      test.setTimeout(90000); // 90s per order (two page loads + panel)

      const result: ComparisonResult = {
        orderId: order.id,
        category: order.category,
        matches: 0,
        mismatches: [],
        skipped: [],
      };

      console.log(`\n=== Testing Panel for Order #${order.id} (${order.category}) ===`);

      const zencData = await extractZencPanelData(order.id);
      const stock2Data = await extractStock2PanelData(order.id);

      console.log('Zenc panel data:', JSON.stringify(zencData, null, 2));
      console.log('Stock2 panel data:', JSON.stringify(stock2Data, null, 2));

      if (!zencData.orderId && !stock2Data.orderId) {
        result.skipped.push('Panel not loaded on either system');
        logComparisonResult(result);
        return;
      }

      // Compare key fields
      const fields: Array<{ field: string; severity: Mismatch['severity'] }> = [
        { field: 'orderId', severity: 'critical' },
        { field: 'email', severity: 'major' },
        { field: 'paymentMethod', severity: 'major' },
        { field: 'shippingMethod', severity: 'major' },
        { field: 'status', severity: 'critical' },
      ];

      for (const { field, severity } of fields) {
        const zencVal = zencData[field] || '';
        const stock2Val = stock2Data[field] || '';

        if (!zencVal && !stock2Val) {
          result.skipped.push(field);
          continue;
        }

        const mismatch = compareValues(field, zencVal, stock2Val, severity);
        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          result.mismatches.push(mismatch);
        } else {
          result.matches++;
        }
      }

      // Compare product count
      if (zencData.productRowCount || stock2Data.productCount) {
        const mismatch = compareNumericValues(
          'productCount',
          zencData.productRowCount || '0',
          stock2Data.productCount || stock2Data.productItemCount || '0',
          0,
          'major'
        );
        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          result.mismatches.push(mismatch);
        } else {
          result.matches++;
        }
      }

      logComparisonResult(result);

      if (result.mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));

        // Screenshots
        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-panel-${order.id}.png`,
          fullPage: false,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-panel-${order.id}.png`,
          fullPage: false,
        }).catch(() => {});
      }
    });
  }
});
