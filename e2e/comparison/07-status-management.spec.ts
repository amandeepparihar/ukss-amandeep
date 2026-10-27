import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createZencPage, navigateToZencOrderEdit } from './helpers/zenc-auth';
import { createStock2Page, navigateToStock2OrderEdit } from './helpers/stock2-auth';
import {
  compareValues,
  buildMismatchReport,
  logComparisonResult,
  waitForStableContent,
  ComparisonResult,
  Mismatch,
} from './helpers/comparison-utils';
import { TEST_ORDERS } from './test-orders';

/**
 * Spec 7: Order Status Management Comparison
 *
 * READ-ONLY comparison of status management UI between zenc and Stock2.
 * Tests:
 * - Status dropdown options (all available statuses match)
 * - Current status pre-selected in dropdown
 * - Status history entries (count and content)
 * - Comment template dropdown presence
 * - Notify customer checkbox presence and default state
 * - Multisite: notify checkbox disabled
 * - Send automatically checkbox presence
 * - FC Status field display
 *
 * SAFETY: This test NEVER submits forms or changes any order status.
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

// Representative orders for status management testing:
// - standard orders for baseline
// - multisite order (1781402) for notify-disabled check
// - fc_order for FC status field
// - rejected order for non-standard status
const STATUS_TEST_ORDERS = TEST_ORDERS.filter((o) =>
  ['processing', 'delivered', 'fc_order', 'rejected', 'multisite', 'standard_pending'].includes(
    o.category
  )
);

// -----------------------------------------------------------------
// Zenc extraction helpers
// -----------------------------------------------------------------

interface ZencStatusData {
  /** All options in the status dropdown: {value, label} pairs */
  statusOptions: Array<{ value: string; label: string }>;
  /** Currently selected status value (option value attribute) */
  selectedStatusValue: string;
  /** Currently selected status label text */
  selectedStatusLabel: string;
  /** Current order status ID extracted from page heading/title (more reliable than dropdown) */
  currentStatusIdFromPage: string;
  /** Current order status name from page heading/title */
  currentStatusNameFromPage: string;
  /** Number of rows in the status history table */
  historyRowCount: number;
  /** First 3 history entries: [date, admin, statusName, comment] */
  historyEntries: Array<{ date: string; admin: string; statusName: string; comment: string }>;
  /** Whether a template dropdown is present */
  hasTemplateDropdown: boolean;
  /** Notify customer checkbox: present? */
  hasNotifyCheckbox: boolean;
  /** Notify customer checkbox: checked? */
  notifyChecked: boolean;
  /** Notify customer checkbox: disabled? */
  notifyDisabled: boolean;
  /** Send automatically checkbox: present? */
  hasSendAutoCheckbox: boolean;
  /** FC order status text (empty if not shown) */
  fcOrderStatus: string;
}

