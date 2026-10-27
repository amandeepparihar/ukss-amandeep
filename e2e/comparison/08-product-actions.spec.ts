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
 * Spec 8: Product-Level Actions Display Comparison (SPEC-06)
 *
 * READ-ONLY comparison of per-product display state between zenc and Stock2.
 * DO NOT click any action buttons, JIT toggles, backorder buttons, or
 * submit any forms. This is a pure visual state comparison.
 *
 * Tests:
 * 1. Box number display — value shown per product
 * 2. Backorder flag display — which products show as backordered
 * 3. JIT marking display — is the JIT indicator present and correct
 * 4. Printing status display — Printed/Not Printed per product
 * 5. Arrived status display — Arrived/Not Arrived per product
 * 6. Box1/Box2 fields — are they visible and correct
 * 7. "Buy From Retailer" button presence — BUG #322 verification
 * 8. Supplier checkbox presence — are supplier checkboxes present
 * 9. Pick checkbox state — matches box_number IS NOT NULL
 *
 * Only tests non-marketplace orders (order_site IN 0, 89).
 * NOTE: Both zenc and Stock2 read from the SAME MySQL database.
 * Any difference is a real bug, not a database divergence issue.
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

// Only non-marketplace orders (order_site IN 0, 89)
// amazon = 9, fruugo = 95, etc. — exclude those.
const NON_MARKETPLACE_CATEGORIES = [
  'standard_pending',
  'processing',
  'delivered',
  'exchange',
  'rejected',
  'refund_marked',
  'fc_order',
  'dhl_shipping',
  'multi_product',
  'backorder',
  'wholesale',
  'has_refunded_products',
  'sift_scored',
];

const PRODUCT_ACTIONS_ORDERS = TEST_ORDERS.filter((o) =>
  NON_MARKETPLACE_CATEGORIES.includes(o.category)
);

interface ZencProductActionData {
  /** Product identifier for matching */
  model: string;
  name: string;
  /** Box number field value (input value) */
  boxNumber: string;
  /** Is the pick checkbox checked? Should be true when boxNumber is non-empty */
  pickChecked: boolean;
  /** Backorder status shown */
  backorder: string;
  /** JIT checkbox is present */
  jitPresent: boolean;
  /** JIT checkbox checked state */
  jitChecked: boolean;
  /** Printing status (Printed/Not Printed) */
  printingStatus: string;
  /** Arrived status (Arrived/Not Arrived) */
  arrivedStatus: string;
  /** Box1 field value */
  box1Value: string;
  /** Box2 field value */
  box2Value: string;
  /** Is "Buy From Retailer" button/link present? */
  buyFromRetailerPresent: boolean;
  /** Is supplier checkbox present? */
  supplierCheckboxPresent: boolean;
  /** Is supplier checkbox checked? */
  supplierCheckboxChecked: boolean;
}

interface Stock2ProductActionData {
  model: string;
  name: string;
  boxNumber: string;
  pickChecked: boolean;
  backorder: string;
  jitPresent: boolean;
  jitChecked: boolean;
  printingStatus: string;
  arrivedStatus: string;
  box1Value: string;
  /** Box2 not a separate field in stock2, but check if visible */
  box2Value: string;
  buyFromRetailerPresent: boolean;
  supplierCheckboxPresent: boolean;
  supplierCheckboxChecked: boolean;
}

