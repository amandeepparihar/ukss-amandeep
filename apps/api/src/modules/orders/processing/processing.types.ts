/**
 * SPEC-13: Order Processing Engine — Type definitions.
 * Requirements: REQ-13-001 through REQ-13-012
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Shared Prisma transaction client type (avoids duplication across modules)
// ---------------------------------------------------------------------------

export type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ---------------------------------------------------------------------------
// Product type classification
// ---------------------------------------------------------------------------

export type ProductType = 'normal' | 'tshirt' | 'toffs' | 'copa' | 'keyring' | 'hero_shirt';

// ---------------------------------------------------------------------------
// Simulation result types (REQ-13-001 / REQ-13-002)
// ---------------------------------------------------------------------------

export interface SimulationProductResult {
  ordersProductsId: number;
  productsId: number;            // products_id — needed for pre_processed_order_products.order_products_id
  productName: string;
  productsModel: string;
  size: string;
  quantity: number;
  smsStock: number;
  boxNumber: string;
  productType: ProductType;
  hasPrinting: boolean;
  isOutOfStock: boolean;
  /** True when the line is a pre-order product (products_attributes_infos.pre_order='Yes'); legacy skips its pick and forces order status 12. Absent ⇒ false. */
  isPreOrder?: boolean;
  warnings: string[];
}

export interface SimulationResult {
  orderId: number;
  eligible: boolean;
  reason?: string;
  products: SimulationProductResult[];
  proposedStatus: number;
  proposedStatusName: string;
  hasRetroProducts: boolean;
  hasPrintingProducts: boolean;
  totalProducts: number;
  stockAvailableCount: number;
}

// ---------------------------------------------------------------------------
// Invoice log types (REQ-13-005)
// ---------------------------------------------------------------------------

export interface InvoiceLogEntry {
  ordersProductsId: number;
  productName: string;
  size: string;
  remoteProcessingStatus: 'Added' | 'Not Added';
  invoiceType: string;         // 'Complete', 'Multipart', 'No Invoice Printed'
  invoicePrintedBy: string;
  invoiceTime: string;
}

export interface InvoicePrintRow {
  ppr_invoice_barcode: string;
  ppr_invoice_type: string;
  ppr_admin_name: string;
  ppr_datetime: string | null;
}

// ---------------------------------------------------------------------------
// Remote processing types (REQ-13-008)
// ---------------------------------------------------------------------------

export interface RemoteProcessProduct {
  ordersProductsId: number;
  boxNumber: string;
}

export interface RemoteProcessInput {
  type: 'complete' | 'multipart' | 'part' | 'invoice' | 'print';
  products: RemoteProcessProduct[];
}

// ---------------------------------------------------------------------------
// Stock picking types (REQ-13-010)
// ---------------------------------------------------------------------------

export interface StockPickResult {
  available: boolean;
  quantity: number;
  boxCode: string;
  barcode: string;
  productListsId: number;
  boxListsId: number;
}

export interface SizeResolution {
  sizeId: number;
  sizeName: string;
}

export interface ProductCodeResolution {
  productListsId: number;
  parentProductListsId: number;
}

// ---------------------------------------------------------------------------
// Unallocated stock types (REQ-13-009)
// ---------------------------------------------------------------------------

export interface UnallocatedStockItem {
  orderId: number;
  ordersProductsId: number;
  productName: string;
  productsModel: string;
  size: string;
  smsStock: number;
  orderDate: string;
  customerName: string;
}

// ---------------------------------------------------------------------------
// Batch processing types (REQ-13-006)
// ---------------------------------------------------------------------------

export interface BatchProcessResult {
  processed: number;
  failed: number;
  errors: Array<{ orderId: number; error: string }>;
}

/**
 * Result of processing the full eligible queue (#1061 P2). Extends the batch
 * result with the archive number assigned to this run and the orders dropped by
 * the 15-minute rule.
 */
export interface QueueProcessResult extends BatchProcessResult {
  archiveNumber: number;
  total: number;
  flaggedForManual: number[];
}

// ---------------------------------------------------------------------------
// DB row types for raw query results
// ---------------------------------------------------------------------------

export interface OrderForProcessingRow {
  orders_id: number;
  orders_status: number;
  locked_order: number;
  order_site: number | null;
  customers_id: number;
  riskified_status: string | null;
  approve_customer: string;  // ENUM('0','1') — MySQL returns string
  multisite_order_id: string | null;
  fruugo_orders_id: string | null;
  amazon_order_id: string | null;
  ebay_orders_id: string | null;
  order_process_status: string;
  ship_by_date: string | null;
  sift_score_bit: string;  // ENUM('0','1') — always a string
  fraud_status: string;    // customers.fraud_status — '0' means not fraud
  auto_pick: string;       // store_management.auto_pick — 'yes' means skip stock picking
}

export interface OrderProductForProcessingRow {
  orders_products_id: number;
  products_id: number;
  products_name: string;
  products_model: string;
  products_quantity: number;
  box_number: string;
  printing_status: string;
  jit_marked: string;
  backorder: string;
  scanning_status: string;
  arrived_status: string;          // 'Arrived' means skip stock picking
  pick_from_hero_shirt: string;    // 'yes' means hero shirt is pre-printed
  scan_checkpoint: string;         // contains 'checkpoint2' for checkpoint2 scanned products
  virtual_product_type_id: number | null;
  toffs: string | null;
  copa: string | null;
  hero_shirt_parent: string | null;
  hero_shirts: string | null;
  manufacturers_id: number | null;
}

export interface ProductQuantityRow {
  product_quantities_id: number;
  product_lists_id: number;
  size_id: number;
  quantity: number;
  box_lists_id: number;
  box_code: string;
  barcode: string;
}

export interface ProductListRow {
  product_lists_id: number;
  parent_product_lists_id: number;
}

export interface SizeAttributeRow {
  products_options_id: number;
  products_options_values: string;
  products_options_values_id: number;
}

export interface SizeMappingRow {
  default_options_values_id: number;
}

export interface PreProcessedRow {
  pre_processed_order_products_id: number;
  orders_products_id: number;
  orders_id: number;
  archive: number;         // aliased from process_archive in queries
  date_added: string | null;
  to_be_printed: number;   // tinyint(1): 0=not printed, 1=printed
  status: number;          // tinyint(1): 0=new, 3=15min-rule, 4=remote
}

export interface RemoteProcessingRow {
  remote_order_processing_id: number;
  orders_products_id: number;
  orders_id: number;
  archive: number;
  invoice_type: string;
  box_number: string;
  status: number;
  date_added: string | null;
  date_modified: string | null;
  modified_by: string | null;
}