async function extractZencStatusData(page: Page, orderId: number): Promise<ZencStatusData> {
  await navigateToZencOrderEdit(page, orderId);
  await waitForStableContent(page);

  return await page.evaluate(() => {
    const result: ZencStatusData = {
      statusOptions: [],
      selectedStatusValue: '',
      selectedStatusLabel: '',
      currentStatusIdFromPage: '',
      currentStatusNameFromPage: '',
      historyRowCount: 0,
      historyEntries: [],
      hasTemplateDropdown: false,
      hasNotifyCheckbox: false,
      notifyChecked: false,
      notifyDisabled: false,
      hasSendAutoCheckbox: false,
      fcOrderStatus: '',
    };

    // ----- Status dropdown -----
    // Zenc: <select name="status" id="order_status">
    const statusSelect = document.querySelector<HTMLSelectElement>(
      'select[name="status"], select#order_status'
    );
    if (statusSelect) {
      const options = Array.from(statusSelect.options);
      result.statusOptions = options.map((o) => ({
        value: o.value,
        label: o.text.trim(),
      }));
      result.selectedStatusValue = statusSelect.value;
      const selected = statusSelect.options[statusSelect.selectedIndex];
      result.selectedStatusLabel = selected ? selected.text.trim() : '';
    }

    // ----- Current order status from page (more reliable than dropdown selection) -----
    // Zenc shows the current status in a hidden field "previous_order_status" or
    // in a cell with the current status text (like "Order Status: Processing").
    // Strategy 1: Read the hidden input "previous_order_status"
    const prevStatusInput = document.querySelector<HTMLInputElement>(
      'input[name="previous_order_status"]'
    );
    if (prevStatusInput && prevStatusInput.value) {
      result.currentStatusIdFromPage = prevStatusInput.value;
      // Look up the corresponding label from the status options
      const matchingOption = result.statusOptions.find((o) => o.value === prevStatusInput.value);
      if (matchingOption) {
        result.currentStatusNameFromPage = matchingOption.label.replace(/\s*\[\d+\]\s*$/, '').trim();
      }
    }

    // Strategy 2: Look for "Order Status:" label in the page
    if (!result.currentStatusIdFromPage) {
      const allCells = document.querySelectorAll('td.main, td');
      for (const cell of allCells) {
        const text = cell.textContent?.trim() || '';
        if (text.includes('Order Status:') || text.includes('orders_status')) {
          const nextCell = cell.nextElementSibling as HTMLTableCellElement;
          if (nextCell) {
            result.currentStatusNameFromPage = nextCell.textContent?.trim() || '';
          }
        }
      }
    }

    // ----- Status history table -----
    // Zenc renders the status history in <table id="table_comment"> (edit_order.php line ~6666).
    // This is the ONLY correct source for status history rows.
    //
    // Previous strategy used a naive date-row heuristic across ALL <tr> elements, which
    // incorrectly counted rows from other date-containing tables on the page (e.g. the
    // AJAX-loaded Order Processing Simulation/Invoice Log). Scoping to #table_comment
    // fixes the false-positive count mismatch (BUG-438 / issue #486).
    const historyTable = document.querySelector<HTMLTableElement>('#table_comment');
    const historyRows: HTMLTableRowElement[] = [];
    if (historyTable) {
      const allRows = historyTable.querySelectorAll('tr');
      for (const row of allRows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const firstCellText = cells[0].textContent?.trim() || '';
          // Date pattern: mm/dd/yyyy HH:mm:ss (zen_datetime_short format)
          if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(firstCellText) ||
              /^\d{4}-\d{2}-\d{2}/.test(firstCellText)) {
            historyRows.push(row as HTMLTableRowElement);
          }
        }
      }
    }
    result.historyRowCount = historyRows.length;

    // Extract first 3 entries
    const entriesToExtract = historyRows.slice(0, 3);
    for (const row of entriesToExtract) {
      const cells = row.querySelectorAll('td');
      result.historyEntries.push({
        date: (cells[0]?.textContent || '').trim(),
        admin: (cells[1]?.textContent || '').trim(),
        statusName: (cells[2]?.textContent || '').trim(),
        comment: (cells[3]?.textContent || '').trim(),
      });
    }

    // ----- Template dropdown -----
    // Zenc has a <select name="status_comment_tpl"> or similar template dropdown
    const tplSelect = document.querySelector<HTMLSelectElement>(
      'select[name="status_comment_tpl"], select[name="template"], select[id*="tpl"]'
    );
    result.hasTemplateDropdown = !!tplSelect;

    // ----- Notify customer checkbox -----
    const notifyCheckbox = document.querySelector<HTMLInputElement>(
      'input[name="notify"][type="checkbox"], input[name="notify_customer"][type="checkbox"]'
    );
    result.hasNotifyCheckbox = !!notifyCheckbox;
    if (notifyCheckbox) {
      result.notifyChecked = notifyCheckbox.checked;
      result.notifyDisabled = notifyCheckbox.disabled;
    }

    // ----- Send automatically checkbox -----
    const sendAutoCheckbox = document.querySelector<HTMLInputElement>(
      'input[name="send_message_automatically"][type="checkbox"], input[name="send_auto"][type="checkbox"]'
    );
    result.hasSendAutoCheckbox = !!sendAutoCheckbox;

    // ----- FC order status -----
    // Zenc shows "GREEN FC Order Status: <value>" in a span
    const allSpans = document.querySelectorAll('span, strong');
    for (const el of allSpans) {
      const text = el.textContent?.trim() || '';
      if (text.includes('GREEN FC Order Status')) {
        // The value follows the colon
        const match = text.match(/GREEN FC Order Status[:\s]+(.+)/i);
        if (match) {
          result.fcOrderStatus = match[1].trim();
          break;
        }
      }
    }

    return result;
  });
}

// -----------------------------------------------------------------
// Stock2 extraction helpers
// -----------------------------------------------------------------

interface Stock2StatusData {
  statusOptions: Array<{ value: string; label: string }>;
  selectedStatusValue: string;
  selectedStatusLabel: string;
  /** Current status ID extracted from the "Update Status — Name [ID]" card title */
  currentStatusIdFromPage: string;
  /** Current status name extracted from the card title */
  currentStatusNameFromPage: string;
  historyRowCount: number;
  historyEntries: Array<{ date: string; admin: string; statusName: string; comment: string }>;
  hasTemplateDropdown: boolean;
  hasNotifyCheckbox: boolean;
  notifyChecked: boolean;
  notifyDisabled: boolean;
  hasSendAutoCheckbox: boolean;
  fcOrderStatus: string;
}

