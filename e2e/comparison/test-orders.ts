/**
 * Representative test orders for zenc vs Stock2 comparison testing.
 * Generated from staging DB (zenc_main_db) on 2026-02-27.
 *
 * Each order represents a distinct category to ensure comprehensive
 * coverage of all order types and edge cases.
 */

export interface TestOrder {
  id: number;
  category: string;
  description: string;
}

export const TEST_ORDERS: TestOrder[] = [
  { id: 1789678, category: 'standard_pending', description: 'Standard pending order (status=1)' },
  { id: 1791190, category: 'processing', description: 'Processing order (status=2)' },
  { id: 1791104, category: 'delivered', description: 'Delivered order (status=16)' },
  { id: 1768953, category: 'amazon', description: 'Amazon order (has amazon_orders_id)' },
  { id: 1569752, category: 'amazon_prime', description: 'Amazon Prime order (is_prime_order=true)' },
  { id: 1586835, category: 'fruugo', description: 'Fruugo order (has fruugo_orders_id)' },
  { id: 1790554, category: 'exchange', description: 'Exchange order (has id_of_original_order)' },
  { id: 1791090, category: 'rejected', description: 'Rejected order (status=112)' },
  { id: 1791199, category: 'refund_marked', description: 'Refund marked order (refund_status_for_reject_orders=1)' },
  { id: 1791107, category: 'fc_order', description: 'FC order (has fc_order_id)' },
  { id: 1790389, category: 'dhl_shipping', description: 'DHL shipping order (shipping_method LIKE DHL Courier)' },
  { id: 1791169, category: 'multi_product', description: 'Multi-product order (3+ products)' },
  { id: 1790506, category: 'backorder', description: 'Backorder order (has backorder products)' },
  { id: 1791199, category: 'wholesale', description: 'Wholesale order (order_type=Wholesale)' },
  { id: 1781402, category: 'multisite', description: 'Multisite order (order_site IN 99,111)' },
  { id: 1789778, category: 'has_refunded_products', description: 'Order with refunded products (op.refund=1)' },
  { id: 1789516, category: 'sift_scored', description: 'Sift scored order (sift_score > 0)' },
];

/** Subset of orders useful for detailed panel/edit page testing */
export const PANEL_TEST_ORDERS = TEST_ORDERS.filter((o) =>
  ['amazon', 'fruugo', 'exchange', 'refund_marked', 'fc_order', 'multi_product'].includes(o.category)
);

/** Subset of orders useful for products table testing */
export const PRODUCTS_TEST_ORDERS = TEST_ORDERS.filter((o) =>
  ['multi_product', 'backorder', 'has_refunded_products'].includes(o.category)
);

/** Unique order IDs (some categories share the same order) */
export const UNIQUE_ORDER_IDS = Array.from(new Set(TEST_ORDERS.map((o) => o.id)));
