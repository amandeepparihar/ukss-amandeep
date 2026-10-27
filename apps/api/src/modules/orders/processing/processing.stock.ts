/**
 * SPEC-13: SMS stock picking utilities.
 * Requirements: REQ-13-010 (stock picking), REQ-13-006 (product type detection)
 *
 * Core functions for resolving product sizes, looking up product codes,
 * checking/picking SMS stock, detecting product types, and detecting printing options.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { PRINTING_OPTIONS_ID_LIST, FC_BOX_LISTS_ID, SQUAD_PLAYER_OPTION_ID } from '../orders.constants';
import type {
  TxClient,
  SizeResolution,
  ProductCodeResolution,
  StockPickResult,
  SizeAttributeRow,
  ProductListRow,
  ProductQuantityRow,
} from './processing.types';

// detectProductType is a pure classifier; it lives in processing.status.ts (the
// I/O-free module) and is re-exported here so existing importers are unaffected.
export { detectProductType } from './processing.status';

const logger = createLogger('orders-processing-stock');

// ---------------------------------------------------------------------------
// REQ-13-010: Size Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the SMS size ID for an order product.
 * If products_options_id = 1, use the size value ID directly.
 * Otherwise, map through products_options_values_to_products_options (POVTPO)
 * and manufacturers_sizes_to_default_sizes — using manufacturers_options_values_id
 * as the final size ID (PHP line 656).
 */
export async function resolveSmsSize(
  ordersProductsId: number,
  manufacturersId: number | null,
  client: TxClient = prisma
): Promise<SizeResolution | null> {
  // Get size attribute — PHP filters by name containing 'Size'
  const attrs = await client.$queryRaw<SizeAttributeRow[]>(
    Prisma.sql`
      SELECT po.products_options_id,
             opa.products_options_values,
             opa.products_options_values_id
      FROM orders_products_attributes opa
      LEFT JOIN products_options po
        ON po.products_options_name = opa.products_options
        AND po.language_id = 1
      WHERE opa.orders_products_id = ${ordersProductsId}
        AND po.products_options_id IS NOT NULL
        AND opa.products_options LIKE '%Size%'
      LIMIT 1
    `
  );

  if (attrs.length === 0) {
    return null;
  }

  const attr = attrs[0];

  // If products_options_id = 1 (standard size), use value directly
  if (attr.products_options_id === 1) {
    return {
      sizeId: attr.products_options_values_id,
      sizeName: attr.products_options_values,
    };
  }

  // PHP lines 636-661: Map through POVTPO → manufacturers_sizes_to_default_sizes
  // Uses manufacturers_options_values_id as the final size ID
  const mapping = await client.$queryRaw<Array<{ manufacturers_options_values_id: number }>>(
    Prisma.sql`
      SELECT mst.manufacturers_options_values_id
      FROM products_options_values_to_products_options AS povt,
           manufacturers_sizes_to_default_sizes AS mst
      WHERE povt.products_options_values_id = ${attr.products_options_values_id}
        AND povt.products_options_id = ${attr.products_options_id}
        AND povt.products_options_values_to_products_options_id = mst.manufacturers_options_values_id
      LIMIT 1
    `
  );

  if (mapping.length > 0) {
    return {
      sizeId: mapping[0].manufacturers_options_values_id,
      sizeName: attr.products_options_values,
    };
  }

  // Fallback: use original value
  return {
    sizeId: attr.products_options_values_id,
    sizeName: attr.products_options_values,
  };
}

// ---------------------------------------------------------------------------
// REQ-13-010: Product Code Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve product_lists_id from a products_model code.
 * For comma-separated models (e.g. 'ABC123,DEF456'), PHP validates that the first
 * code has stock rows for the target size in product_quantities before choosing it.
 * If the first code has no size entry, falls back to the second code.
 * (PHP: product_code_existance_using_manufacturers_options_values_id, general.php lines 4722-4744)
 */
export async function resolveProductCode(
  productsModel: string,
  sizeId = 0,
  client: TxClient = prisma
): Promise<ProductCodeResolution | null> {
  const codes = productsModel.split(',').map((c) => c.trim()).filter(Boolean);

  if (codes.length <= 1) {
    // Single code — resolve directly
    return resolveSingleProductCode(codes[0] || productsModel, client);
  }

  // Dual/multi code — PHP validates first code has stock for this size
  const firstCode = codes[0];
  const fallbackCode = codes[1];

  const firstResult = await resolveSingleProductCode(firstCode, client);
  if (firstResult && sizeId > 0) {
    // Check if first code has ANY size entry in product_quantities (PHP checks count > 0)
    const sizeCheck = await client.$queryRaw<Array<{ cnt: number }>>(
      Prisma.sql`
        SELECT COUNT(*) AS cnt FROM product_quantities
        WHERE product_lists_id = ${firstResult.productListsId}
          AND size_id = ${sizeId}
      `
    );
    if (Number(sizeCheck[0]?.cnt ?? 0) > 0) {
      return firstResult;
    }
    // First code exists but no stock row for this size — fall back
  } else if (firstResult) {
    return firstResult; // No size to validate against
  }

  // Fall back to second code
  return resolveSingleProductCode(fallbackCode, client);
}