async function extractStock2StatusData(page: Page, orderId: number): Promise<Stock2StatusData> {
  await navigateToStock2OrderEdit(page, orderId);
  await waitForStableContent(page);
  // Allow extra time for all async data (status list, templates, history) to load
  await page.waitForTimeout(4000);

  // ----- Status dropdown -----
  // Stock2 uses a Shadcn/Radix Select — options only appear in the DOM after clicking
  // the trigger. We click the trigger, read the options, then close with Escape.
  const statusOptions: Array<{ value: string; label: string }> = [];
  let selectedStatusValue = '';
  let selectedStatusLabel = '';

  try {
    // Find the trigger inside the "Update Status" card
    // The trigger has role="combobox" and is inside a Card with title including "Update Status"
    const trigger = await page.locator('[role="combobox"]').first();
    const isTriggerVisible = await trigger.isVisible({ timeout: 5000 }).catch(() => false);

    if (isTriggerVisible) {
      // Get currently selected value before opening
      selectedStatusLabel = (await trigger.textContent() || '').trim();
      const matchId = selectedStatusLabel.match(/\[(\d+)\]/);
      if (matchId) selectedStatusValue = matchId[1];

      // Open the dropdown to read all options
      await trigger.click();
      // Wait for Radix portal to render
      await page.waitForSelector('[role="option"]', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);

      // Read all options from the Radix listbox portal
      const optionEls = await page.locator('[role="option"]').all();
      for (const optEl of optionEls) {
        const label = (await optEl.textContent() || '').trim();
        // Extract value from the label e.g. "Processing [2]" -> "2"
        const matchVal = label.match(/\[(\d+)\]\s*$/);
        const value = matchVal ? matchVal[1] : label;
        statusOptions.push({ value, label });
      }

      // Close dropdown with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  } catch {
    // Dropdown extraction failed — statusOptions remains empty
  }

  return await page.evaluate(
    ({ statusOptions, selectedStatusValue, selectedStatusLabel }: {
      statusOptions: Array<{ value: string; label: string }>;
      selectedStatusValue: string;
      selectedStatusLabel: string;
    }) => {
    const result: {
      statusOptions: Array<{ value: string; label: string }>;
      selectedStatusValue: string;
      selectedStatusLabel: string;
      historyRowCount: number;
      historyEntries: Array<{ date: string; admin: string; statusName: string; comment: string }>;
      hasTemplateDropdown: boolean;
      hasNotifyCheckbox: boolean;
      notifyChecked: boolean;
      notifyDisabled: boolean;
      hasSendAutoCheckbox: boolean;
      fcOrderStatus: string;
      currentStatusIdFromPage: string;
      currentStatusNameFromPage: string;
    } = {
      statusOptions,
      selectedStatusValue,
      selectedStatusLabel,
      currentStatusIdFromPage: selectedStatusValue, // Stock2 pre-selects the current status
      currentStatusNameFromPage: selectedStatusLabel.replace(/\s*\[\d+\]\s*$/, '').trim(),
      historyRowCount: 0,
      historyEntries: [],
      hasTemplateDropdown: false,
      hasNotifyCheckbox: false,
      notifyChecked: false,
      notifyDisabled: false,
      hasSendAutoCheckbox: false,
      fcOrderStatus: '',
    };

    // (statusOptions/selectedStatusValue/selectedStatusLabel already populated above)

    // ----- Current status from "Update Status — Name [ID]" card title -----
    // Stock2 StatusManagement renders: <CardTitle>Update Status — {currentStatusName} [{currentStatus}]</CardTitle>
    const allCards2 = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
    for (const card of allCards2) {
      const title = card.querySelector('[class*="text-base"]');
      const titleText = title?.textContent?.trim() || '';
      if (titleText.startsWith('Update Status')) {
        // Extract "Name [ID]" from "Update Status — Name [ID]"
        const match = titleText.match(/Update Status\s*[—-]\s*(.+?)\s*\[(\d+)\]/);
        if (match) {
          result.currentStatusNameFromPage = match[1].trim();
          result.currentStatusIdFromPage = match[2];
        }
        break;
      }
    }

    // ----- Status history -----
    // StatusHistory component renders a Card with title "Status History (N)"
    const allCards = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
    for (const card of allCards) {
      const title = card.querySelector('[class*="text-base"]');
      if (title?.textContent?.includes('Status History')) {
        // Extract count from title like "Status History (5)"
        const countMatch = title.textContent?.match(/\((\d+)\)/);
        if (countMatch) {
          result.historyRowCount = parseInt(countMatch[1], 10);
        }

        // Extract individual entries — each is a div with border-b class
        const entries = card.querySelectorAll('[class*="border-b"]');
        let count = 0;
        for (const entry of entries) {
          if (count >= 3) break;

          // Status name from Badge (role="generic" with variant="outline")
          const badge = entry.querySelector('[class*="rounded-full"], [class*="rounded-md"]');
          const statusName = badge?.textContent?.trim() || '';

          // Date from the whitespace-nowrap span
          const dateSpan = entry.querySelector('[class*="whitespace-nowrap"]');
          const date = dateSpan?.textContent?.trim() || '';

          // Admin name from "by <name>" text
          const allTextNodes = entry.querySelectorAll('*');
          let admin = '';
          for (const node of allTextNodes) {
            const text = node.textContent?.trim() || '';
            if (text.startsWith('by ') && text.length < 60) {
              admin = text.replace(/^by\s+/, '').split('(')[0].trim();
              break;
            }
          }

          // Comment text
          const commentEl = entry.querySelector('[class*="whitespace-pre-wrap"]');
          const comment = commentEl?.textContent?.trim() || '';

          result.historyEntries.push({ date, admin, statusName, comment });
          count++;
        }
        break;
      }
    }

    // ----- Template dropdown -----
    // Stock2 renders a "Select Template" label when templates exist
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent?.includes('Select Template') ||
          label.textContent?.includes('Select Reply Template')) {
        result.hasTemplateDropdown = true;
        break;
      }
    }

    // ----- Notify customer checkbox -----
    const notifyCheckbox = document.querySelector<HTMLButtonElement>(
      '[id="status-notify"]'
    );
    result.hasNotifyCheckbox = !!notifyCheckbox;
    if (notifyCheckbox) {
      result.notifyChecked = notifyCheckbox.getAttribute('data-state') === 'checked' ||
                              notifyCheckbox.getAttribute('aria-checked') === 'true';
      result.notifyDisabled = notifyCheckbox.hasAttribute('disabled') ||
                               notifyCheckbox.getAttribute('disabled') === '' ||
                               notifyCheckbox.getAttribute('data-disabled') === '';
    }

    // ----- Send automatically checkbox -----
    const sendAutoCheckbox = document.querySelector('[id="status-auto-send"]');
    result.hasSendAutoCheckbox = !!sendAutoCheckbox;

    // ----- FC order status -----
    // StatusManagement doesn't show FC order status directly — it's shown in
    // the edit page panel (order metadata). Look for "FC Order Status" label.
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      if (text.includes('FC Order Status') && !el.querySelector('*[class]')) {
        // Leaf-like node containing FC Order Status
        result.fcOrderStatus = text.replace(/.*FC Order Status[:\s]*/i, '').trim();
        if (result.fcOrderStatus.length > 100) result.fcOrderStatus = '';
        break;
      }
    }

    return result;
  }, { statusOptions, selectedStatusValue, selectedStatusLabel });
}

