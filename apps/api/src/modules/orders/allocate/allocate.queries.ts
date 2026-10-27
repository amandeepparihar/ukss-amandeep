/**
 * Shared DB queries for the SPEC-12a supplier-order creation flow.
 *
 * These functions are consumed by both the "get supplier options" endpoint
 * (T5) and the "create supplier order" endpoint (T4).  All metadata is
 * derived server-side (REQ-12a-001) — nothing is trusted from the client.
 *
 * Column verification (2026-06-24): every column referenced below was
 * confirmed present via INFORMATION_SCHEMA.COLUMNS on zenc_main_db.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import type { TxClient } from '../processing/processing.types';
import type { SupplierLineMetadata, SupplierOption } from './allocate.types';
import type { CoverageCounts } from './supplier-create.logic';
import { AIRO_TYPE_MANUFACTURER_ID_LIST } from '../orders.constants';
import { mapSupplierRow } from './allocate.maps';

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

// ---------------------------------------------------------------------------
// getManufacturerFilteredSuppliers
// ---------------------------------------------------------------------------

/**
 * Return all suppliers whose comma-separated `manufacturer_id` field
 * contains ANY of the given manufacturer IDs.
 *
 * Legacy source: general.php:5774 `get_all_suppliers()` fetches all rows;
 * ajaxSupplierManage.php:797-808 then filters in PHP with `in_array()` on
 * the exploded `manufacturer_id` string.  We replicate the same logic in SQL
 * using FIND_IN_SET so the VARCHAR comma-separated column is handled correctly
 * (a plain SQL `IN` would not match partial comma-separated values).
 *
 * Verified columns: suppliers.suppliers_id, suppliers.suppliers_name,
 * suppliers.manufacturer_id (VARCHAR 100, comma-separated).
 */
export async function getManufacturerFilteredSuppliers(
  manufacturerIds: number[],
  client: TxClient = prisma,
): Promise<SupplierOption[]> {
  if (manufacturerIds.length === 0) return [];

  // Build one FIND_IN_SET clause per manufacturer id and OR them together.
  // Prisma.sql`` tag ensures safe parameterisation; FIND_IN_SET handles the
  // comma-separated VARCHAR that the legacy system stores in manufacturer_id.
  const findInSetClauses = manufacturerIds
    .map(id => Prisma.sql`FIND_IN_SET(${String(id)}, manufacturer_id) > 0`)
    .reduce((acc, clause) => Prisma.sql`${acc} OR ${clause}`);

  const rows = await client.$queryRaw<
    Array<{ suppliers_id: bigint; suppliers_name: string; manufacturer_id: string | null }>
  >(Prisma.sql`
    SELECT suppliers_id, suppliers_name, manufacturer_id
    FROM suppliers
    WHERE ${findInSetClauses}
    ORDER BY suppliers_name
  `);

  // mapSupplierRow handles BigInt → number and null coercion.
  // manufacturer_id here is VARCHAR — coerce to null to satisfy the type;
  // the caller only needs id+name, manufacturerId is informational.
  return rows.map(r => mapSupplierRow({ ...r, manufacturer_id: null }));
}

// ---------------------------------------------------------------------------
// isAiroSize
// ---------------------------------------------------------------------------

/**
 * Return true when the given products_options_values_id maps to the Airo
 * size option (products_options_id = 182) in
 * products_options_values_to_products_options.
 *
 * Legacy source: ajaxSupplierManage.php:919-928 — fetches
 * products_options_values_to_products_options_id by (products_options_values_id)
 * then uses it for the shortname chain; presence of a row with options_id=182
 * is the AIRO-size guard (L1012-1013 error when no default_options_values_id
 * is found for AIRO manufacturers).
 *
 * Verified columns: products_options_values_to_products_options.products_options_values_id,
 *   products_options_values_to_products_options.products_options_id,
 *   products_options_values_to_products_options.products_options_values_to_products_options_id
 */
