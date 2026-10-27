/**
 * Pure helpers for the supplier free-quantity reader (6a T3).
 *
 * Extracted from the aggregation logic of legacy
 * webadmin/common_orders_operations.php airo_placed_and_open_order()
 * (lines 37-248) so the arithmetic is unit-testable without a database.
 *
 * Legacy math, per open/placed bucket:
 *   total_quantity      = COUNT(sop.product_id)                       (all matching rows)
 *   free_quantity (raw) = COUNT(product_id) - COUNT(order_id)         (rows with order_id NULL = unassigned)
 *   restricted          = rows whose comment_for_size is non-empty    (PM 131725 — manual-order lock)
 *   total_free_quantity = free_quantity - restricted                 (what an admin may actually re-use)
 *   assigned            = total_quantity - free_quantity (raw)        (already on a customer order)
 */

/** Raw aggregate as returned by the open- or placed-order COUNT query. */
export interface FreeQuantityAggregate {
  /** COUNT(sop.product_id) — every matching supplier-order-product row. */
  totalQuantity: number;
  /** COUNT(product_id) - COUNT(order_id) — rows with a NULL order_id (unassigned). */
  freeRawQuantity: number;
  /** Rows with a non-empty comment_for_size (locked for manual order, PM 131725). */
  restrictedQuantity: number;
  /** GROUP_CONCAT(sop.order_id) — customer order ids these rows are assigned to. */
  orderIdsConcat: string | null;
  /** Placed-order bucket only: GROUP_CONCAT(DISTINCT so.order_number). */
  supplierOrderNumber?: string | null;
}

/** Computed summary for one bucket (open or placed). */
export interface FreeQuantitySummary {
  totalQuantity: number;
  /** Quantity already assigned to customer orders (total - free). */
  assignedQuantity: number;
  /** Re-usable free quantity after removing manual-order-locked rows. */
  freeQuantity: number;
  /** Count locked by a size comment (cannot be auto-assigned). */
  restrictedQuantity: number;
  /** Customer order ids the assigned rows belong to (raw, may repeat — matches legacy display). */
  orderIds: number[];
  /** Placed-order bucket only: the supplier order number(s). */
  supplierOrderNumber: string | null;
}

/**
 * Parse a GROUP_CONCAT order-id string into numbers. NULLs are dropped by
 * GROUP_CONCAT upstream, so an empty/absent string means "no assigned orders".
 * Duplicates are preserved to mirror the legacy "Order ids:" display.
 */
export function parseOrderIds(concat: string | null | undefined): number[] {
  if (!concat) return [];
  return concat
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Apply the legacy free-quantity arithmetic to a raw aggregate.
 * Returns null when nothing matched (total_quantity == 0) — legacy only emits a
 * bucket result `if ($total_quantity)`.
 */
export function summariseFreeQuantity(agg: FreeQuantityAggregate): FreeQuantitySummary | null {
  if (agg.totalQuantity <= 0) return null;
  return {
    totalQuantity: agg.totalQuantity,
    assignedQuantity: agg.totalQuantity - agg.freeRawQuantity,
    freeQuantity: agg.freeRawQuantity - agg.restrictedQuantity,
    restrictedQuantity: agg.restrictedQuantity,
    orderIds: parseOrderIds(agg.orderIdsConcat),
    supplierOrderNumber: agg.supplierOrderNumber ?? null,
  };
}
