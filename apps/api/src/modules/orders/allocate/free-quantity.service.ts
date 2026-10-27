/**
 * Supplier free-quantity reader (6a Suppliers slice, ticket T3).
 *
 * Faithful port of legacy webadmin/common_orders_operations.php
 * airo_placed_and_open_order() (lines 37-248). For an ordered product it reports
 * how much of that product is already sitting on supplier orders — split into
 * "open" (not yet placed, supplier_order_id = 0) and "placed" (on an un-closed
 * supplier order) buckets — so an admin can see free quantity before allocating
 * and avoid double-ordering.
 *
 * READ-ONLY. This is a prerequisite for the allocate action (T1) and the
 * Select-Supplier popup (T5); it performs no writes and creates no rows.
 *
 * Fidelity notes:
 *   - Hero shirts are remapped to their parent product so core + hero stock is
 *     treated as one pool (legacy is_hero_shirt parent_product_id, general.php:7301).
 *   - Size path is dual: when pvt_id is empty the product is a non-airo variation
 *     and we match on default_option_value_id; otherwise on products_options_values_id
 *     (legacy $size_condition, lines 72-77).
 *   - comment_for_size rows are counted as "restricted" and subtracted from free
 *     quantity (PM 131725 — a size comment locks a row from auto-allocation).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  summariseFreeQuantity,
  type FreeQuantityAggregate,
  type FreeQuantitySummary,
} from './free-quantity.logic';

export interface SupplierFreeQuantityParams {
  /** Ordered product id (orders_products.products_id). */
  productId: number;
  /** products_options_values_id of the ordered size (airo variation path). */
  optionValueId: number;
  /** Empty string ⇒ non-airo variation (use defaultOptionValueId); otherwise airo. */
  pvtId: string;
  /** default_option_value_id of the ordered size (non-airo variation path). */
  defaultOptionValueId: number;
}

export interface SupplierFreeQuantity {
  /** Product id actually queried (hero-shirt children resolve to their parent). */
  productId: number;
  /** Open (un-placed) supplier-order pool, or null when none match. */
  openOrder: FreeQuantitySummary | null;
  /** Placed (on an un-closed supplier order) pool, or null when none match. */
  placedOrder: FreeQuantitySummary | null;
  /** Supplier order number whose free quantity the "Use placed order" button reuses. */
  reusableSupplierOrderNumber: string | null;
}

/** Raw aggregate row shape; COUNT() comes back as BigInt under the MySQL client. */
interface RawAggregateRow {
  total_quantity: bigint | number;
  free_quantity: bigint | number;
  restricted_order: bigint | number;
  orders_id: string | null;
  supplier_order_number?: string | null;
}

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/**
 * Resolve a hero-shirt child to its parent product so stock is pooled together.
 * Returns the input id unchanged for non-hero products.
 * Legacy: is_hero_shirt() parent_product_id branch (general.php:7301-7338).
 */
async function resolveStockProductId(productId: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ hero_shirt_parent: number | null }>>(Prisma.sql`
    SELECT hero_shirt_parent
    FROM new_products
    WHERE products_id = ${productId} AND hero_shirt_parent > 0
    LIMIT 1
  `);
  const parent = num(rows[0]?.hero_shirt_parent);
  return parent > 0 ? parent : productId;
}

/**
 * Build the size-filter SQL fragment for the chosen variation path.
 * Mirrors legacy $size_condition (lines 72-77).
 */
function sizeCondition(params: SupplierFreeQuantityParams): Prisma.Sql {
  return params.pvtId === ''
    ? Prisma.sql`AND sop.default_option_value_id = ${params.defaultOptionValueId}`
    : Prisma.sql`AND sop.products_options_values_id = ${params.optionValueId}`;
}

const aggregateToSummary = (row: RawAggregateRow | undefined): FreeQuantitySummary | null => {
  if (!row) return null;
  const agg: FreeQuantityAggregate = {
    totalQuantity: num(row.total_quantity),
    freeRawQuantity: num(row.free_quantity),
    restrictedQuantity: num(row.restricted_order),
    orderIdsConcat: row.orders_id,
    supplierOrderNumber: row.supplier_order_number ?? null,
  };
  return summariseFreeQuantity(agg);
};