async function resolveSingleProductCode(
  code: string,
  client: TxClient = prisma
): Promise<ProductCodeResolution | null> {
  if (!code) return null;
  const rows = await client.$queryRaw<ProductListRow[]>(
    Prisma.sql`
      SELECT product_lists_id, parent_product_lists_id
      FROM product_lists
      WHERE product_code = ${code}
      LIMIT 1
    `
  );
  if (rows.length > 0) {
    return {
      productListsId: rows[0].product_lists_id,
      parentProductListsId: rows[0].parent_product_lists_id,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// REQ-13-010: Stock Availability Check (READ-ONLY)
// ---------------------------------------------------------------------------

/**
 * Check SMS stock for a product/size combination without modifying anything.
 * Returns the first box with sufficient quantity.
 */
export async function checkSmsStock(
  productListsId: number,
  sizeId: number,
  quantity: number,
  client: TxClient = prisma
): Promise<StockPickResult> {
  const rows = await client.$queryRaw<ProductQuantityRow[]>(
    Prisma.sql`
      SELECT pq.product_quantities_id, pq.product_lists_id, pq.size_id,
             pq.quantity, pq.box_lists_id,
             b.box_code, pq.barcode
      FROM product_quantities pq
      LEFT JOIN box_lists b ON pq.box_lists_id = b.box_lists_id
      WHERE pq.product_lists_id = ${productListsId}
        AND pq.size_id = ${sizeId}
        AND pq.quantity >= ${quantity}
      LIMIT 1
    `
  );

  if (rows.length > 0) {
    return {
      available: true,
      quantity: rows[0].quantity,
      boxCode: rows[0].box_code || '',
      barcode: rows[0].barcode || '',
      productListsId: rows[0].product_lists_id,
      boxListsId: rows[0].box_lists_id,
    };
  }

  // Check total stock across all boxes
  const totalRows = await client.$queryRaw<Array<{ total: number }>>(
    Prisma.sql`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM product_quantities
      WHERE product_lists_id = ${productListsId}
        AND size_id = ${sizeId}
    `
  );

  return {
    available: false,
    quantity: Number(totalRows[0]?.total ?? 0),
    boxCode: '',
    barcode: '',
    productListsId,
    boxListsId: 0,
  };
}

// ---------------------------------------------------------------------------
// REQ-13-010: Stock Picking (WRITE operation)
// ---------------------------------------------------------------------------

/**
 * Deduct stock from product_quantities for a specific box.
 * For FC box: also increment committed_quantity in the same UPDATE.
 */
export async function pickStock(
  productListsId: number,
  sizeId: number,
  quantity: number,
  boxListsId: number,
  tx: TxClient
): Promise<void> {
  if (boxListsId === FC_BOX_LISTS_ID) {
    // PHP line 1029: FC box deducts quantity AND increments committed_quantity
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE product_quantities
        SET quantity = quantity - ${quantity},
            committed_quantity = committed_quantity + ${quantity},
            modified = NOW(),
            last_sale_date = NOW()
        WHERE product_lists_id = ${productListsId}
          AND size_id = ${sizeId}
          AND box_lists_id = ${boxListsId}
      `
    );
  } else {
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE product_quantities
        SET quantity = quantity - ${quantity},
            modified = NOW(),
            last_sale_date = NOW()
        WHERE product_lists_id = ${productListsId}
          AND size_id = ${sizeId}
          AND box_lists_id = ${boxListsId}
      `
    );
  }

  logger.debug(
    { productListsId, sizeId, quantity, boxListsId },
    'Stock picked'
  );
}

// Product Type Detection — see re-export at top of file (relocated to processing.status.ts).

/**
 * Mirrors legacy PHP override in pre_processed_order.php:326-335.
 * If a product is in T-shirt category 2214, it must be queued to PPOP at
 * status=0 even when SMS quantity is zero — the cron sorts it out later.
 *
 * The category column stores tokens like '#4#,#183#,#2214#' (hash-delimited).
 * Match the literal token '#2214#' to avoid false positives such as #22140#.
 */
export async function isTshirtCategory2214(
  productsId: number,
  client: TxClient = prisma,
): Promise<boolean> {
  if (!productsId) return false;
  const rows = await client.$queryRaw<Array<{ products_id: number }>>(
    Prisma.sql`
      SELECT products_id
      FROM new_products
      WHERE products_id = ${productsId}
        AND products_to_categories LIKE '%#2214#%'
      LIMIT 1
    `,
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Printing Options Detection
// ---------------------------------------------------------------------------

/**
 * Detect if an order product has printing/personalization options.
 * Checks orders_products_attributes for printing option IDs (3, 4, 63, 64, 65).
 * Option 3 (Squad Player) only counts if value is not 'None'.
 */
export async function detectPrintingOptions(
  ordersProductsId: number,
  client: TxClient = prisma
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ products_options_id: number; products_options_values: string }>>(
    Prisma.sql`
      SELECT po.products_options_id, opa.products_options_values
      FROM orders_products_attributes opa
      LEFT JOIN products_options po
        ON po.products_options_name = opa.products_options
        AND po.language_id = 1
      WHERE opa.orders_products_id = ${ordersProductsId}
        AND po.products_options_id IN (${Prisma.join(PRINTING_OPTIONS_ID_LIST)})
    `
  );

  for (const row of rows) {
    // Squad Player: only counts if value is not 'None' and not empty
    if (row.products_options_id === SQUAD_PLAYER_OPTION_ID) {
      if (row.products_options_values && row.products_options_values !== 'None' && row.products_options_values !== '') {
        return true;
      }
    } else {
      // Options 4, 63, 64, 65: always count
      return true;
    }
  }

  return false;
}

/**
 * Check stock for a parent product (hero shirt fallback).
 * When the primary product has no stock, try the parent's stock.
 */
export async function checkParentStock(
  parentProductListsId: number,
  sizeId: number,
  quantity: number,
  manufacturersId: number | null,
  client: TxClient = prisma
): Promise<StockPickResult | null> {
  if (!parentProductListsId || parentProductListsId === 0) {
    return null;
  }

  // For hero shirts, we may need to remap the size through the parent's manufacturer
  const result = await checkSmsStock(parentProductListsId, sizeId, quantity, client);
  if (result.available) {
    return result;
  }

  return null;
}
