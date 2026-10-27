/**
 * Status management type definitions — raw query result shapes and function params.
 * Requirements: REQ-07-001 through REQ-07-026
 */

// ---------------------------------------------------------------------------
// Raw DB query result types
// ---------------------------------------------------------------------------

/** Current order state fetched before status update */
export interface OrderCurrentState {
  orders_id: number;
  orders_status: number;
  customers_id: number;
  customers_name: string;
  customers_email_address: string;
  order_site: number;
  date_purchased: Date | string | null;
  ship_by_date: Date | string | null;
  fruugo_orders_id: string | null;
  gosport_order_id: string | null;
  catch_order_id: string | null;
  decathlon_order_id: string | null;
  ebay_orders_id: string | null;
  tesco_customer_order_id: string | null;
  fc_order_status: string | null;
  amazon_orders_id: string | null;
}

/** Order product row for inventory operations */
export interface OrderProductRow {
  orders_products_id: number;
  products_id: number;
  products_quantity: number;
  backorder: string;
  ship_chk: string;
  box_number: string | null;
  tracking_no: string | null;
}

/** Order product barcode row — filtered to non-null barcodes in SQL */
export interface OrderProductBarcodeRow {
  orders_products_id: number;
  product_barcode: string;
}

/** Hero shirt product lookup result */
export interface HeroShirtProduct {
  products_id: number;
}

/** Hero shirt parent lookup result */
export interface HeroShirtParent {
  hero_shirt_parent: number;
}

/** Status history row from DB */
export interface StatusHistoryRow {
  orders_status_history_id: number;
  orders_id: number;
  orders_status_id: number;
  orders_status_name: string | null;
  date_added: Date | string;
  customer_notified: number;
  comments: string;
  comment_by: string | null;
  comment_private: string | null;
  status_change_from: string | null;
}

/** Predefined template row */
export interface PredefinedTemplateRow {
  id: number;
  title: string | null;
  content: string;
  template_type: number | null;
}

/** Amazon order ID lookup */
export interface AmazonOrderRow {
  amazon_orders_id: string;
}

/** Fruugo confirmation check result */
export interface FruugoConfirmationRow {
  id: number;
}

/** DHL tracking lookup */
export interface DhlTrackingRow {
  shipment_no: string;
}

/** Order product tracking lookup */
export interface OrderProductTrackingRow {
  tracking_no: string;
}

/** Fraud check result — fraud_status is ENUM('0','1') in MySQL, returned as string */
export interface FraudCheckRow {
  fraud_status: string;
}

/** Pre-ordered check result */
export interface PreOrderCheckRow {
  pre_orderded_orders_id: number;
}

/** Product quantities row for committed quantity */
export interface ProductQuantityRow {
  quantity: number;
  committed_quantity: number;
  barcode: string;
}

// ---------------------------------------------------------------------------
// Function parameter types
// ---------------------------------------------------------------------------

/** Parameters for the main status update handler */
export interface StatusUpdateParams {
  orderId: number;
  newStatus: number;
  previousOrderStatus: number;
  comments: string;
  notify: boolean;
  notifyComments: boolean;
  privateComment: boolean;
  useOriginalEmail: boolean;
  sendMessageAutomatically: boolean;
  pageForLog: string;
  adminName: string;
}

/** Result returned from status update */
export interface StatusUpdateResult {
  success: boolean;
  message: string;
  statusChanged: boolean;
  historyInserted: boolean;
  marketplaceErrors: string[];
}