/**
 * Open-order pool: rows not yet on a supplier order (supplier_order_id = 0).
 * Legacy lines 79-120.
 */
async function getOpenOrderSummary(
  productId: number,
  size: Prisma.Sql,
): Promise<FreeQuantitySummary | null> {
  const rows = await prisma.$queryRaw<RawAggregateRow[]>(Prisma.sql`
    SELECT
      COUNT(sop.product_id) AS total_quantity,
      GROUP_CONCAT(sop.order_id) AS orders_id,
      (COUNT(sop.product_id) - COUNT(sop.order_id)) AS free_quantity,
      COUNT(CASE WHEN sop.comment_for_size IS NOT NULL AND sop.comment_for_size != '' THEN 1 END) AS restricted_order
    FROM suppliers_orders_products sop
    WHERE sop.product_id = ${productId}
      AND sop.supplier_order_id = 0
      ${size}
  `);
  return aggregateToSummary(rows[0]);
}

/**
 * The supplier order number whose open free quantity the "Use placed order"
 * button reuses — the most recent un-closed airo re-order for this size.
 * Legacy lines 140-160.
 */
async function getReusableSupplierOrderNumber(
  productId: number,
  size: Prisma.Sql,
): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ order_number: string | null }>>(Prisma.sql`
    SELECT so.order_number
    FROM suppliers_orders_products sop
    JOIN suppliers_orders so ON sop.supplier_order_id = so.supplier_order_id
    WHERE sop.product_id = ${productId}
      AND sop.supplier_order_id != 0
      AND sop.airo_other_order = 1
      AND sop.reorder_supplier_order_product_id = 0
      AND so.close_order = '0'
      ${size}
    ORDER BY sop.supplier_order_product_id DESC
    LIMIT 1
  `);
  return rows[0]?.order_number ?? '';
}

/**
 * Placed-order pool: rows on the reusable supplier order (un-closed, not a re-order).
 * Legacy lines 194-242.
 */
async function getPlacedOrderSummary(
  productId: number,
  size: Prisma.Sql,
  supplierOrderNumber: string,
): Promise<FreeQuantitySummary | null> {
  const rows = await prisma.$queryRaw<RawAggregateRow[]>(Prisma.sql`
    SELECT
      COUNT(sop.product_id) AS total_quantity,
      GROUP_CONCAT(sop.order_id) AS orders_id,
      (COUNT(sop.product_id) - COUNT(sop.order_id)) AS free_quantity,
      COUNT(CASE WHEN sop.comment_for_size IS NOT NULL AND sop.comment_for_size != '' THEN 1 END) AS restricted_order,
      GROUP_CONCAT(DISTINCT so.order_number) AS supplier_order_number
    FROM suppliers_orders_products sop
    JOIN suppliers_orders so ON sop.supplier_order_id = so.supplier_order_id
    WHERE sop.product_id = ${productId}
      AND so.order_number = ${supplierOrderNumber}
      AND sop.reorder_supplier_order_product_id = 0
      AND so.close_order = '0'
      ${size}
  `);
  return aggregateToSummary(rows[0]);
}

/**
 * Fetch open + placed supplier-order free quantity for an ordered product/size.
 * Orchestrates the legacy airo_placed_and_open_order() flow end to end.
 */
export async function getSupplierFreeQuantity(
  params: SupplierFreeQuantityParams,
): Promise<SupplierFreeQuantity> {
  const productId = await resolveStockProductId(params.productId);
  const size = sizeCondition({ ...params, productId });

  const openOrder = await getOpenOrderSummary(productId, size);
  const reusableSupplierOrderNumber = await getReusableSupplierOrderNumber(productId, size);
  const placedOrder = await getPlacedOrderSummary(productId, size, reusableSupplierOrderNumber);

  return {
    productId,
    openOrder,
    placedOrder,
    reusableSupplierOrderNumber: reusableSupplierOrderNumber || null,
  };
}
