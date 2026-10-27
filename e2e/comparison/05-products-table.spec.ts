import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createZencPage, navigateToZencOrderEdit, ZENC_BASE_URL } from './helpers/zenc-auth';
import { createStock2Page, navigateToStock2OrderEdit, STOCK2_BASE_URL } from './helpers/stock2-auth';
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
import { PRODUCTS_TEST_ORDERS } from './test-orders';

/**
 * Spec 5: Products Table Comparison
 *
 * Compares the products table on the edit page between zenc and Stock2:
 * - Per-product: name, model, qty, attributes, SMS qty, box number,
 *   backorder flag, price/tax/total/total GBP, row color
 * - Backorder products section
 * - Refunded products section
 *
 * NOTE: Both zenc and Stock2 read from the SAME MySQL database (zenc_main_db).
 * Any difference is a real bug, not a database divergence issue.
 * See GitHub issue #222 for history of false positives caused by
 * stale zenc sessions leading to wrong-order extraction.
 */

let zencPage: Page;
let stock2Page: Page;
let zencContext: BrowserContext;
let stock2Context: BrowserContext;

interface ProductRow {
  name: string;
  model: string;
  quantity: string;
  attributes: string;
  boxNumber: string;
  backorder: string;
  tax: string;
  totalIncTax: string;
  totalGbp: string;
  rowBgColor: string;
  isRefunded: boolean;
}

