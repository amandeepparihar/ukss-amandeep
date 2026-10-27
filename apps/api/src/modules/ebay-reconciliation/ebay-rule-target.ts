/**
 * SQL boolean expression: "the eBay sync's rule-derived target quantity for this
 * SKU is 0" — i.e. the listing should NOT be advertising stock.
 *
 * MUST mirror the quantity arms in marketplace-sync.query.ts (ebayQuantityArms)
 * and the EBAY_OVERSELL_SQL conditions in reports/marketplace-sync.query.ts.
 * Parity is enforced by ebay-rule-target.test.ts — if that test fails, update
 * this fragment and the test TOGETHER with the sync arms, never independently.
 *
 * Valid inside a query with these aliases:
 *   marketplace_listings ml
 *   LEFT JOIN new_products_variations npv ON npv.npv_products_sku = CONVERT(ml.products_sku USING latin1)
 *   LEFT JOIN new_products np ON np.products_id = ml.products_id
 *
 * LEFT joins (unlike EBAY_OVERSELL_SQL's INNER) so managed rows with no npv
 * match still classify; a missing npv row means we cannot verify stock, which
 * for selling purposes is target-zero.
 *
 * T-shirts (virtual_product_type_id = 4) are print-on-demand and legitimately
 * stay at qty 1 — never target-zero (matches sync arm #3 evaluated first).
 */
export const EBAY_RULE_TARGET_ZERO_SELECT = `
  (
    (np.virtual_product_type_id IS NULL OR np.virtual_product_type_id <> 4)
    AND (
      npv.npv_products_sku IS NULL
      OR npv.npv_delete_status = '1'
      OR npv.npv_always_in_stock = 'Yes'
      OR npv.fc_product_id IS NULL OR npv.fc_product_id = 0
      OR np.np_best_seller_lifetime IS NULL OR np.np_best_seller_lifetime <= 0
      OR npv.npv_quantities <= 0
    )
  )
`;
