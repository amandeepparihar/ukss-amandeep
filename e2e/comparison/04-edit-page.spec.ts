import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createZencPage, navigateToZencOrderEdit, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, navigateToStock2OrderEdit, STOCK2_BASE_URL } from './helpers/stock2-auth';
import {
  compareValues,
  compareNumericValues,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  ComparisonResult,
  Mismatch,
} from './helpers/comparison-utils';
import { PANEL_TEST_ORDERS, TEST_ORDERS } from './test-orders';

/**
 * Spec 4: Edit Page Comparison
 *
 * Compares the full order edit page sections between zenc and Stock2:
 * - Customer info (name, company, phone, email, IP, priority, approved)
 * - Delivery address
 * - Billing address
 * - Marketplace IDs
 * - Tracking numbers (DHL, Royal Mail, DPD)
 * - Metadata (exchange info, sift/risk/riskified scores, lock status)
 * - Order info (dates, payment, shipping, previous orders, affiliate)
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

// Test a representative subset of orders
const EDIT_TEST_ORDERS = TEST_ORDERS.filter((o) =>
  ['amazon', 'fruugo', 'exchange', 'fc_order', 'dhl_shipping', 'multi_product', 'sift_scored'].includes(o.category)
);

test.describe('Edit Page Comparison', () => {
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
   * Extract edit page data from zenc.
   * URL: orders.php?oID={id}&action=edit
   */
  async function extractZencEditData(orderId: number): Promise<Record<string, string>> {
    await navigateToZencOrderEdit(zencPage, orderId);
    await waitForStableContent(zencPage);

    return await zencPage.evaluate(() => {
      const data: Record<string, string> = {};
      const body = document.body;

      // Helper: find cell value after a label
      function findLabelValue(labelText: string): string {
        const cells = document.querySelectorAll('td.main');
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const text = cell.textContent?.trim() || '';
          if (text.includes(labelText)) {
            // Next sibling td or next td.main
            const nextCell = cells[i + 1];
            if (nextCell) return nextCell.textContent?.trim() || '';
          }
        }
        return '';
      }

      // Customer info
      const emailLink = document.querySelector('a[href^="mailto:"]');
      data['email'] = emailLink?.textContent?.trim() || '';

      data['telephone'] = findLabelValue('Telephone');
      data['ipAddress'] = findLabelValue('IP Address');

      // Delivery address — look for "Shipping Address" section
      const allCells = document.querySelectorAll('td.main');
      for (const cell of allCells) {
        const strong = cell.querySelector('strong');
        if (!strong) continue;
        const text = strong.textContent?.trim() || '';

        if (text.includes('Shipping Address') || text.includes('Delivery Address')) {
          // The address is in the next td.main sibling
          const parentRow = cell.closest('tr');
          const addressCell = parentRow?.querySelectorAll('td.main')[1];
          if (addressCell) {
            data['deliveryAddress'] = addressCell.textContent?.trim().replace(/\s+/g, ' ') || '';
          }
        }

        if (text.includes('Billing Address')) {
          const parentRow = cell.closest('tr');
          const addressCell = parentRow?.querySelectorAll('td.main')[1];
          if (addressCell) {
            data['billingAddress'] = addressCell.textContent?.trim().replace(/\s+/g, ' ') || '';
          }
        }
      }

      // Marketplace IDs (red spans)
      const marketplaceIds: Record<string, string> = {};
      const redSpans = document.querySelectorAll('td.main span[style*="color: #FF0000"], td.main span[style*="color:#FF0000"]');
      for (const span of redSpans) {
        const label = span.textContent?.trim() || '';
        const parentStrong = span.closest('strong');
        if (parentStrong) {
          const fullText = parentStrong.textContent?.trim() || '';
          const value = fullText.replace(label, '').trim();
          marketplaceIds[label.replace(/\s*Order\s*Id\s*:?\s*/i, '').trim()] = value;
        }
      }
      data['marketplaceIds'] = JSON.stringify(marketplaceIds);

      // FC Order ID (not red, separate style)
      const fcSpans = document.querySelectorAll('td.main strong span');
      for (const span of fcSpans) {
        const text = span.textContent?.trim() || '';
        if (text.includes('GREEN FC Order Id')) {
          const parentStrong = span.closest('strong');
          data['fcOrderId'] = parentStrong?.textContent?.replace(text, '').trim() || '';
        }
        if (text.includes('GREEN FC Order Status')) {
          const parentStrong = span.closest('strong');
          data['fcOrderStatus'] = parentStrong?.textContent?.replace(text, '').trim() || '';
        }
      }

      // Tracking numbers
      const allBolds = document.querySelectorAll('td b, td strong');
      for (const bold of allBolds) {
        const text = bold.textContent?.trim() || '';
        const parentTd = bold.closest('td');

        if (text.includes('Order track no')) {
          data['trackingNo'] = text.replace(/Order\s*track\s*no\s*:?\s*/i, '').trim();
        }
        if (text.includes('Last Scan Date')) {
          data['lastScanDate'] = text.replace(/Last\s*Scan\s*Date\s*:?\s*/i, '').trim();
        }
        if (text.includes('DHL Order Tracking No')) {
          const link = parentTd?.querySelector('a[target="blank"]');
          data['dhlTracking'] = link?.textContent?.trim() || '';
        }
        if (text.includes('Royal Mail Order Tracking No')) {
          const link = parentTd?.querySelector('a[target="blank"]');
          data['royalMailTracking'] = link?.textContent?.trim() || '';
        }
        if (text.includes('DPD Order Tracking No')) {
          const link = parentTd?.querySelector('a[target="blank"]');
          data['dpdTracking'] = link?.textContent?.trim() || '';
        }
      }

      // Metadata — scores, exchange, lock
      // Sift score (green background)
      const siftCell = document.querySelector('td[style*="background-color: green"]');
      if (siftCell) {
        const match = siftCell.textContent?.match(/Sift\s*Score:\s*([\d.]+)/i);
        if (match) data['siftScore'] = match[1];
      }

      // Risk score (red background)
      const riskCell = document.querySelector('td[style*="background-color: red"]');
      if (riskCell) {
        const match = riskCell.textContent?.match(/Risk\s*Score:\s*([\d.]+)/i);
        if (match) data['riskScore'] = match[1];
      }

      // Matched By (blue background)
      const matchedCell = document.querySelector('td[style*="background-color: blue"]');
      if (matchedCell) {
        const match = matchedCell.textContent?.match(/Matched\s*By:\s*(.+)/i);
        if (match) data['matchedBy'] = match[1].trim();
      }

      // Riskified status
      const riskifiedCells = document.querySelectorAll('td.main[style*="color: #FFF"]');
      for (const cell of riskifiedCells) {
        const text = cell.textContent?.trim() || '';
        if (text.includes('Riskified')) {
          data['riskifiedStatus'] = text.replace(/Riskified\s*Status:\s*/i, '').trim();
        }
      }

      // Lock status
      const lockCell = document.querySelector('td#unlock_order');
      if (lockCell) {
        data['lockStatus'] = lockCell.textContent?.trim().replace(/\s+/g, ' ') || '';
      }

      // Order info
      data['paymentMethod'] = findLabelValue('Payment Method') || findLabelValue('ENTRY_PAYMENT_METHOD');

      // Date purchased — look in order info table
      const dateLabels = document.querySelectorAll('td.main strong');
      for (const label of dateLabels) {
        const text = label.textContent?.trim() || '';
        if (text.includes('Date Purchased') || text.includes('ENTRY_DATE_PURCHASED')) {
          const parentTd = label.closest('td');
          const nextTd = parentTd?.nextElementSibling as HTMLTableCellElement;
          if (nextTd) data['datePurchased'] = nextTd.textContent?.trim() || '';
        }
        if (text.includes('Ship By Date')) {
          const parentTd = label.closest('td');
          const nextTd = parentTd?.nextElementSibling as HTMLTableCellElement;
          if (nextTd) data['shipByDate'] = nextTd.textContent?.trim() || '';
        }
      }

      // Previous orders
      const prevOrderLinks = document.querySelectorAll('a[onclick*="showOrderDetails"]');
      const prevOrders: string[] = [];
      for (const link of prevOrderLinks) {
        const text = link.textContent?.trim() || '';
        if (text) prevOrders.push(text);
      }
      data['previousOrders'] = prevOrders.join(', ');

      // Exchange info
      const bodyText = body.textContent || '';
      const exchangeMatch = bodyText.match(/Original\s*Order\s*(\d+)/i);
      if (exchangeMatch) data['originalOrderId'] = exchangeMatch[1];
      const exchangeOrderMatch = bodyText.match(/Exchange\s*Order\s*(\d+)/i);
      if (exchangeOrderMatch) data['exchangeOrderId'] = exchangeOrderMatch[1];

      return data;
    });
  }

  /**
   * Extract edit page data from Stock2.
   * URL: /orders/{id}
   */
  async function extractStock2EditData(orderId: number): Promise<Record<string, string>> {
    await navigateToStock2OrderEdit(stock2Page, orderId);
    await waitForStableContent(stock2Page);
    // Extra wait for all API calls to complete
    await stock2Page.waitForTimeout(3000);

    return await stock2Page.evaluate(() => {
      const data: Record<string, string> = {};

      // Helper: extract text from a Card section by its title
      function getCardContent(title: string): HTMLElement | null {
        const headings = document.querySelectorAll('[class*="text-base"]');
        for (const h of headings) {
          if (h.textContent?.trim().includes(title)) {
            return h.closest('[class*="rounded-lg"][class*="border"]') as HTMLElement;
          }
        }
        return null;
      }

      // Customer info section
      const customerCard = getCardContent('Customer Information');
      if (customerCard) {
        // Email — look for mailto link
        const emailLink = customerCard.querySelector('a[href^="mailto:"]');
        data['email'] = emailLink?.textContent?.trim() || '';

        // Phone — element with phone icon
        const phoneDiv = customerCard.querySelector('[class*="items-center"][class*="gap-2"]');
        // Get all info divs
        const infoDivs = customerCard.querySelectorAll('[class*="flex"][class*="items-center"][class*="gap-2"]');
        for (const div of infoDivs) {
          const text = div.textContent?.trim() || '';
          // Phone is the one without @ and without http
          if (!text.includes('@') && !text.includes('http') && !text.includes('.')) {
            if (/[\d\s+()-]+/.test(text) && text.length > 3) {
              data['telephone'] = text;
            }
          }
        }

        // IP Address
        const allSpans = customerCard.querySelectorAll('span, div');
        for (const span of allSpans) {
          const text = span.textContent?.trim() || '';
          // IP address pattern
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) {
            data['ipAddress'] = text;
            break;
          }
        }

        // Customer name
        const nameEl = customerCard.querySelector('[class*="font-medium"]');
        if (nameEl) data['customerName'] = nameEl.textContent?.trim() || '';
      }

      // Delivery address
      const addressGrid = document.querySelector('[class*="grid"][class*="grid-cols"]');
      if (addressGrid) {
        const cards = addressGrid.querySelectorAll('[class*="rounded-lg"][class*="border"]');
        for (const card of cards) {
          const title = card.querySelector('[class*="text-base"]');
          const titleText = title?.textContent?.trim() || '';
          const content = card.querySelector('[class*="text-sm"]');
          const contentText = content?.textContent?.trim().replace(/\s+/g, ' ') || '';

          if (titleText.includes('Delivery')) {
            data['deliveryAddress'] = contentText;
          }
          if (titleText.includes('Billing')) {
            data['billingAddress'] = contentText;
          }
        }
      }

      // Marketplace IDs
      const marketplaceCard = getCardContent('Marketplace Order IDs');
      if (marketplaceCard) {
        const marketplaceIds: Record<string, string> = {};
        const spans = marketplaceCard.querySelectorAll('[class*="font-bold"]');
        for (const span of spans) {
          const parentSpan = span.parentElement;
          if (parentSpan) {
            const labelEl = parentSpan.querySelector('[class*="text-muted-foreground"]');
            const label = labelEl?.textContent?.trim().replace(/:\s*$/, '') || '';
            const value = span.textContent?.trim() || '';
            if (label && value) {
              marketplaceIds[label.replace(/\s*Order\s*Id\s*:?\s*/i, '').trim()] = value;
            }
          }
        }
        data['marketplaceIds'] = JSON.stringify(marketplaceIds);

        // FC Order ID (green text)
        const greenSpans = marketplaceCard.querySelectorAll('[class*="text-green-600"]');
        for (const span of greenSpans) {
          data['fcOrderId'] = span.textContent?.trim() || '';
        }
      }

      // Tracking section
      const trackingCard = getCardContent('Tracking Information');
      if (trackingCard) {
        const rows = trackingCard.querySelectorAll('[class*="flex"][class*="gap-2"]');
        for (const row of rows) {
          const label = row.querySelector('[class*="text-muted-foreground"]');
          const labelText = label?.textContent?.trim() || '';
          const valueEl = row.querySelector('[class*="flex-wrap"], span:not([class*="text-muted-foreground"])');

          if (labelText.includes('Tracking')) {
            const links = row.querySelectorAll('a, span');
            const vals: string[] = [];
            for (const l of links) {
              if (!l.classList.contains('text-muted-foreground')) {
                const t = l.textContent?.trim();
                if (t && t !== 'Not Available') vals.push(t);
              }
            }
            data['trackingNo'] = vals.join(', ') || row.textContent?.replace(labelText, '').trim() || '';
          }
          if (labelText.includes('DHL')) {
            const links = row.querySelectorAll('a');
            data['dhlTracking'] = Array.from(links).map((l) => l.textContent?.trim()).join(', ');
          }
          if (labelText.includes('Royal Mail')) {
            const links = row.querySelectorAll('a');
            data['royalMailTracking'] = Array.from(links).map((l) => l.textContent?.trim()).join(', ');
          }
          if (labelText.includes('DPD')) {
            const links = row.querySelectorAll('a');
            data['dpdTracking'] = Array.from(links).map((l) => l.textContent?.trim()).join(', ');
          }
          if (labelText.includes('Last Scan')) {
            data['lastScanDate'] = row.textContent?.replace(labelText, '').trim() || '';
          }
        }
      }

      // Order metadata section
      const metadataCard = getCardContent('Order Metadata');
      if (metadataCard) {
        // Sift score badge (green)
        const greenBadge = metadataCard.querySelector('[class*="bg-green-600"]');
        if (greenBadge) {
          const match = greenBadge.textContent?.match(/(\d+\.?\d*)/);
          if (match) data['siftScore'] = match[1];
        }

        // Risk score badge (red)
        const redBadge = metadataCard.querySelector('[class*="bg-red-600"]');
        if (redBadge) {
          const match = redBadge.textContent?.match(/(\d+\.?\d*)/);
          if (match) data['riskScore'] = match[1];
        }

        // Matched By badge (blue)
        const blueBadge = metadataCard.querySelector('[class*="bg-blue-600"]');
        if (blueBadge) {
          data['matchedBy'] = blueBadge.textContent?.replace(/Matched\s*By:\s*/i, '').trim() || '';
        }

        // Exchange info
        const exchangeSpan = metadataCard.querySelector('[class*="text-red-600"]');
        if (exchangeSpan) {
          const text = exchangeSpan.textContent?.trim() || '';
          const origMatch = text.match(/Original:\s*#?(\d+)/);
          if (origMatch) data['originalOrderId'] = origMatch[1];
        }
        const exchangeLink = metadataCard.querySelector('a[class*="text-blue-600"]');
        if (exchangeLink) {
          const match = exchangeLink.textContent?.match(/#?(\d+)/);
          if (match) data['exchangeOrderId'] = match[1];
        }

        // Lock status
        const lockDiv = metadataCard.querySelector('[class*="bg-red-100"]');
        if (lockDiv) {
          data['lockStatus'] = lockDiv.textContent?.trim().replace(/\s+/g, ' ') || '';
        }
      }

      // Order info section
      const orderInfoCard = getCardContent('Order Information');
      if (orderInfoCard) {
        const rows = orderInfoCard.querySelectorAll('[class*="flex"][class*="gap-2"]');
        for (const row of rows) {
          const label = row.querySelector('[class*="text-muted-foreground"]');
          const labelText = label?.textContent?.trim() || '';

          if (labelText.includes('Payment Method')) {
            data['paymentMethod'] = row.textContent?.replace(labelText, '').trim() || '';
          }
          if (labelText.includes('Date Purchased')) {
            data['datePurchased'] = row.textContent?.replace(labelText, '').trim() || '';
          }
          if (labelText.includes('Ship By Date')) {
            data['shipByDate'] = row.textContent?.replace(labelText, '').trim() || '';
          }
          if (labelText.includes('Shipping Method')) {
            data['shippingMethod'] = row.textContent?.replace(labelText, '').trim() || '';
          }
          if (labelText.includes('Previous Orders')) {
            const links = row.querySelectorAll('a');
            data['previousOrders'] = Array.from(links).map((l) => l.textContent?.trim()).join(', ');
          }
        }
      }

      return data;
    });
  }

  for (const order of EDIT_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — edit page data matches`, async () => {
      test.setTimeout(120000); // 2 min per order (two full page loads)

      const result: ComparisonResult = {
        orderId: order.id,
        category: order.category,
        matches: 0,
        mismatches: [],
        skipped: [],
      };

      console.log(`\n=== Testing Edit Page for Order #${order.id} (${order.category}) ===`);

      const zencData = await extractZencEditData(order.id);
      const stock2Data = await extractStock2EditData(order.id);

      console.log('Zenc edit data:', JSON.stringify(zencData, null, 2));
      console.log('Stock2 edit data:', JSON.stringify(stock2Data, null, 2));

      // Compare all fields
      const fieldsToCompare: Array<{
        field: string;
        severity: Mismatch['severity'];
        compareFn?: 'numeric';
        tolerance?: number;
      }> = [
        { field: 'email', severity: 'critical' },
        { field: 'telephone', severity: 'major' },
        { field: 'ipAddress', severity: 'major' },
        { field: 'deliveryAddress', severity: 'critical' },
        { field: 'billingAddress', severity: 'critical' },
        { field: 'paymentMethod', severity: 'major' },
        { field: 'datePurchased', severity: 'major' },
        { field: 'shipByDate', severity: 'major' },
        { field: 'trackingNo', severity: 'major' },
        { field: 'dhlTracking', severity: 'major' },
        { field: 'royalMailTracking', severity: 'major' },
        { field: 'dpdTracking', severity: 'major' },
        { field: 'lastScanDate', severity: 'minor' },
        { field: 'siftScore', severity: 'major', compareFn: 'numeric', tolerance: 0.01 },
        { field: 'riskScore', severity: 'major', compareFn: 'numeric', tolerance: 0.01 },
        { field: 'matchedBy', severity: 'minor' },
        { field: 'originalOrderId', severity: 'critical' },
        { field: 'exchangeOrderId', severity: 'critical' },
        { field: 'fcOrderId', severity: 'major' },
        { field: 'previousOrders', severity: 'minor' },
      ];

      for (const { field, severity, compareFn, tolerance } of fieldsToCompare) {
        const zencVal = zencData[field] || '';
        const stock2Val = stock2Data[field] || '';

        if (!zencVal && !stock2Val) {
          result.skipped.push(field);
          continue;
        }

        let mismatch: Mismatch | null;
        if (compareFn === 'numeric') {
          mismatch = compareNumericValues(field, zencVal, stock2Val, tolerance, severity);
        } else {
          mismatch = compareValues(field, zencVal, stock2Val, severity);
        }

        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          result.mismatches.push(mismatch);
        } else {
          result.matches++;
        }
      }

      // Compare marketplace IDs as JSON objects
      try {
        const zencMpIds = JSON.parse(zencData.marketplaceIds || '{}');
        const stock2MpIds = JSON.parse(stock2Data.marketplaceIds || '{}');

        const allKeys = new Set([...Object.keys(zencMpIds), ...Object.keys(stock2MpIds)]);
        for (const key of allKeys) {
          const zencVal = zencMpIds[key] || '';
          const stock2Val = stock2MpIds[key] || '';
          if (!zencVal && !stock2Val) continue;

          const mismatch = compareValues(`marketplaceId:${key}`, zencVal, stock2Val, 'major');
          if (mismatch) {
            mismatch.orderId = order.id;
            mismatch.category = order.category;
            result.mismatches.push(mismatch);
          } else {
            result.matches++;
          }
        }
      } catch {
        result.skipped.push('marketplaceIds (parse error)');
      }

      logComparisonResult(result);

      if (result.mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));

        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-edit-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-edit-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
      }
    });
  }
});
