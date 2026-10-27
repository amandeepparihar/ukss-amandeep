/**
 * Type definitions for product-level action queries.
 * Requirements: REQ-06-001 through REQ-06-026
 */

// ---------------------------------------------------------------------------
// Shared result type for all product actions
// ---------------------------------------------------------------------------

/** Unified result type for all product-level actions. */
export interface ProductActionResult {
  status: 'success' | 'refresh' | 'error';
  message: string;
}

// ---------------------------------------------------------------------------
// Raw query result types
// ---------------------------------------------------------------------------

/** Backorder + box_number from orders_products (REQ-06-002, REQ-06-006) */
export interface ProductStatusRow {
  backorder: string | null;
  box_number: string | null;
}

/** FC multipart batch check (REQ-06-004) */
export interface MultipartBatchCheckRow {
  orders_products_id: number;
  multipart_batch_id: string | null;
}

/** FC order check (REQ-06-005, REQ-06-009, REQ-06-015) */
export interface FcOrderCheckRow {
  fc_order_id: string | null;
}

/** JIT box/multipart data (REQ-06-010, REQ-06-011) */
export interface JitBoxDataRow {
  box_number: string | null;
  multipart_batch_id: string | null;
}

/** Box pick check for backorder (REQ-06-016) */
export interface BoxPickCheckRow {
  orders_products_id: number;
  box_number: string | null;
}

/** Mystery product category check (REQ-06-017) */
export interface MysteryCheckRow {
  master_categories_id: number | null;
  products_to_categories: string | null;
}

/** Admin name lookup (REQ-06-018) */
export interface AdminNameRow {
  admin_name: string | null;
}

/** Product final price and fruugo_id for backorder logging (REQ-06-018) */
export interface ProductPriceRow {
  final_price: number | null;
  fruugo_id: string | null;
}

/** Order site lookup (REQ-06-019, REQ-06-020) */
export interface OrderSiteRow {
  order_site: number | null;
}

/** Order ID from orders_products (REQ-06-025, REQ-06-026) */
export interface OrderIdFromProductRow {
  orders_id: number;
}