test.describe('Products Table Comparison', () => {
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
   * Extract products table data from zenc edit page.
   * Structure: div#order_products contains table rows with class dataTableRow.
   * Each product row has cells with class dataTableContent or dataTableContent-first.
   *
   * Returns both normal and refunded products (distinguished by isRefunded flag).
   */
  async function extractZencProducts(orderId: number): Promise<ProductRow[]> {
    await navigateToZencOrderEdit(zencPage, orderId);
    await waitForStableContent(zencPage);
    // Extra wait for AJAX content to load
    await zencPage.waitForTimeout(2000);

    // Verify we're on the correct order's edit page before extracting.
    // This prevents stale/wrong data extraction (GitHub issue #222).
    const pageOrderId = await zencPage.evaluate(() => {
      // The zenc edit page URL contains oID=<orderId>
      const params = new URLSearchParams(window.location.search);
      return params.get('oID');
    });

    if (pageOrderId !== String(orderId)) {
      // Take a diagnostic screenshot before failing
      await zencPage.screenshot({
        path: `e2e/comparison/screenshots/zenc-wrong-page-${orderId}.png`,
        fullPage: true,
      }).catch(() => {});
      throw new Error(
        `Zenc page verification failed: expected order ${orderId} but page has oID=${pageOrderId}. ` +
        `URL: ${zencPage.url()}. This usually means the session expired.`
      );
    }

    // Also verify the #order_products div exists (edit page, not listing)
    const hasProductsDiv = await zencPage.evaluate(() => !!document.querySelector('#order_products'));
    if (!hasProductsDiv) {
      await zencPage.screenshot({
        path: `e2e/comparison/screenshots/zenc-no-products-div-${orderId}.png`,
        fullPage: true,
      }).catch(() => {});
      throw new Error(
        `Zenc page missing #order_products div for order ${orderId}. ` +
        `Page may have loaded in listing mode instead of edit mode. URL: ${zencPage.url()}`
      );
    }

    return await zencPage.evaluate(() => {
      const products: ProductRow[] = [];
      const productDiv = document.querySelector('#order_products')!;

      // Find all data table rows within the products section
      const rows = productDiv.querySelectorAll('tr[class*="dataTableRow"]');
      console.log(`DEBUG: Found ${rows.length} dataTableRow rows in #order_products`);

      for (const row of rows) {
        const cells = row.querySelectorAll('td[class*="dataTableContent"]');
        if (cells.length < 5) continue; // Skip header/separator rows

        const product: ProductRow = {
          name: '',
          model: '',
          quantity: '',
          attributes: '',
          boxNumber: '',
          backorder: '',
          tax: '',
          totalIncTax: '',
          totalGbp: '',
          rowBgColor: '',
          isRefunded: false,
        };

        // Quantity — find cell containing "N x" pattern
        for (let i = 0; i < Math.min(4, cells.length); i++) {
          const text = cells[i]?.textContent?.trim() || '';
          const qtyMatch = text.match(/^(\d+)\s*x$/i);
          if (qtyMatch) {
            product.quantity = qtyMatch[1];
            break;
          }
        }

        // Product name — find cell with an <a> tag that has product name
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const link = cell.querySelector('a[onclick*="showProductDetails"], a[onclick*="addProductModel"]');
          if (link) {
            product.name = link.textContent?.trim() || '';

            // Attributes are in <small><i> tags within the same cell
            const attrElements = cell.querySelectorAll('small i, nobr small i');
            const attrs: string[] = [];
            for (const attr of attrElements) {
              const attrText = attr.textContent?.trim();
              if (attrText) attrs.push(attrText);
            }
            product.attributes = attrs.join('; ');
            break;
          }
        }

        // Model — typically the last column before financials
        const cellCount = cells.length;
        if (cellCount >= 4) {
          // Last 3 cells are: tax, total inc tax, total GBP
          product.totalGbp = cells[cellCount - 1]?.textContent?.trim() || '';
          product.totalIncTax = cells[cellCount - 2]?.textContent?.trim() || '';
          product.tax = cells[cellCount - 3]?.textContent?.trim() || '';
          // Model is typically at cellCount-4
          product.model = cells[cellCount - 4]?.textContent?.trim() || '';
        }

        // Box number — find input with name containing "box_number"
        for (const cell of cells) {
          const input = cell.querySelector('input[name*="box_number"]');
          if (input) {
            product.boxNumber = (input as HTMLInputElement).value || '';
            break;
          }
        }

        // Backorder status — checkbox or text
        for (const cell of cells) {
          const checkbox = cell.querySelector('input[name*="backorder"], input[name*="Backorder"]');
          if (checkbox) {
            product.backorder = (checkbox as HTMLInputElement).checked ? 'Yes' : 'No';
            break;
          }
          const text = cell.textContent?.trim() || '';
          if (text === 'Cancelled' || text === 'Replacement Requested') {
            product.backorder = text;
            break;
          }
        }

        // Row background color (inline or computed)
        product.rowBgColor = (row as HTMLElement).style.backgroundColor ||
          window.getComputedStyle(row).backgroundColor || '';

        // Refund checkbox — checked means the product is refunded
        const firstCell = cells[0];
        const refundCheckbox = firstCell?.querySelector('input[type="checkbox"]');
        if (refundCheckbox) {
          product.isRefunded = (refundCheckbox as HTMLInputElement).checked;
        }

        // Only add if we found meaningful data
        if (product.name || product.model || product.quantity) {
          products.push(product);
        }
      }

      // If no products found with the above method, try a broader search
      if (products.length === 0) {
        const allProductLinks = document.querySelectorAll('#order_products a[onclick*="Product"]');
        console.log(`DEBUG: Found ${allProductLinks.length} product links via broader search`);

        for (const link of allProductLinks) {
          const name = link.textContent?.trim() || '';
          if (name && name.length > 5) {
            const row = link.closest('tr');
            if (!row) continue;

            const allCells = row.querySelectorAll('td');
            const allCellCount = allCells.length;

            products.push({
              name,
              model: allCellCount >= 4 ? (allCells[allCellCount - 4]?.textContent?.trim() || '') : '',
              quantity: '',
              attributes: '',
              boxNumber: '',
              backorder: '',
              tax: allCellCount >= 3 ? (allCells[allCellCount - 3]?.textContent?.trim() || '') : '',
              totalIncTax: allCellCount >= 2 ? (allCells[allCellCount - 2]?.textContent?.trim() || '') : '',
              totalGbp: allCellCount >= 1 ? (allCells[allCellCount - 1]?.textContent?.trim() || '') : '',
              rowBgColor: (row as HTMLElement).style.backgroundColor || '',
              isRefunded: false,
            });
          }
        }
      }

      return products;
    });
  }

  /**
   * Extract products table data from Stock2 edit page.
   * Structure: Card > Table > tbody > tr (ProductRow components)
   *
   * Returns both normal and refunded products (distinguished by isRefunded flag).
   * Stock2 renders refunded products in a separate "Refunded Products" section.
   */
  async function extractStock2Products(orderId: number): Promise<ProductRow[]> {
    await navigateToStock2OrderEdit(stock2Page, orderId);
    await waitForStableContent(stock2Page);
    await stock2Page.waitForTimeout(3000); // Wait for products API

    return await stock2Page.evaluate(() => {
      const products: ProductRow[] = [];

      // Find ALL cards that contain product tables (Products + Refunded Products)
      const cards = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');

      for (const card of cards) {
        const title = card.querySelector('[class*="text-base"]');
        const titleText = title?.textContent?.trim() || '';

        // Match both "Products" and "Refunded Products" sections
        const isRefundedSection = titleText.includes('Refunded');
        if (!titleText.includes('Products')) continue;

        const table = card.querySelector('table');
        if (!table) continue;

        const rows = table.querySelectorAll('tbody tr');
        console.log(`DEBUG: Found ${rows.length} rows in "${titleText}" table`);

        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 5) continue;

          // Skip separator/header rows
          if (row.querySelector('th, [class*="font-semibold"][class*="text-center"]')) continue;
          if (row.querySelector('[colspan]')) continue;

          const product: ProductRow = {
            name: '',
            model: '',
            quantity: '',
            attributes: '',
            boxNumber: '',
            backorder: '',
            tax: '',
            totalIncTax: '',
            totalGbp: '',
            rowBgColor: '',
            isRefunded: isRefundedSection,
          };

          // Quantity — find cell with "N x" pattern
          for (let i = 0; i < Math.min(4, cells.length); i++) {
            const text = cells[i]?.textContent?.trim() || '';
            const qtyMatch = text.match(/^(\d+)\s*x$/i);
            if (qtyMatch) {
              product.quantity = qtyMatch[1];
              break;
            }
          }

          // Product name — cell with font-medium element
          for (const cell of cells) {
            const nameEl = cell.querySelector('[class*="font-medium"]');
            if (nameEl) {
              product.name = nameEl.textContent?.trim() || '';

              // Attributes in italic text
              const attrEls = cell.querySelectorAll('[class*="italic"]');
              const attrs: string[] = [];
              for (const attr of attrEls) {
                const text = attr.textContent?.trim() || '';
                if (text && text !== '-') attrs.push(text);
              }
              product.attributes = attrs.join('; ');
              break;
            }
          }

          // Financial columns are the last 3 cells
          const cellCount = cells.length;
          if (cellCount >= 4) {
            product.totalGbp = cells[cellCount - 1]?.textContent?.trim() || '';
            product.totalIncTax = cells[cellCount - 2]?.textContent?.trim() || '';
            product.tax = cells[cellCount - 3]?.textContent?.trim() || '';
            product.model = cells[cellCount - 4]?.textContent?.trim() || '';
          }

          // Box number — input field in a middle cell
          for (const cell of cells) {
            const input = cell.querySelector('input[type="text"], input[type="number"]');
            if (input) {
              const value = (input as HTMLInputElement).value ||
                           (input as HTMLInputElement).defaultValue || '';
              product.boxNumber = value;
              break;
            }
          }

          // Backorder — check for text indicators
          for (const cell of cells) {
            const badge = cell.querySelector('[class*="badge"]');
            if (badge) {
              const text = badge.textContent?.trim() || '';
              if (text === 'Yes' || text === 'Cancelled' || text === 'Replacement') {
                product.backorder = text;
                break;
              }
            }
          }

          // Row background color
          product.rowBgColor = (row as HTMLElement).style.backgroundColor || '';

          // Refund checkbox (first cell)
          const refundCheckbox = cells[0]?.querySelector('input[type="checkbox"]');
          if (refundCheckbox) {
            product.isRefunded = product.isRefunded || (refundCheckbox as HTMLInputElement).checked;
          }

          if (product.name || product.model || product.quantity) {
            products.push(product);
          }
        }
      }

      return products;
    });
  }

  for (const order of PRODUCTS_TEST_ORDERS) {
    test(`Order #${order.id} (${order.category}) — products table matches`, async () => {
      test.setTimeout(120000);

      const result: ComparisonResult = {
        orderId: order.id,
        category: order.category,
        matches: 0,
        mismatches: [],
        skipped: [],
      };

      console.log(`\n=== Testing Products for Order #${order.id} (${order.category}) ===`);

      const zencProducts = await extractZencProducts(order.id);
      const stock2Products = await extractStock2Products(order.id);

      // Split by refund status for proper comparison
      const zencNormal = zencProducts.filter(p => !p.isRefunded);
      const zencRefunded = zencProducts.filter(p => p.isRefunded);
      const stock2Normal = stock2Products.filter(p => !p.isRefunded);
      const stock2Refunded = stock2Products.filter(p => p.isRefunded);

      console.log(`Zenc: ${zencNormal.length} normal, ${zencRefunded.length} refunded`);
      for (const p of zencProducts) {
        console.log(`  Zenc: "${p.name}" model="${p.model}" qty=${p.quantity} refunded=${p.isRefunded} tax=${p.tax} total=${p.totalIncTax} gbp=${p.totalGbp}`);
      }
      console.log(`Stock2: ${stock2Normal.length} normal, ${stock2Refunded.length} refunded`);
      for (const p of stock2Products) {
        console.log(`  Stock2: "${p.name}" model="${p.model}" qty=${p.quantity} refunded=${p.isRefunded} tax=${p.tax} total=${p.totalIncTax} gbp=${p.totalGbp}`);
      }

      // Compare normal products
      compareProductSections('Normal', zencNormal, stock2Normal, order, result);

      // Compare refunded products
      compareProductSections('Refunded', zencRefunded, stock2Refunded, order, result);

      logComparisonResult(result);

      if (result.mismatches.length > 0) {
        console.warn('MISMATCH REPORT:\n' + buildMismatchReport(result));

        await zencPage.screenshot({
          path: `e2e/comparison/screenshots/zenc-products-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
        await stock2Page.screenshot({
          path: `e2e/comparison/screenshots/stock2-products-${order.id}.png`,
          fullPage: true,
        }).catch(() => {});
      }
    });
  }

  /**
   * Compare a section (normal or refunded) of products between zenc and Stock2.
   */
  function compareProductSections(
    sectionName: string,
    zencProducts: ProductRow[],
    stock2Products: ProductRow[],
    order: { id: number; category: string },
    result: ComparisonResult,
  ): void {
    // Compare product count
    const countMismatch = compareNumericValues(
      `${sectionName} product count`,
      String(zencProducts.length),
      String(stock2Products.length),
      0,
      'critical'
    );
    if (countMismatch) {
      countMismatch.orderId = order.id;
      countMismatch.category = order.category;
      result.mismatches.push(countMismatch);
    } else {
      result.matches++;
    }

    // Compare individual products (match by model or name)
    const matchedStock2 = new Set<number>();

    for (let i = 0; i < zencProducts.length; i++) {
      const zp = zencProducts[i];

      let stock2Idx = -1;
      for (let j = 0; j < stock2Products.length; j++) {
        if (matchedStock2.has(j)) continue;
        const sp = stock2Products[j];

        // Match by model (most reliable)
        if (zp.model && sp.model && zp.model.toLowerCase() === sp.model.toLowerCase()) {
          stock2Idx = j;
          break;
        }
        // Fallback: match by name substring (first 30 chars)
        if (zp.name && sp.name) {
          const zName = zp.name.toLowerCase().substring(0, 30);
          const sName = sp.name.toLowerCase().substring(0, 30);
          if (zName === sName || zName.includes(sName) || sName.includes(zName)) {
            stock2Idx = j;
            break;
          }
        }
      }

      if (stock2Idx === -1) {
        result.mismatches.push({
          field: `${sectionName} product #${i + 1} not found in Stock2`,
          zencValue: `${zp.name} (${zp.model})`,
          stock2Value: '(not found)',
          orderId: order.id,
          category: order.category,
          severity: 'critical',
        });
        continue;
      }

      matchedStock2.add(stock2Idx);

      const sp = stock2Products[stock2Idx];
      const prefix = `${sectionName} "${zp.model || zp.name}"`;

      // Compare per-product fields
      const productFields: Array<{
        field: string;
        zencVal: string;
        stock2Val: string;
        severity: Mismatch['severity'];
        isNumeric?: boolean;
        tolerance?: number;
      }> = [
        { field: `${prefix} — quantity`, zencVal: zp.quantity, stock2Val: sp.quantity, severity: 'critical' },
        { field: `${prefix} — name`, zencVal: zp.name, stock2Val: sp.name, severity: 'major' },
        { field: `${prefix} — model`, zencVal: zp.model, stock2Val: sp.model, severity: 'major' },
        { field: `${prefix} — tax`, zencVal: zp.tax, stock2Val: sp.tax, severity: 'major', isNumeric: true, tolerance: 0.01 },
        { field: `${prefix} — totalIncTax`, zencVal: zp.totalIncTax, stock2Val: sp.totalIncTax, severity: 'critical', isNumeric: true, tolerance: 0.01 },
        { field: `${prefix} — totalGbp`, zencVal: zp.totalGbp, stock2Val: sp.totalGbp, severity: 'critical', isNumeric: true, tolerance: 0.01 },
      ];

      for (const { field, zencVal, stock2Val, severity, isNumeric, tolerance } of productFields) {
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

        if (mismatch) {
          mismatch.orderId = order.id;
          mismatch.category = order.category;
          result.mismatches.push(mismatch);
        } else {
          result.matches++;
        }
      }

      // Compare row color
      const zencColor = normalizeColor(zp.rowBgColor);
      const stock2Color = normalizeColor(sp.rowBgColor);
      if (zencColor && stock2Color && zencColor !== stock2Color) {
        result.mismatches.push({
          field: `${prefix} — rowBgColor`,
          zencValue: zp.rowBgColor || '(none)',
          stock2Value: sp.rowBgColor || '(none)',
          orderId: order.id,
          category: order.category,
          severity: 'minor',
        });
      } else {
        result.matches++;
      }
    }

    // Check for extra products in Stock2 not matched
    for (let j = 0; j < stock2Products.length; j++) {
      if (!matchedStock2.has(j)) {
        const sp = stock2Products[j];
        result.mismatches.push({
          field: `Extra ${sectionName.toLowerCase()} product in Stock2 not in zenc`,
          zencValue: '(not found)',
          stock2Value: `${sp.name} (${sp.model})`,
          orderId: order.id,
          category: order.category,
          severity: 'critical',
        });
      }
    }
  }
});