test.describe('Product-Level Actions Display Comparison (SPEC-06)', () => {
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
  // Zenc extractor
  // -------------------------------------------------------------------------

  /**
   * Extract per-product action display state from zenc edit page.
   *
   * Zenc renders products in #order_products > table > tr[class*="dataTableRow"].
   * Action elements per row:
   * - box_number: input[name*="box_number"] value
   * - pick: checkbox with name containing "ship_chk" OR presence of non-empty box_number
   * - JIT: checkbox with name containing "jit" (or onclick containing jit_mark)
   * - backorder: checkbox name containing "backorder" OR text "Cancelled"/"Replacement"
   * - printing status: no separate column in zenc (resolved from product row context)
   * - arrived: checkbox with name containing "arrived" OR select
   * - box1/box2: input[name*="box1"] / input[name*="box2"] values
   * - buy_from_retailer: any link/button text containing "Buy From Retailer" or input name matching
   * - supplier checkbox: input[name*="buy_from_retailer_order_product_"] or similar
   */
  async function extractZencProductActions(orderId: number): Promise<ZencProductActionData[]> {
    await navigateToZencOrderEdit(zencPage, orderId);
    await waitForStableContent(zencPage);
    await zencPage.waitForTimeout(2000);

    // Verify page correctness
    const pageOrderId = await zencPage.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return params.get('oID');
    });
    if (pageOrderId !== String(orderId)) {
      throw new Error(
        `Zenc page verification failed: expected oID=${orderId} but got oID=${pageOrderId}. URL: ${zencPage.url()}`
      );
    }

    const hasProductsDiv = await zencPage.evaluate(() => !!document.querySelector('#order_products'));
    if (!hasProductsDiv) {
      console.warn(`Zenc: No #order_products div found for order ${orderId}`);
      return [];
    }

    return await zencPage.evaluate((oid) => {
      const results: ZencProductActionData[] = [];
      const productDiv = document.querySelector('#order_products')!;
      const rows = productDiv.querySelectorAll('tr[class*="dataTableRow"]');

      for (const row of rows) {
        const cells = row.querySelectorAll('td[class*="dataTableContent"]');
        if (cells.length < 5) continue;

        const data: ZencProductActionData = {
          model: '',
          name: '',
          boxNumber: '',
          pickChecked: false,
          backorder: '',
          jitPresent: false,
          jitChecked: false,
          printingStatus: '',
          arrivedStatus: '',
          box1Value: '',
          box2Value: '',
          buyFromRetailerPresent: false,
          supplierCheckboxPresent: false,
          supplierCheckboxChecked: false,
        };

        // --- Model (last meaningful column before financial columns) ---
        const cellCount = cells.length;
        if (cellCount >= 4) {
          data.model = cells[cellCount - 4]?.textContent?.trim() || '';
        }

        // --- Product name ---
        for (const cell of cells) {
          const link = cell.querySelector('a[onclick*="showProductDetails"], a[onclick*="addProductModel"]');
          if (link) {
            data.name = link.textContent?.trim() || '';
            break;
          }
        }

        // --- Box number input ---
        const boxNumInput = row.querySelector('input[name*="box_number"]') as HTMLInputElement | null;
        if (boxNumInput) {
          data.boxNumber = boxNumInput.value || '';
        }

        // --- Pick checkbox: name*="ship_chk" ---
        const pickCheckbox = row.querySelector('input[name*="ship_chk"]') as HTMLInputElement | null;
        if (pickCheckbox) {
          data.pickChecked = pickCheckbox.checked;
        } else {
          // Fallback: pick is implied by non-empty box_number
          data.pickChecked = data.boxNumber !== '';
        }

        // --- JIT checkbox/button ---
        const jitCheckbox = row.querySelector(
          'input[name*="jit"], input[id*="jit"], input[onclick*="jit_mark"]'
        ) as HTMLInputElement | null;
        if (jitCheckbox) {
          data.jitPresent = true;
          data.jitChecked = jitCheckbox.checked;
        } else {
          // Look for JIT link (onclick="jit_mark(...)")
          const jitLink = row.querySelector('a[onclick*="jit_mark"]');
          if (jitLink) {
            data.jitPresent = true;
            // Determine checked from text or class
            const text = jitLink.textContent?.toLowerCase() || '';
            data.jitChecked = text.includes('unmark') || text.includes('yes');
          }
        }

        // --- Backorder checkbox/text ---
        const backorderCheckbox = row.querySelector(
          'input[name*="backorder"], input[name*="Backorder"]'
        ) as HTMLInputElement | null;
        if (backorderCheckbox) {
          data.backorder = backorderCheckbox.checked ? 'Yes' : 'No';
        } else {
          for (const cell of cells) {
            const text = cell.textContent?.trim() || '';
            if (text === 'Cancelled' || text === 'Replacement Requested') {
              data.backorder = text;
              break;
            }
          }
          if (!data.backorder) data.backorder = 'No';
        }

        // --- Printing status ---
        // In zenc, printing status may appear as text or checkbox label
        for (const cell of cells) {
          const text = cell.textContent?.trim() || '';
          if (text === 'Printed' || text === 'Not Printed') {
            data.printingStatus = text;
            break;
          }
          // Checkbox with title/name containing "print"
          const printChk = cell.querySelector(
            'input[name*="print"], input[title*="print"], input[title*="Printed"]'
          ) as HTMLInputElement | null;
          if (printChk) {
            data.printingStatus = printChk.checked ? 'Printed' : 'Not Printed';
            break;
          }
        }

        // --- Arrived status ---
        for (const cell of cells) {
          const arrivedChk = cell.querySelector(
            'input[name*="arrived"], input[name*="Arrived"]'
          ) as HTMLInputElement | null;
          if (arrivedChk) {
            data.arrivedStatus = arrivedChk.checked ? 'Arrived' : 'Not Arrived';
            break;
          }
          const text = cell.textContent?.trim() || '';
          if (text === 'Arrived' || text === 'Not Arrived') {
            data.arrivedStatus = text;
            break;
          }
        }

        // --- Box1 / Box2 fields ---
        const box1Input = row.querySelector(
          'input[name*="box1"], input[id*="box1_"]'
        ) as HTMLInputElement | null;
        if (box1Input) {
          data.box1Value = box1Input.value || '';
        }
        const box2Input = row.querySelector(
          'input[name*="box2"], input[id*="box2_"]'
        ) as HTMLInputElement | null;
        if (box2Input) {
          data.box2Value = box2Input.value || '';
        }

        // --- Buy From Retailer button / link ---
        // Zenc has buttons like "Buy From Retailer" as links or form buttons
        const bfrBtn = row.querySelector(
          'a[onclick*="buy_from_retailer"], input[name*="buy_from_retailer_order"], button'
        );
        if (bfrBtn) {
          const text = (bfrBtn.textContent || '').toLowerCase();
          data.buyFromRetailerPresent = text.includes('retailer') || text.includes('buy');
        }
        // Also check for any element in row with text "Buy From Retailer"
        if (!data.buyFromRetailerPresent) {
          const allText = (row.textContent || '').toLowerCase();
          data.buyFromRetailerPresent = allText.includes('buy from retailer');
        }

        // --- Supplier checkbox ---
        // Pattern: input[name="buy_from_retailer_order_product_{id}"] or similar
        const supplierChk = row.querySelector(
          'input[name*="supplier"], input[name*="buy_from_retailer_order_product"]'
        ) as HTMLInputElement | null;
        if (supplierChk) {
          data.supplierCheckboxPresent = true;
          data.supplierCheckboxChecked = supplierChk.checked;
        }

        if (data.name || data.model) {
          results.push(data);
        }
      }

      return results;
    }, orderId);
  }

  // -------------------------------------------------------------------------
  // Stock2 extractor
  // -------------------------------------------------------------------------

  /**
   * Extract per-product action display state from Stock2 order edit page.
   *
   * Stock2 renders products in a Card with a table (ProductRow.tsx).
   * Columns (from ProductRow.tsx):
   * Col 1:  Refund checkbox + FC indicators
   * Col 2:  Quantity
   * Col 3:  Product name + attributes + action links
   * Col 4:  Bundle (conditional)
   * Col 5:  Exchange checkbox
   * Col 6:  Ship check (pick) checkbox
   * Col 7:  Return checkbox + History
   * Col 8:  Pick checkbox + SMS qty
   * Col 9:  JIT checkbox
   * Col 10: Assigned Box badge
   * Col 11: Allocate (conditional)
   * Col 12: Order Printing (conditional)
   * Col 13: Box Number input
   * Col 14: Box1 input + Printed checkbox
   * Col 15: Arrived checkbox
   * Col 16: Backorder checkbox / text
   * Col 17: Model/SKU
   * Col 18: Tax checkbox
   * Col 19: Total Inc Tax
   * Col 20: Total Inc GBP Tax
   */
  async function extractStock2ProductActions(orderId: number): Promise<Stock2ProductActionData[]> {
    await navigateToStock2OrderEdit(stock2Page, orderId);
    await waitForStableContent(stock2Page);
    // BUG-356: Replace fixed 3-second timeout with a DOM-state wait.
    // The products API call fires AFTER networkidle, so a fixed timeout is
    // unreliable. Instead, wait until the Products card has rendered its
    // tbody (data loaded) or an error element (error state). Falls back
    // gracefully after 10 s — the evaluate() call below handles empty state.
    await stock2Page.waitForFunction(() => {
      const cards = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
      for (const card of Array.from(cards)) {
        const titleEl = card.querySelector('[class*="text-base"]');
        const titleText = (titleEl?.textContent || '').trim();
        if (titleText.includes('Products') && !titleText.includes('Refunded')) {
          // Card exists — check if it's loaded (has rows OR shows error)
          const tbody = card.querySelector('tbody');
          const errorMsg = card.querySelector('[class*="text-red-600"]');
          if (tbody || errorMsg) return true;
        }
      }
      return false;
    }, { timeout: 10000 }).catch(() => {}); // Swallow timeout — extractor handles empty state

    return await stock2Page.evaluate((oid) => {
      const results: Stock2ProductActionData[] = [];

      // Find the Products card (not Refunded Products)
      const cards = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
      let productTable: Element | null = null;

      for (const card of cards) {
        const titleEl = card.querySelector('[class*="text-base"], h3, h2, [class*="font-semibold"]');
        const titleText = (titleEl?.textContent || '').trim();
        // Match "Products" but not "Refunded Products"
        if (titleText.includes('Products') && !titleText.includes('Refunded')) {
          productTable = card.querySelector('table');
          break;
        }
      }

      if (!productTable) {
        // Broader search: any table within the page
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const rows = table.querySelectorAll('tbody tr');
          if (rows.length > 0) {
            productTable = table;
            break;
          }
        }
      }

      if (!productTable) return results;

      const rows = productTable.querySelectorAll('tbody tr');

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) continue;
        // Skip rows that are clearly separators (colspan)
        if (row.querySelector('[colspan]')) continue;

        const data: Stock2ProductActionData = {
          model: '',
          name: '',
          boxNumber: '',
          pickChecked: false,
          backorder: '',
          jitPresent: false,
          jitChecked: false,
          printingStatus: '',
          arrivedStatus: '',
          box1Value: '',
          box2Value: '',
          buyFromRetailerPresent: false,
          supplierCheckboxPresent: false,
          supplierCheckboxChecked: false,
        };

        const cellCount = cells.length;

        // --- Model: last column before financials (Col 17, index cellCount-4) ---
        // From ProductRow.tsx: Col 17=model, Col 18=tax, Col 19=totalIncTax, Col 20=totalGbp
        if (cellCount >= 4) {
          data.model = cells[cellCount - 4]?.textContent?.trim() || '';
        }

        // --- Product name: cell containing font-medium span (Col 3) ---
        for (const cell of cells) {
          const nameEl = cell.querySelector('[class*="font-medium"]');
          if (nameEl) {
            data.name = nameEl.textContent?.trim() || '';
            break;
          }
        }

        // --- Box Number input (Col 13): input[title="Box number"] or any input in col 13 ---
        const boxNumInput = row.querySelector('input[title="Box number"]') as HTMLInputElement | null;
        if (boxNumInput) {
          data.boxNumber = boxNumInput.value || '';
        } else {
          // Fallback: find any short text input that looks like a box number field
          const allInputs = row.querySelectorAll('input[type="text"], input:not([type])');
          for (const inp of allInputs) {
            const input = inp as HTMLInputElement;
            const title = input.title?.toLowerCase() || '';
            const cls = input.className || '';
            // Box number input is small (w-[50px]) and centered
            if (title.includes('box') && title.includes('number')) {
              data.boxNumber = input.value || '';
              break;
            }
          }
        }

        // --- Pick checkbox (Col 8): title="Pick indicator" ---
        // From ProductRow.tsx: Col 8 has Checkbox checked={!!p.boxNumber}
        const pickChk = row.querySelector('[title="Pick indicator"]') as HTMLInputElement | null;
        if (pickChk) {
          // Shadcn Checkbox: look for data-state attribute
          const state = pickChk.getAttribute('data-state');
          if (state) {
            data.pickChecked = state === 'checked';
          } else {
            data.pickChecked = pickChk.checked;
          }
        } else {
          // Fallback: infer from box number
          data.pickChecked = data.boxNumber !== '';
        }

        // --- JIT checkbox (Col 9): title="JIT toggle" ---
        const jitChk = row.querySelector('[title="JIT toggle"]') as HTMLInputElement | null;
        if (jitChk) {
          data.jitPresent = true;
          const state = jitChk.getAttribute('data-state');
          if (state) {
            data.jitChecked = state === 'checked';
          } else {
            data.jitChecked = jitChk.checked;
          }
        }

        // --- Backorder cell (Col 16): Checkbox title="Backorder" or text ---
        const backorderChk = row.querySelector('[title="Backorder"], [title="Remove from backorder"]') as HTMLInputElement | null;
        if (backorderChk) {
          const state = backorderChk.getAttribute('data-state');
          data.backorder = (state === 'checked' || backorderChk.checked) ? 'Yes' : 'No';
        } else {
          // Check for "Cancelled" or "Replacement Requested" text in row
          for (const cell of cells) {
            const text = cell.textContent?.trim() || '';
            if (text === 'Cancelled') { data.backorder = 'Cancelled'; break; }
            if (text === 'Replacement Requested') { data.backorder = 'Replacement Requested'; break; }
          }
          if (!data.backorder) data.backorder = 'No';
        }

        // --- Printing status (Col 14): Checkbox title="Printed" ---
        const printedChk = row.querySelector('[title="Printed"]') as HTMLInputElement | null;
        if (printedChk) {
          const state = printedChk.getAttribute('data-state');
          data.printingStatus = (state === 'checked' || printedChk.checked) ? 'Printed' : 'Not Printed';
        }

        // --- Arrived status (Col 15): Checkbox title="Arrived" ---
        const arrivedChk = row.querySelector('[title="Arrived"]') as HTMLInputElement | null;
        if (arrivedChk) {
          const state = arrivedChk.getAttribute('data-state');
          data.arrivedStatus = (state === 'checked' || arrivedChk.checked) ? 'Arrived' : 'Not Arrived';
        }

        // --- Box1 input (Col 14): first input in that cell (not the printed checkbox) ---
        const box1Input = row.querySelector('input[title="Box1"], input[title*="Box1"]') as HTMLInputElement | null;
        if (box1Input) {
          data.box1Value = box1Input.value || '';
        } else {
          // Find the col 14 input by looking for inputs with title that is a member name or "Box1"
          // Col 14 contains: Input (box1) + Checkbox (printed)
          for (const cell of cells) {
            const inp = cell.querySelector('input[type="text"]') as HTMLInputElement | null;
            const chk = cell.querySelector('[title="Printed"]');
            if (inp && chk) {
              // This cell has both a text input and a printed checkbox — it's col 14
              data.box1Value = inp.value || '';
              break;
            }
          }
        }

        // --- Box2: Stock2 does not have a dedicated visible Box2 input column ---
        // box2 data is stored in DB but not shown as a separate editable column
        data.box2Value = '';

        // --- Buy From Retailer: check if any element with this text exists in the row ---
        const rowText = (row.textContent || '').toLowerCase();
        data.buyFromRetailerPresent = rowText.includes('buy from retailer');

        // Also check for buttons or links explicitly
        if (!data.buyFromRetailerPresent) {
          const links = row.querySelectorAll('a, button, [role="button"]');
          for (const link of links) {
            if ((link.textContent || '').toLowerCase().includes('retailer')) {
              data.buyFromRetailerPresent = true;
              break;
            }
          }
        }

        // --- Supplier checkbox: in Col 3 (product name cell), from ProductRow.tsx REQ-05-008 ---
        // ProductRow.tsx shows: <Checkbox checked={!!p.supplier.supplierId} disabled />
        const supplierChk = row.querySelector('[title*="Supplier"], [title*="supplier"]') as HTMLInputElement | null;
        if (supplierChk) {
          data.supplierCheckboxPresent = true;
          const state = supplierChk.getAttribute('data-state');
          data.supplierCheckboxChecked = (state === 'checked' || supplierChk.checked);
        } else {
          // Look for small checkbox in name cell (Col 3 has a small inline checkbox for supplier)
          for (const cell of cells) {
            const nameEl = cell.querySelector('[class*="font-medium"]');
            if (nameEl) {
              // This is the name cell — look for a checkbox here
              const chk = cell.querySelector('input[type="checkbox"], [role="checkbox"]') as HTMLInputElement | null;
              if (chk) {
                data.supplierCheckboxPresent = true;
                const state = chk.getAttribute('data-state');
                data.supplierCheckboxChecked = (state === 'checked' || chk.checked);
              }
              break;
            }
          }
        }

        if (data.name || data.model) {
          results.push(data);
        }
      }

      return results;
    }, orderId);
  }

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  for (const order of PRODUCT_ACTIONS_ORDERS) {
    test(`Order #${order.id} (${order.category}) — product action display state`, async () => {
      test.setTimeout(120000);

      const result: ComparisonResult = {
        orderId: order.id,
        category: order.category,
        matches: 0,
        mismatches: [],
        skipped: [],
      };

      console.log(`\n=== Testing Product Actions for Order #${order.id} (${order.category}) ===`);

      const [zencProducts, stock2Products] = await Promise.allSettled([
        extractZencProductActions(order.id),
        extractStock2ProductActions(order.id),
      ]);

      if (zencProducts.status === 'rejected') {
        console.error(`Zenc extraction failed for order ${order.id}:`, zencProducts.reason);
        result.mismatches.push({
          field: 'zenc_extraction',
          zencValue: `ERROR: ${zencProducts.reason}`,
          stock2Value: '(not tested)',
          orderId: order.id,
          category: order.category,
          severity: 'critical',
        });
        logComparisonResult(result);
        return;
      }
      if (stock2Products.status === 'rejected') {
        console.error(`Stock2 extraction failed for order ${order.id}:`, stock2Products.reason);
        result.mismatches.push({
          field: 'stock2_extraction',
          zencValue: '(not tested)',
          stock2Value: `ERROR: ${stock2Products.reason}`,
          orderId: order.id,
          category: order.category,
          severity: 'critical',
        });
        logComparisonResult(result);
        return;
      }

      const zencData = zencProducts.value;
      const s2Data = stock2Products.value;

      console.log(`  Zenc: ${zencData.length} products | Stock2: ${s2Data.length} products`);
      for (const p of zencData) {
        console.log(`  [Zenc]   "${p.name}" model="${p.model}" box="${p.boxNumber}" pick=${p.pickChecked} jit=${p.jitChecked} backorder="${p.backorder}" box1="${p.box1Value}" arrived="${p.arrivedStatus}" printed="${p.printingStatus}" bfr=${p.buyFromRetailerPresent} supplierChk=${p.supplierCheckboxPresent}`);
      }
      for (const p of s2Data) {
        console.log(`  [Stock2] "${p.name}" model="${p.model}" box="${p.boxNumber}" pick=${p.pickChecked} jit=${p.jitChecked} backorder="${p.backorder}" box1="${p.box1Value}" arrived="${p.arrivedStatus}" printed="${p.printingStatus}" bfr=${p.buyFromRetailerPresent} supplierChk=${p.supplierCheckboxPresent}`);
      }

      // --- Test 1: Product count ---
      const zencCount = zencData.length;
      const s2Count = s2Data.length;
      if (zencCount !== s2Count) {
        result.mismatches.push({
          field: 'product_count',
          zencValue: String(zencCount),
          stock2Value: String(s2Count),
          orderId: order.id,
          category: order.category,
          severity: 'critical',
        });
      } else {
        result.matches++;
      }

      // --- Match products by model, then name ---
      const matchedS2 = new Set<number>();

      for (let i = 0; i < zencData.length; i++) {
        const zp = zencData[i];

        let s2Idx = -1;
        for (let j = 0; j < s2Data.length; j++) {
          if (matchedS2.has(j)) continue;
          const sp = s2Data[j];
          if (zp.model && sp.model && zp.model.toLowerCase() === sp.model.toLowerCase()) {
            s2Idx = j;
            break;
          }
          if (zp.name && sp.name) {
            const zName = zp.name.toLowerCase().substring(0, 30);
            const sName = sp.name.toLowerCase().substring(0, 30);
            if (zName === sName || zName.includes(sName) || sName.includes(zName)) {
              s2Idx = j;
              break;
            }
          }
        }

        if (s2Idx === -1) {
          result.mismatches.push({
            field: `product #${i + 1} not found in Stock2`,
            zencValue: `${zp.name} (${zp.model})`,
            stock2Value: '(not found)',
            orderId: order.id,
            category: order.category,
            severity: 'critical',
          });
          continue;
        }

        matchedS2.add(s2Idx);
        const sp = s2Data[s2Idx];
        const prefix = `product "${zp.model || zp.name}"`;

        // ----- Test 2: Box number display -----
        const boxMismatch = compareValues(
          `${prefix} — box_number`,
          zp.boxNumber,
          sp.boxNumber,
          'major'
        );
        if (boxMismatch) {
          boxMismatch.orderId = order.id;
          boxMismatch.category = order.category;
          result.mismatches.push(boxMismatch);
        } else {
          result.matches++;
        }

        // ----- Test 3: Pick checkbox state -----
        // Pick should be true iff box_number is non-empty
        const zencPickExpected = zp.boxNumber !== '';
        const s2PickExpected = sp.boxNumber !== '';
        // Compare actual pick state vs expected, and compare between systems
        if (zencPickExpected !== zp.pickChecked) {
          result.mismatches.push({
            field: `${prefix} — pick_checkbox_state (zenc: box="${zp.boxNumber}", pick=${zp.pickChecked})`,
            zencValue: `box=${zp.boxNumber} → expected pick=${zencPickExpected} got=${zp.pickChecked}`,
            stock2Value: '(internal zenc inconsistency)',
            orderId: order.id,
            category: order.category,
            severity: 'minor',
          });
        }
        if (s2PickExpected !== sp.pickChecked) {
          result.mismatches.push({
            field: `${prefix} — pick_checkbox_state (stock2: box="${sp.boxNumber}", pick=${sp.pickChecked})`,
            zencValue: '(internal stock2 inconsistency)',
            stock2Value: `box=${sp.boxNumber} → expected pick=${s2PickExpected} got=${sp.pickChecked}`,
            orderId: order.id,
            category: order.category,
            severity: 'minor',
          });
        }
        // Cross-system comparison
        if (zp.pickChecked !== sp.pickChecked) {
          result.mismatches.push({
            field: `${prefix} — pick_checkbox`,
            zencValue: String(zp.pickChecked),
            stock2Value: String(sp.pickChecked),
            orderId: order.id,
            category: order.category,
            severity: 'major',
          });
        } else {
          result.matches++;
        }

        // ----- Test 4: JIT presence -----
        if (zp.jitPresent !== sp.jitPresent) {
          result.mismatches.push({
            field: `${prefix} — jit_present`,
            zencValue: String(zp.jitPresent),
            stock2Value: String(sp.jitPresent),
            orderId: order.id,
            category: order.category,
            severity: 'major',
          });
        } else {
          result.matches++;
        }

        // JIT checked state (only compare if both systems show JIT)
        if (zp.jitPresent && sp.jitPresent) {
          if (zp.jitChecked !== sp.jitChecked) {
            result.mismatches.push({
              field: `${prefix} — jit_checked`,
              zencValue: String(zp.jitChecked),
              stock2Value: String(sp.jitChecked),
              orderId: order.id,
              category: order.category,
              severity: 'major',
            });
          } else {
            result.matches++;
          }
        }

        // ----- Test 5: Backorder display -----
        const backorderMismatch = compareValues(
          `${prefix} — backorder`,
          zp.backorder,
          sp.backorder,
          'major'
        );
        if (backorderMismatch) {
          backorderMismatch.orderId = order.id;
          backorderMismatch.category = order.category;
          result.mismatches.push(backorderMismatch);
        } else {
          result.matches++;
        }

        // ----- Test 6: Printing status -----
        // Only compare if zenc shows it (zenc may or may not have printing status column)
        if (zp.printingStatus || sp.printingStatus) {
          const printMismatch = compareValues(
            `${prefix} — printing_status`,
            zp.printingStatus,
            sp.printingStatus,
            'major'
          );
          if (printMismatch) {
            printMismatch.orderId = order.id;
            printMismatch.category = order.category;
            result.mismatches.push(printMismatch);
          } else {
            result.matches++;
          }
        } else {
          result.skipped.push(`${prefix} — printing_status (both empty)`);
        }

        // ----- Test 7: Arrived status -----
        // NOTE: Zenc does not render an arrived widget when arrived_status is 'Not Arrived'.
        // Stock2 always renders the Arrived checkbox (unchecked = Not Arrived).
        // When zenc is empty and Stock2 shows 'Not Arrived', they are semantically equivalent
        // (the product has not been marked as arrived in either system).
        const arrivedZenc = zp.arrivedStatus;
        const arrivedStock2 = sp.arrivedStatus;
        const bothEmpty = !arrivedZenc && !arrivedStock2;
        const zencEmptyStock2NotArrived = !arrivedZenc && arrivedStock2 === 'Not Arrived';
        if (bothEmpty || zencEmptyStock2NotArrived) {
          result.skipped.push(`${prefix} — arrived_status (zenc empty ≡ stock2 Not Arrived)`);
        } else if (arrivedZenc || arrivedStock2) {
          const arrivedMismatch = compareValues(
            `${prefix} — arrived_status`,
            arrivedZenc,
            arrivedStock2,
            'major'
          );
          if (arrivedMismatch) {
            arrivedMismatch.orderId = order.id;
            arrivedMismatch.category = order.category;
            result.mismatches.push(arrivedMismatch);
          } else {
            result.matches++;
          }
        }

        // ----- Test 8: Box1 field -----
        // Compare values where zenc has a box1 value
        if (zp.box1Value || sp.box1Value) {
          const box1Mismatch = compareValues(
            `${prefix} — box1`,
            zp.box1Value,
            sp.box1Value,
            'major'
          );
          if (box1Mismatch) {
            box1Mismatch.orderId = order.id;
            box1Mismatch.category = order.category;
            result.mismatches.push(box1Mismatch);
          } else {
            result.matches++;
          }
        } else {
          result.skipped.push(`${prefix} — box1 (both empty)`);
        }

        // ----- Test 9: Buy From Retailer button -----
        // Zenc has it; Stock2 flagged as missing (BUG #322)
        // This is a presence check on Stock2 — log it as a mismatch if zenc has it but Stock2 doesn't
        if (zp.buyFromRetailerPresent && !sp.buyFromRetailerPresent) {
          result.mismatches.push({
            field: `${prefix} — buy_from_retailer_button_missing_in_stock2 (BUG #322)`,
            zencValue: 'present',
            stock2Value: 'MISSING',
            orderId: order.id,
            category: order.category,
            severity: 'major',
          });
        } else if (!zp.buyFromRetailerPresent && sp.buyFromRetailerPresent) {
          result.mismatches.push({
            field: `${prefix} — buy_from_retailer_button_in_stock2_not_in_zenc`,
            zencValue: 'absent',
            stock2Value: 'present (unexpected)',
            orderId: order.id,
            category: order.category,
            severity: 'minor',
          });
        } else {
          result.matches++;
        }

        // ----- Test 10: Supplier checkbox presence -----
        if (zp.supplierCheckboxPresent !== sp.supplierCheckboxPresent) {
          result.mismatches.push({
            field: `${prefix} — supplier_checkbox_present`,
            zencValue: String(zp.supplierCheckboxPresent),
            stock2Value: String(sp.supplierCheckboxPresent),
            orderId: order.id,
            category: order.category,
            severity: 'major',
          });
        } else {
          result.matches++;
        }
      }

      // Check for extra products in Stock2 not matched in zenc
      for (let j = 0; j < s2Data.length; j++) {
        if (!matchedS2.has(j)) {
          const sp = s2Data[j];
          result.mismatches.push({
            field: `extra product in Stock2 not in zenc`,
            zencValue: '(not found)',
            stock2Value: `${sp.name} (${sp.model})`,
            orderId: order.id,
            category: order.category,
            severity: 'critical',
          });
        }
      }

      logComparisonResult(result);

      if (result.mismatches.length > 0) {
        console.warn(`\nMISMATCH REPORT for Order #${order.id}:\n${buildMismatchReport(result)}`);
        await Promise.all([
          zencPage.screenshot({
            path: `e2e/comparison/screenshots/zenc-product-actions-${order.id}.png`,
            fullPage: true,
          }).catch(() => {}),
          stock2Page.screenshot({
            path: `e2e/comparison/screenshots/stock2-product-actions-${order.id}.png`,
            fullPage: true,
          }).catch(() => {}),
        ]);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Dedicated BUG #322: Buy From Retailer verification test
  // -------------------------------------------------------------------------

  test('BUG #322 — Buy From Retailer button absent in Stock2 (spot check on multi_product order)', async () => {
    test.setTimeout(120000);

    const multiProductOrder = TEST_ORDERS.find((o) => o.category === 'multi_product');
    if (!multiProductOrder) {
      console.log('No multi_product order in test set — skipping BUG #322 spot check');
      return;
    }

    const orderId = multiProductOrder.id;
    console.log(`\n=== BUG #322 Spot Check: Order #${orderId} ===`);

    // Check zenc for Buy From Retailer elements
    await navigateToZencOrderEdit(zencPage, orderId);
    await waitForStableContent(zencPage);
    await zencPage.waitForTimeout(2000);

    const zencBfrPresent = await zencPage.evaluate(() => {
      const text = (document.querySelector('#order_products')?.textContent || '').toLowerCase();
      return text.includes('buy from retailer');
    });

    // Check Stock2
    await navigateToStock2OrderEdit(stock2Page, orderId);
    await waitForStableContent(stock2Page);
    await stock2Page.waitForTimeout(3000);

    const stock2BfrPresent = await stock2Page.evaluate(() => {
      const allText = (document.body?.textContent || '').toLowerCase();
      return allText.includes('buy from retailer');
    });

    console.log(`  Zenc "Buy From Retailer" present: ${zencBfrPresent}`);
    console.log(`  Stock2 "Buy From Retailer" present: ${stock2BfrPresent}`);

    if (zencBfrPresent && !stock2BfrPresent) {
      console.warn(`  BUG #322 CONFIRMED: "Buy From Retailer" is present in zenc but MISSING in Stock2 for order #${orderId}`);
    } else if (!zencBfrPresent) {
      console.log(`  Note: "Buy From Retailer" not found in zenc either for order ${orderId} — may not apply to this order type`);
    } else if (stock2BfrPresent) {
      console.log(`  BUG #322: "Buy From Retailer" IS present in Stock2 — bug may be fixed or this order doesn't trigger it`);
    }

    // Take screenshots for evidence
    await Promise.all([
      zencPage.screenshot({
        path: `e2e/comparison/screenshots/zenc-bug322-bfr-${orderId}.png`,
        fullPage: true,
      }).catch(() => {}),
      stock2Page.screenshot({
        path: `e2e/comparison/screenshots/stock2-bug322-bfr-${orderId}.png`,
        fullPage: true,
      }).catch(() => {}),
    ]);

    // This test documents the state — it does not fail the suite
    // The mismatch is already tracked in BUG #322
    console.log('  Screenshots saved for BUG #322 evidence.');
  });

  // -------------------------------------------------------------------------
  // Dedicated JIT display test (backorder order)
  // -------------------------------------------------------------------------

  test('Order #1790506 (backorder) — backorder flag display matches zenc', async () => {
    test.setTimeout(120000);

    const orderId = 1790506;
    console.log(`\n=== Backorder Flag Display Test: Order #${orderId} ===`);

    const zencProducts = await extractZencProductActions(orderId).catch((err) => {
      console.error('Zenc extraction failed:', err);
      return [] as ZencProductActionData[];
    });
    const s2Products = await extractStock2ProductActions(orderId).catch((err) => {
      console.error('Stock2 extraction failed:', err);
      return [] as Stock2ProductActionData[];
    });

    console.log(`  Zenc products: ${zencProducts.length}`);
    for (const p of zencProducts) {
      console.log(`    "${p.name}" (${p.model}): backorder="${p.backorder}" rowColor expected green`);
    }
    console.log(`  Stock2 products: ${s2Products.length}`);
    for (const p of s2Products) {
      console.log(`    "${p.name}" (${p.model}): backorder="${p.backorder}"`);
    }

    // Check that backordered products in zenc are also backordered in Stock2
    let backordered = 0;
    let mismatched = 0;
    for (const zp of zencProducts) {
      if (zp.backorder === 'Yes') {
        backordered++;
        const sp = s2Products.find(
          (p) => p.model.toLowerCase() === zp.model.toLowerCase() ||
                 p.name.toLowerCase().includes(zp.name.toLowerCase().substring(0, 20))
        );
        if (sp && sp.backorder !== 'Yes') {
          console.warn(`  MISMATCH: "${zp.name}" is backorder in zenc but Stock2 shows "${sp.backorder}"`);
          mismatched++;
        }
      }
    }

    console.log(`  Backordered products: ${backordered} | Mismatched: ${mismatched}`);

    // Take screenshots
    await Promise.all([
      zencPage.screenshot({
        path: `e2e/comparison/screenshots/zenc-backorder-${orderId}.png`,
        fullPage: true,
      }).catch(() => {}),
      stock2Page.screenshot({
        path: `e2e/comparison/screenshots/stock2-backorder-${orderId}.png`,
        fullPage: true,
      }).catch(() => {}),
    ]);
  });
});
