/**
 * Type definitions for order details panel queries and responses.
 * Requirements: REQ-03-001 through REQ-03-025
 */

// ---------------------------------------------------------------------------
// Raw query result types (database row shapes)
// ---------------------------------------------------------------------------

/** Panel order query - core fields needed for the panel */
export interface PanelOrderRow {
  orders_id: number;
  customers_id: number;
  orders_status: number;
  orders_status_name: string | null;
  date_purchased: Date | string | null;
  last_modified: Date | string | null;
  order_total: number | null;
  currency: string | null;
  payment_method: string | null;
  shipping_method: string | null;
  customers_name: string | null;
  customers_email_address: string | null;
  ip_address: string | null;
  is_prime_order: string | null;
  sift_score: number | null;
  fc_order_status: string | null;
  refund_status_for_reject_orders: number | null;
  refund_review_status: number | null;
  refund_review_comment: string | null;
  multisite_order_id: string | null;
  order_site: number | null;
  suppliers: string | null;
  // Marketplace IDs for status dropdown wiring
  ebay_order_id: string | null;
  gosport_order_id: string | null;
  catch_order_id: string | null;
  fruugo_order_id: string | null;
  amazon_order_id: string | null;
  mplaza_order_id: string | null;
  tesco_order_id: string | null;
  rakuten_order_id: string | null;
  lazada_order_id: string | null;
  priceminister_order_id: string | null;
  decathlon_order_id: string | null;
}

/** For ebay unacknowledged status check */
export interface EbayAckRow {
  unacknowledged: number | null;
}

/** Product rows for the panel */
export interface PanelProductRow {
  orders_products_id: number;
  products_id: number;
  products_name: string | null;
  products_model: string | null;
  products_quantity: number;
  backorder: string | null;
  box_number: string | null;
  refund: number | null;
  fc_order_id: string | null;
  p_manufacturers_id: number | null;
}

/** Product attribute rows */
export interface PanelProductAttributeRow {
  orders_products_id: number;
  products_options: string | null;
  products_options_values: string | null;
  products_options_id: number | null;
  products_options_values_id: number | null;
}

/** SMS quantity lookup */
export interface PanelSmsQuantityRow {
  product_code: string;
  product_lists_id: number;
  parent_product_lists_id: number | null;
  quantity_map: number | null;
  size_id: number | null;
  total_qty: number | null;
}

/** Supplier assignment data (N+1 prevention - REQ-03-025) */
export interface PanelSupplierRow {
  orders_products_id: number;
  supplier_order_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  order_number: string | null;
  close_order: number | null;
  manufacturers_id: number | null;
}

/** Bulk upload supplier */
export interface PanelBulkSupplierRow {
  products_id: number;
  bus_name: string | null;
}

/** Last ordered supplier */
export interface PanelLastOrderedRow {
  orders_products_id: number; // used to map back to the product
  products_id: number;
  supplier_name: string | null;
  ordered_date: Date | string | null;
}

/** Customer fraud status (REQ-03-007) */
export interface PanelCustomerFraudRow {
  fraud_status: number | null;
}

/** All suppliers for dropdown */
export interface SupplierListRow {
  suppliers_id: number;
  suppliers_name: string | null;
}

/** Toffs/Copa detection */
export interface ToffsCopaCategoryRow {
  orders_products_id: number;
  categories_name: string | null;
}

// ---------------------------------------------------------------------------
// Public response types
// ---------------------------------------------------------------------------

export interface PanelProductAttribute {
  optionName: string;
  optionValue: string;
  optionValueId: number | null;
  isSize: boolean;
}

export interface PanelProductSupplier {
  supplierOrderId: number | null;
  supplierId: number | null;
  supplierName: string | null;
  orderNumber: string | null;
  isAssigned: boolean;
  closeOrder: number | null;
}

export interface PanelProductLastOrdered {
  supplierName: string;
  orderedDate: string | null;
}

export interface PanelProduct {
  ordersProductsId: number;
  productsId: number;
  name: string;
  model: string | null;
  quantity: number;
  backorder: string;
  boxNumber: string | null;
  fcOrderId: string | null;
  isRefund: boolean;
  attributes: PanelProductAttribute[];
  smsQuantity: number | string; // number, 'OFS', or 'N/A'
  supplier: PanelProductSupplier | null;
  lastOrdered: PanelProductLastOrdered | null;
  bulkUploadSupplier: string | null;
  toffsCopaType: 'toffs' | 'copa' | null;
  manufacturersId: number | null;
  isSupplierSelectable: boolean;
  /** Which of the two independent coverage-check groups this line belongs to
   * (legacy's select_retailer() forbids mixing them in one "Buy From Retailer"
   * submission, since a batch assigns ONE supplier to every checked line). */
  supplierType: 'airo' | 'toffs' | null;
}

export interface PanelMarketplaceInfo {
  ebayOrderId: string | null;
  ebayUnacknowledged: number | null;
  gosportOrderId: string | null;
  catchOrderId: string | null;
  fruugoOrderId: string | null;
  multisiteOrderId: string | null;
  amazonOrderId: string | null;
  mplazaOrderId: string | null;
  tescoOrderId: string | null;
  rakutenOrderId: string | null;
  lazadaOrderId: string | null;
  priceministerOrderId: string | null;
  decathlonOrderId: string | null;
}

export interface OrderPanelData {
  orderId: number;
  customersId: number;
  status: number;
  statusName: string;
  datePurchased: string | null;
  lastModified: string | null;
  orderTotal: number | null;
  currency: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  customerName: string | null;
  customerEmail: string | null;
  ipAddress: string | null;
  isPrime: boolean;
  siftScoreBit: boolean; // true if sift_score > 0
  fcOrderStatus: string | null;
  fraudStatus: number; // 0 = clear, from customers.fraud_status
  refundStatusForReject: number; // 0, 1, or 2
  refundReviewStatus: number; // 0, 1, or 2
  refundReviewComment: string | null;
  orderSite: number | null;
  suppliers: string | null; // semicolon-delimited supplier IDs
  marketplace: PanelMarketplaceInfo;
  products: PanelProduct[];
  productCount: number;
  allSuppliers: Array<{ id: number; name: string }>;
}