export async function isAiroSize(
  productsOptionsValuesId: number,
  client: TxClient = prisma,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
    SELECT products_options_values_to_products_options_id AS id
    FROM products_options_values_to_products_options
    WHERE products_options_values_id = ${productsOptionsValuesId}
      AND products_options_id = 182
    LIMIT 1
  `);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// getCoverageCounts
// ---------------------------------------------------------------------------

/**
 * Compute the four coverage counters used by shouldTransitionToInTransit().
 *
 * Generalised over `manufacturerIds` so the same query shape backs BOTH of
 * legacy's independent coverage checks in ajaxSupplierManage.php's set_supplier:
 *   - AIRO block (L388-519, manufacturers 79/82/85/86/87) → orders_status = 128 (IN_TRANSIT)
 *   - Toffs block (L521-637, manufacturers 35/107)        → orders_status = 22  (RETRO_SHIRTS)
 * Both blocks run unconditionally, one after the other, on every set_supplier
 * call — they are NOT mutually exclusive branches of one if/else.
 *
 * Legacy sources:
 *   totalAiroProducts — ajaxSupplierManage.php L838-846 ($total_order_product):
 *     UNRESTRICTED count of ALL order lines for the order — NO manufacturer filter.
 *     Legacy: `SELECT count(orders_products_id) FROM orders_products WHERE orders_id = :orders_id`
 *     Same value both times since it's unfiltered — but getCoverageCounts is called
 *     once per manufacturer list, so this query runs twice per createSupplierOrder call.
 *     On a mixed order the total (e.g. 4) intentionally exceeds allAiroProducts
 *     (e.g. 2), preventing a premature transition.
 *   allAiroProducts + totalSopProducts — L461-474 (AIRO) / L569-582 (Toffs) — LEFT JOIN coverage check
 *   smsQuantityUsed — L414-423 (AIRO) / L533-542 (Toffs) — lines with box_number set but no sop row
 *
 * Verified columns: orders_products.orders_id, orders_products.orders_products_id,
 *   orders_products.box_number, new_products.products_id, new_products.manufacturers_id,
 *   suppliers_orders_products.order_product_id, suppliers_orders_products.supplier_order_id,
 *   suppliers_orders_products.reorder_supplier_order_product_id,
 *   suppliers_orders.supplier_order_id, suppliers_orders.close_order
 */
export async function getCoverageCounts(
  orderId: number,
  manufacturerIds: number[],
  client: TxClient = prisma,
): Promise<CoverageCounts> {
  const idsJoin = Prisma.join(manufacturerIds);

  const [totalRows, coverRows, smsRows] = await Promise.all([
    // 1) Unrestricted total order-line count (ALL products, NO manufacturer filter).
    //    Legacy: ajaxSupplierManage.php L838-846 $total_order_product.
    //    Intentionally unrestricted — allAiroProducts / totalSopProducts below are
    //    filtered by manufacturerIds, so on a mixed order total > allAiro → no premature transition.
    client.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`
      SELECT COUNT(orders_products_id) AS c
      FROM orders_products
      WHERE orders_id = ${orderId}
    `),

    // 2) Coverage join — how many of the given manufacturers' lines have an open sop row
    client.$queryRaw<Array<{ all_airo: bigint; sop_total: bigint }>>(Prisma.sql`
      SELECT
        COUNT(np.products_id) AS all_airo,
        COUNT(sop.order_product_id) AS sop_total
      FROM orders_products op
        LEFT JOIN new_products np
          ON op.products_id = np.products_id
        LEFT JOIN suppliers_orders_products sop
          ON op.orders_products_id = sop.order_product_id
        LEFT JOIN suppliers_orders so
          ON so.supplier_order_id = sop.supplier_order_id
      WHERE op.orders_id = ${orderId}
        AND (sop.reorder_supplier_order_product_id = 0
             OR sop.reorder_supplier_order_product_id IS NULL)
        AND np.manufacturers_id IN (${idsJoin})
        AND (so.close_order = '0' OR so.close_order IS NULL)
    `),

    // 3) Lines already fulfilled via SMS (box_number set, no sop row)
    client.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`
      SELECT COUNT(op.orders_products_id) AS c
      FROM orders_products op
        LEFT JOIN suppliers_orders_products sop
          ON sop.order_product_id = op.orders_products_id
        LEFT JOIN new_products np
          ON op.products_id = np.products_id
      WHERE op.orders_id = ${orderId}
        AND op.box_number != ''
        AND sop.supplier_order_product_id IS NULL
        AND np.manufacturers_id IN (${idsJoin})
    `),
  ]);

  return {
    totalAiroProducts: n(totalRows[0]?.c),
    allAiroProducts:   n(coverRows[0]?.all_airo),
    totalSopProducts:  n(coverRows[0]?.sop_total),
    smsQuantityUsed:   n(smsRows[0]?.c),
  };
}

// ---------------------------------------------------------------------------
// getAdminName
// ---------------------------------------------------------------------------

/**
 * Resolve an admin ID to a display name (used for logging / UI labels).
 * Falls back to 'Unknown' when the admin row does not exist.
 *
 * Verified columns: admin.admin_id, admin.admin_name
 */
export async function getAdminName(
  adminId: number,
  client: TxClient = prisma,
): Promise<string> {
  const rows = await client.$queryRaw<Array<{ admin_name: string | null }>>(
    Prisma.sql`SELECT admin_name FROM admin WHERE admin_id = ${adminId} LIMIT 1`,
  );
  return rows[0]?.admin_name ?? 'Unknown';
}

// ---------------------------------------------------------------------------
// deriveLineMetadata
// ---------------------------------------------------------------------------

/** Raw shape returned by the combined metadata query. */
interface LineMetaRaw {
  orders_products_id: number;
  orders_id: number;
  original_products_id: number;
  products_model: string | null;
  products_name: string | null;
  manufacturers_id: number | null;
  products_options_values_id: number | null;  // from orders_products_attributes (options_id=182)
  customers_id: number;
  customers_name: string | null;
  date_purchased: Date | string;
  // hero parent check
  hero_shirt_parent: number | null;
  // size name
  products_options_values_name: string | null;
  // shortname chain
  pov2po_id: number | null;
  default_options_values_id: number | null;
  shortname: string | null;
}

/**
 * Derive all server-side metadata needed to write an sop row for an order line.
 *
 * This is the TypeScript equivalent of the selectSupplier field-derivation block
 * in ajaxSupplierManage.php L862-1072.  All values are sourced from the DB; the
 * caller must not override any of these fields from client input (REQ-12a-001).
 *
 * Column sources (all verified 2026-06-24):
 *   products_id, products_model, products_name — orders_products
 *   manufacturers_id — new_products (joined on products_id)
 *   products_options_values_id — orders_products_attributes
 *     (products_options_id = 182 = AIRO size option)
 *   customers_id, customers_name, date_purchased — orders
 *   hero_shirt_parent — new_products (ajaxSupplierManage.php:871-894 / general.php:7301)
 *   products_options_values_name — products_options_values
 *   pov2po_id — products_options_values_to_products_options (options_id=182)
 *   default_options_values_id, shortname — manufacturers_sizes_to_default_sizes
 *     JOIN size_group_items (ajaxSupplierManage.php:930-947)
 *   pvt_id — products_to_product_variation_types
 *     (ptpvt_products_id = hero-remapped product id, ptpvt_status=1)
 *     (ajaxSupplierManage.php:1026-1035)
 *   hero parent remap — new_products.hero_shirt_parent > 0 AND exists in products
 *     (ajaxSupplierManage.php:871-894 + L877)
 *
 * Returns null when the order line does not exist for the given orderId.
 */
export async function deriveLineMetadata(
  orderId: number,
  orderProductId: number,
  client: TxClient = prisma,
): Promise<SupplierLineMetadata | null> {
  // Single query: join orders_products → orders → new_products → opa(size) →
  // products_options_values → pov2po → msd → sgi.
  // We do NOT join products_to_product_variation_types here because pvt_id is
  // looked up on the hero-remapped product_id, which we only know after
  // resolving hero_shirt_parent.  A second targeted query handles that below.
  const rows = await client.$queryRaw<LineMetaRaw[]>(Prisma.sql`
    SELECT
      op.orders_products_id,
      op.orders_id,
      op.products_id                            AS original_products_id,
      op.products_model,
      op.products_name,
      np.manufacturers_id,
      opa.products_options_values_id,
      o.customers_id,
      o.customers_name,
      o.date_purchased,
      np.hero_shirt_parent,
      pov.products_options_values_name,
      pov2po.products_options_values_to_products_options_id AS pov2po_id,
      msd.default_options_values_id,
      sgi.shortname
    FROM orders_products op
      JOIN orders o
        ON o.orders_id = op.orders_id
      JOIN new_products np
        ON np.products_id = op.products_id
      LEFT JOIN orders_products_attributes opa
        ON opa.orders_products_id = op.orders_products_id
        AND opa.products_options_id = 182
      LEFT JOIN products_options_values pov
        ON pov.products_options_values_id = opa.products_options_values_id
      LEFT JOIN products_options_values_to_products_options pov2po
        ON pov2po.products_options_values_id = opa.products_options_values_id
        AND pov2po.products_options_id = 182
      LEFT JOIN manufacturers_sizes_to_default_sizes msd
        ON msd.manufacturers_options_values_id = pov2po.products_options_values_to_products_options_id
      LEFT JOIN size_group_items sgi
        ON sgi.option_id = msd.default_options_values_id
    WHERE op.orders_products_id = ${orderProductId}
      AND op.orders_id = ${orderId}
    LIMIT 1
  `);

  if (rows.length === 0) return null;

  const row = rows[0];
  const originalProductId = row.original_products_id;

  // Hero-shirt parent remap (ajaxSupplierManage.php:871-894 + L877):
  // If hero_shirt_parent > 0 AND the parent exists in the products table, use
  // the parent's id/name/model for sop writes; otherwise keep the ordered product.
  let productId = originalProductId;
  let productName = row.products_name ?? '';
  let productModel = row.products_model ?? '';

  const heroParent = n(row.hero_shirt_parent);
  if (heroParent > 0) {
    const parentExistsRows = await client.$queryRaw<Array<{ products_id: number }>>(
      Prisma.sql`SELECT products_id FROM products WHERE products_id = ${heroParent} LIMIT 1`,
    );
    if (parentExistsRows.length > 0) {
      // Remap to parent; fetch parent name/model from new_products
      const parentRows = await client.$queryRaw<
        Array<{ products_name: string | null; products_model: string | null }>
      >(Prisma.sql`
        SELECT products_name, products_model
        FROM new_products
        WHERE products_id = ${heroParent}
        LIMIT 1
      `);
      productId = heroParent;
      if (parentRows[0]) {
        productName = parentRows[0].products_name ?? productName;
        productModel = parentRows[0].products_model ?? productModel;
      }
    }
  }

  // pvt_id: look up on the (possibly remapped) productId for AIRO products.
  // Legacy: ajaxSupplierManage.php:1026-1035 — only for AIRO manufacturers
  // when default_options_values_id != ''. For non-AIRO or unmapped sizes the
  // pvt_id stays empty string (L985, L944-947).
  let pvtId = '';
  const mfId = n(row.manufacturers_id);
  const defaultOptValId = n(row.default_options_values_id);

  if (AIRO_TYPE_MANUFACTURER_ID_LIST.includes(mfId) && defaultOptValId !== 0) {
    const pvtRows = await client.$queryRaw<Array<{ pvt_id: string | number | null }>>(
      Prisma.sql`
        SELECT pvt_id
        FROM products_to_product_variation_types
        WHERE ptpvt_products_id = ${productId}
          AND ptpvt_status = 1
        LIMIT 1
      `,
    );
    pvtId = pvtRows[0]?.pvt_id != null ? String(pvtRows[0].pvt_id) : '';
  }

  const orderDateRaw = row.date_purchased;
  const orderDate =
    orderDateRaw instanceof Date
      ? orderDateRaw.toISOString()
      : String(orderDateRaw);

  return {
    orderProductId,
    productId,
    masterProductId: originalProductId,
    productName,
    productModel,
    sizeName: row.products_options_values_name ?? '',
    shortname: row.shortname ?? '',
    orderId,
    orderDate,
    customerId: n(row.customers_id),
    customerName: row.customers_name ?? '',
    manufacturersId: mfId,
    productsOptionsValuesId: n(row.products_options_values_id),
    pvtId,
    defaultOptionValueId: defaultOptValId,
  };
}
