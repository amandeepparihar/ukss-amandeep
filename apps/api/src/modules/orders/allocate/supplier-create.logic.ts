/**
 * Pure create-side logic for SPEC-12a. Faithful to legacy
 * ajaxSupplierManage.php set_supplier (L324 overflow, L485 status-128 predicate).
 */
export interface CoverageCounts {
  totalAiroProducts: number;  // legacy $total_order_product — count of AIRO order lines
  allAiroProducts: number;    // COUNT(np.products_id) in the coverage join (L461-474)
  totalSopProducts: number;   // COUNT(sop.order_product_id) — AIRO lines that have an sop row
  smsQuantityUsed: number;    // AIRO lines with box_number set and no sop row (L414-423)
}

/** Legacy L485: order becomes "In Transit" when every AIRO line is covered. */
export function shouldTransitionToInTransit(c: CoverageCounts): boolean {
  return c.totalAiroProducts === c.allAiroProducts
    && c.allAiroProducts === c.totalSopProducts + c.smsQuantityUsed
    && c.totalSopProducts !== 0;
}

/** Legacy L324: a quantity of N creates 1 primary row + (N-1) airo_other_order overflow rows. */
export function overflowRowCount(quantity: number): number {
  return Math.max(0, quantity - 1);
}