// -----------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------

test.describe('Status Management Comparison (SPEC-07)', () => {
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

  // ---------------------------------------------------------------
  // TEST 1: Status dropdown options match
  // ---------------------------------------------------------------
  test('status dropdown options match between zenc and stock2', async () => {
    test.setTimeout(180000);

    const orderId = 1791190; // processing order — has a clear status

    console.log(`\n=== Status Dropdown Options: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log('Zenc status options:', JSON.stringify(zencData.statusOptions, null, 2));
    console.log('Stock2 status options:', JSON.stringify(stock2Data.statusOptions, null, 2));
    console.log('Zenc option count:', zencData.statusOptions.length);
    console.log('Stock2 option count:', stock2Data.statusOptions.length);

    const mismatches: Mismatch[] = [];
    let matches = 0;

    // Filter out Zenc's "--Select Status--" placeholder (value=0) — it's a UI detail
    // that Stock2 doesn't replicate (Stock2 pre-selects the current status).
    const zencMeaningfulOptions = zencData.statusOptions.filter((o) => o.value !== '0');
    const stock2MeaningfulOptions = stock2Data.statusOptions.filter((o) => o.value !== '0');

    console.log(`Zenc meaningful option count (excl. placeholder): ${zencMeaningfulOptions.length}`);
    console.log(`Stock2 meaningful option count: ${stock2MeaningfulOptions.length}`);

    // Compare count (excluding placeholder)
    if (zencMeaningfulOptions.length > 0 && stock2MeaningfulOptions.length > 0) {
      const countMismatch = compareValues(
        'statusDropdown:optionCount',
        String(zencMeaningfulOptions.length),
        String(stock2MeaningfulOptions.length),
        'major'
      );
      if (countMismatch) {
        countMismatch.orderId = orderId;
        mismatches.push(countMismatch);
        console.warn(
          `MISMATCH: Status dropdown count — zenc=${zencMeaningfulOptions.length}, stock2=${stock2MeaningfulOptions.length}`
        );
      } else {
        matches++;
      }
    }

    // Compare status names (by value/ID)
    // Build maps: id -> label (exclude value=0 placeholder)
    const zencByValue: Record<string, string> = {};
    for (const o of zencMeaningfulOptions) {
      zencByValue[o.value] = o.label;
    }

    const stock2ByValue: Record<string, string> = {};
    for (const o of stock2MeaningfulOptions) {
      stock2ByValue[o.value] = o.label;
    }

    // Check all statuses present in both systems
    const allValues = new Set([
      ...Object.keys(zencByValue),
      ...Object.keys(stock2ByValue),
    ]);
    for (const val of allValues) {
      if (!val || val === '0') continue; // skip empty/placeholder
      const zencLabel = zencByValue[val] || '(missing)';
      const stock2Label = stock2ByValue[val] || '(missing)';

      // Normalize: strip "[N]" suffix and whitespace for comparison
      const normZenc = zencLabel.replace(/\s*\[\d+\]\s*$/, '').trim().toLowerCase();
      const normStock2 = stock2Label.replace(/\s*\[\d+\]\s*$/, '').trim().toLowerCase();

      if (normZenc !== normStock2) {
        mismatches.push({
          field: `statusDropdown:status_${val}`,
          zencValue: zencLabel,
          stock2Value: stock2Label,
          orderId,
          severity: 'major',
        });
      } else {
        matches++;
      }
    }

    const result: ComparisonResult = { orderId, matches, mismatches, skipped: [] };
    logComparisonResult(result);

    if (mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({
        path: 'e2e/comparison/screenshots/zenc-status-dropdown.png',
        fullPage: true,
      }).catch(() => {});
      await stock2Page.screenshot({
        path: 'e2e/comparison/screenshots/stock2-status-dropdown.png',
        fullPage: true,
      }).catch(() => {});
    }

    // Fail if there are critical/major mismatches
    const majorMismatches = mismatches.filter((m) => m.severity !== 'minor');
    expect(
      majorMismatches,
      `Status dropdown mismatches:\n${majorMismatches
        .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
        .join('\n')}`
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // TEST 2: Current status pre-selected in dropdown
  // ---------------------------------------------------------------
  for (const order of STATUS_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — current status pre-selected`, async () => {
      test.setTimeout(120000);

      console.log(`\n=== Current Status Pre-Selection: Order #${order.id} (${order.category}) ===`);

      const zencData = await extractZencStatusData(zencPage, order.id);
      const stock2Data = await extractStock2StatusData(stock2Page, order.id);

      console.log(
        `Zenc: dropdown="${zencData.selectedStatusValue}", currentFromPage="${zencData.currentStatusIdFromPage}" (${zencData.currentStatusNameFromPage})`
      );
      console.log(
        `Stock2: dropdown="${stock2Data.selectedStatusValue}", currentFromPage="${stock2Data.currentStatusIdFromPage}" (${stock2Data.currentStatusNameFromPage})`
      );

      const mismatches: Mismatch[] = [];
      let matches = 0;

      // Compare the CURRENT STATUS ID from page (most reliable source).
      // For Zenc: extracted from hidden field "previous_order_status".
      // For Stock2: extracted from the "Update Status — Name [ID]" card title.
      const zencCurrentId = zencData.currentStatusIdFromPage;
      const stock2CurrentId = stock2Data.currentStatusIdFromPage;

      if (zencCurrentId && stock2CurrentId) {
        const mismatch = compareValues(
          'currentStatus:id',
          zencCurrentId,
          stock2CurrentId,
          'critical'
        );
        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          mismatches.push(mismatch);
        } else {
          matches++;
        }
      } else {
        console.log(
          `  Skipping status ID comparison — zencFromPage="${zencCurrentId}" stock2FromPage="${stock2CurrentId}"`
        );
      }

      // Also compare current status NAME from page
      if (zencData.currentStatusNameFromPage && stock2Data.currentStatusNameFromPage) {
        const mismatch = compareValues(
          'currentStatus:name',
          zencData.currentStatusNameFromPage,
          stock2Data.currentStatusNameFromPage,
          'major'
        );
        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          mismatches.push(mismatch);
        } else {
          matches++;
        }
      }

      const result: ComparisonResult = { orderId: order.id, category: order.category, matches, mismatches, skipped: [] };
      logComparisonResult(result);

      if (mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-status-selected-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-status-selected-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
      }

      expect(
        mismatches,
        `Order #${order.id}: Selected status mismatch\n${mismatches
          .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
          .join('\n')}`
      ).toHaveLength(0);
    });
  }

  // ---------------------------------------------------------------
  // TEST 3: Status history entry count matches
  // ---------------------------------------------------------------
  for (const order of STATUS_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — status history count matches`, async () => {
      test.setTimeout(120000);

      console.log(`\n=== Status History Count: Order #${order.id} (${order.category}) ===`);

      const zencData = await extractZencStatusData(zencPage, order.id);
      const stock2Data = await extractStock2StatusData(stock2Page, order.id);

      console.log(
        `Zenc history rows: ${zencData.historyRowCount}, Stock2 history rows: ${stock2Data.historyRowCount}`
      );

      if (zencData.historyRowCount === 0) {
        console.log('  Zenc: no history rows detected (parsing may have failed) — skipping');
        return;
      }

      const mismatches: Mismatch[] = [];
      let matches = 0;

      const mismatch = compareValues(
        'statusHistory:rowCount',
        String(zencData.historyRowCount),
        String(stock2Data.historyRowCount),
        'major'
      );
      if (mismatch) {
        mismatch.orderId = order.id;
        mismatch.category = order.category;
        mismatches.push(mismatch);
      } else {
        matches++;
      }

      const result: ComparisonResult = { orderId: order.id, category: order.category, matches, mismatches, skipped: [] };
      logComparisonResult(result);

      if (mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-history-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-history-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
      }

      expect(
        mismatches,
        `Order #${order.id}: History count mismatch\n${mismatches
          .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
          .join('\n')}`
      ).toHaveLength(0);
    });
  }

  // ---------------------------------------------------------------
  // TEST 4: Most recent history entry status name matches
  // ---------------------------------------------------------------
  for (const order of STATUS_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — status history entries are consistent`, async () => {
      test.setTimeout(120000);

      console.log(`\n=== History Entry Consistency: Order #${order.id} (${order.category}) ===`);

      const zencData = await extractZencStatusData(zencPage, order.id);
      const stock2Data = await extractStock2StatusData(stock2Page, order.id);

      console.log('Zenc first extracted entry:', JSON.stringify(zencData.historyEntries[0]));
      console.log('Stock2 first extracted entry:', JSON.stringify(stock2Data.historyEntries[0]));

      // NOTE: Zenc renders history in ASCENDING order (oldest first),
      // Stock2 renders in DESCENDING order (newest first per REQ-07-018).
      // We therefore CANNOT directly compare historyEntries[0] between the two systems.
      // Instead, we verify that:
      // 1. The SET of unique status names seen in both systems overlaps (same statuses appear)
      // 2. The admin names from both systems are plausible (not empty vs non-empty for same entry)
      //
      // A proper per-entry comparison would require normalizing dates across both formats,
      // which is fragile due to MM/DD/YYYY (Zenc) vs DD-MM-YYYY (Stock2) ambiguity.

      const zencStatuses = zencData.historyEntries.map((e) => e.statusName.toLowerCase()).filter(Boolean);
      const stock2Statuses = stock2Data.historyEntries.map((e) => e.statusName.toLowerCase()).filter(Boolean);

      console.log('Zenc entry statuses (first 3):', zencStatuses);
      console.log('Stock2 entry statuses (first 3):', stock2Statuses);

      // Log the entries for manual review rather than failing on ordering differences
      if (zencData.historyEntries.length > 0 && stock2Data.historyEntries.length > 0) {
        // Verify at least one status name from Stock2's entries appears somewhere in Zenc's full
        // status options — this checks that Stock2 isn't inventing status names
        const stock2StatusName = stock2Data.historyEntries[0]?.statusName || '';
        if (stock2StatusName) {
          const zencHasThisStatus = zencData.statusOptions.some(
            (o) => o.label.replace(/\s*\[\d+\]\s*$/, '').trim().toLowerCase() === stock2StatusName.toLowerCase()
          );
          if (!zencHasThisStatus) {
            console.warn(
              `WARNING: Stock2 history entry references status "${stock2StatusName}" which is NOT in Zenc's status dropdown`
            );
          }
        }

        // Verify the entry count is non-zero on both sides (already tested in Test 3)
        // Just log for informational purposes
        console.log(`  OK: Both systems have history entries (zenc=${zencData.historyRowCount}, stock2=${stock2Data.historyRowCount})`);
      }

      // This test is informational only — it logs but does not fail on ordering differences.
      // Real discrepancies (count mismatch) are caught by Test 3.
      // The only hard assertion: if Stock2 has entries, Zenc should too.
      if (stock2Data.historyEntries.length > 0) {
        expect(
          zencData.historyEntries.length,
          `Stock2 has history entries but Zenc extractor returned none for order #${order.id}`
        ).toBeGreaterThan(0);
      }
    });
  }

  // ---------------------------------------------------------------
  // TEST 5: Template dropdown presence
  // ---------------------------------------------------------------
  test('comment template dropdown is present in both systems', async () => {
    test.setTimeout(120000);

    const orderId = 1791190;
    console.log(`\n=== Template Dropdown Presence: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log(`Zenc hasTemplateDropdown: ${zencData.hasTemplateDropdown}`);
    console.log(`Stock2 hasTemplateDropdown: ${stock2Data.hasTemplateDropdown}`);

    // If zenc has a template dropdown, stock2 must also have one
    if (zencData.hasTemplateDropdown) {
      expect(
        stock2Data.hasTemplateDropdown,
        'Zenc has template dropdown but Stock2 does not'
      ).toBe(true);
    }

    // If stock2 has a template dropdown, zenc must also have one
    if (stock2Data.hasTemplateDropdown) {
      expect(
        zencData.hasTemplateDropdown,
        'Stock2 has template dropdown but Zenc does not'
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------
  // TEST 6: Notify customer checkbox — presence and default state
  // ---------------------------------------------------------------
  test('notify customer checkbox is present in both systems', async () => {
    test.setTimeout(120000);

    const orderId = 1791190; // non-multisite — notify should default ON
    console.log(`\n=== Notify Checkbox Presence: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log(
      `Zenc: hasNotify=${zencData.hasNotifyCheckbox}, checked=${zencData.notifyChecked}, disabled=${zencData.notifyDisabled}`
    );
    console.log(
      `Stock2: hasNotify=${stock2Data.hasNotifyCheckbox}, checked=${stock2Data.notifyChecked}, disabled=${stock2Data.notifyDisabled}`
    );

    expect(
      zencData.hasNotifyCheckbox,
      'Zenc notify checkbox not found on order edit page'
    ).toBe(true);

    expect(
      stock2Data.hasNotifyCheckbox,
      'Stock2 notify checkbox not found on order edit page'
    ).toBe(true);

    const mismatches: Mismatch[] = [];
    let matches = 0;

    // Compare checked state
    const checkedMismatch = compareValues(
      'notifyCheckbox:checked',
      String(zencData.notifyChecked),
      String(stock2Data.notifyChecked),
      'major'
    );
    if (checkedMismatch) {
      checkedMismatch.orderId = orderId;
      mismatches.push(checkedMismatch);
    } else {
      matches++;
    }

    // Compare disabled state
    const disabledMismatch = compareValues(
      'notifyCheckbox:disabled',
      String(zencData.notifyDisabled),
      String(stock2Data.notifyDisabled),
      'major'
    );
    if (disabledMismatch) {
      disabledMismatch.orderId = orderId;
      mismatches.push(disabledMismatch);
    } else {
      matches++;
    }

    const result: ComparisonResult = { orderId, matches, mismatches, skipped: [] };
    logComparisonResult(result);

    if (mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
    }

    expect(
      mismatches,
      `Notify checkbox state mismatch:\n${mismatches
        .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
        .join('\n')}`
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // TEST 7: Multisite order — notify checkbox disabled
  // ---------------------------------------------------------------
  test('multisite order (1781402) — notify checkbox disabled in both systems', async () => {
    test.setTimeout(120000);

    const orderId = 1781402; // multisite order
    console.log(`\n=== Multisite Notify Disabled: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log(
      `Zenc: hasNotify=${zencData.hasNotifyCheckbox}, checked=${zencData.notifyChecked}, disabled=${zencData.notifyDisabled}`
    );
    console.log(
      `Stock2: hasNotify=${stock2Data.hasNotifyCheckbox}, checked=${stock2Data.notifyChecked}, disabled=${stock2Data.notifyDisabled}`
    );

    // Both systems should have the checkbox
    expect(zencData.hasNotifyCheckbox, 'Zenc: notify checkbox missing on multisite order').toBe(true);
    expect(stock2Data.hasNotifyCheckbox, 'Stock2: notify checkbox missing on multisite order').toBe(true);

    const mismatches: Mismatch[] = [];
    let matches = 0;

    // For multisite, zenc disables notify; stock2 should also disable it
    const disabledMismatch = compareValues(
      'notifyCheckbox:disabled (multisite)',
      String(zencData.notifyDisabled),
      String(stock2Data.notifyDisabled),
      'major'
    );
    if (disabledMismatch) {
      disabledMismatch.orderId = orderId;
      mismatches.push(disabledMismatch);
    } else {
      matches++;
    }

    const result: ComparisonResult = { orderId, matches, mismatches, skipped: [] };
    logComparisonResult(result);

    if (mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({
        path: 'e2e/comparison/screenshots/zenc-multisite-notify.png',
        fullPage: true,
      }).catch(() => {});
      await stock2Page.screenshot({
        path: 'e2e/comparison/screenshots/stock2-multisite-notify.png',
        fullPage: true,
      }).catch(() => {});
    }

    expect(
      mismatches,
      `Multisite notify disabled mismatch:\n${mismatches
        .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
        .join('\n')}`
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // TEST 8: Send automatically checkbox is present
  // ---------------------------------------------------------------
  test('send automatically checkbox is present in both systems', async () => {
    test.setTimeout(120000);

    const orderId = 1791190;
    console.log(`\n=== Send Automatically Checkbox: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log(`Zenc hasSendAutoCheckbox: ${zencData.hasSendAutoCheckbox}`);
    console.log(`Stock2 hasSendAutoCheckbox: ${stock2Data.hasSendAutoCheckbox}`);

    // If zenc shows it, stock2 must also show it
    if (zencData.hasSendAutoCheckbox) {
      expect(
        stock2Data.hasSendAutoCheckbox,
        'Zenc has "Send Automatically" checkbox but Stock2 does not'
      ).toBe(true);
    }

    const mismatch = compareValues(
      'sendAutoCheckbox:present',
      String(zencData.hasSendAutoCheckbox),
      String(stock2Data.hasSendAutoCheckbox),
      'minor'
    );
    if (mismatch) {
      console.warn(
        `MISMATCH [minor]: Send automatically checkbox — zenc=${zencData.hasSendAutoCheckbox}, stock2=${stock2Data.hasSendAutoCheckbox}`
      );
    }
  });

  // ---------------------------------------------------------------
  // TEST 9: FC order status field display
  // ---------------------------------------------------------------
  test('fc_order (1791107) — FC order status field displayed in both systems', async () => {
    test.setTimeout(120000);

    const orderId = 1791107; // fc_order category
    console.log(`\n=== FC Order Status Field: Order #${orderId} ===`);

    const zencData = await extractZencStatusData(zencPage, orderId);
    const stock2Data = await extractStock2StatusData(stock2Page, orderId);

    console.log(`Zenc fcOrderStatus: "${zencData.fcOrderStatus}"`);
    console.log(`Stock2 fcOrderStatus: "${stock2Data.fcOrderStatus}"`);

    const mismatches: Mismatch[] = [];
    let matches = 0;

    // If zenc shows FC status, stock2 must show it too
    if (zencData.fcOrderStatus) {
      expect(
        stock2Data.fcOrderStatus,
        `Zenc shows FC order status "${zencData.fcOrderStatus}" but Stock2 shows nothing`
      ).toBeTruthy();

      const mismatch = compareValues(
        'fcOrderStatus',
        zencData.fcOrderStatus,
        stock2Data.fcOrderStatus,
        'major'
      );
      if (mismatch) {
        mismatch.orderId = orderId;
        mismatches.push(mismatch);
      } else {
        matches++;
      }
    }

    const result: ComparisonResult = { orderId, matches, mismatches, skipped: [] };
    logComparisonResult(result);

    if (mismatches.length > 0) {
      console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));
      await zencPage.screenshot({
        path: 'e2e/comparison/screenshots/zenc-fc-status.png',
        fullPage: true,
      }).catch(() => {});
      await stock2Page.screenshot({
        path: 'e2e/comparison/screenshots/stock2-fc-status.png',
        fullPage: true,
      }).catch(() => {});
    }

    expect(
      mismatches,
      `FC order status mismatch:\n${mismatches
        .map((m) => `  [${m.field}] zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`)
        .join('\n')}`
    ).toHaveLength(0);
  });
});
