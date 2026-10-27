/**
 * Type definitions for order products queries and API response.
 * Requirements: REQ-05-001 through REQ-05-019
 */

// ---------------------------------------------------------------------------
// Raw query result types (database row shapes)
// ---------------------------------------------------------------------------

/** Query 1: orders_products + products join */
export interface OrderProductRow {
  orders_products_id: number;
  orders_id: number;
  products_id: number;
  products_model: string | null;
  product_barcode: string | null;
  products_name: string | null;
  products_price: number | null;
  final_price: number | null;
  products_tax: number | null;
  products_quantity: number;
  onetime_charges: number | null;
  free_offer: number | null;
  backorder: string | null;
  replacementStatus: string | null;
  change_quanty: number | null;
  change_name: number | null;
  box_number: string | null;
  kids_chk: string | null;
  ship_chk: string | null;
  ship_date: string | Date | null;
  box1: string | null;
  print_box_name: string | null;
  return_chk: string | null;
  return_com: string | null;
  refund: number | null;
  tax_refund: number | null;
  scanning_status: string | null;
  scan_checkpoint: string | null;
  member_name: string | null;
  matching_status: string | null;
  matching_member_name: string | null;
  exchange_comment_status: string | null;
  order_printing_status: number | null;
  printing_status: string | null;
  arrived_status: string | null;
  jit_marked: string | null;
  assign_box_number: string | null;
  bundle_product_id: string | null;
  fc_order_id: string | null;
  fc_order_product_id: string | null;
  fc_batch_id: string | null;
  fc_tote_id: string | null;
  fc_item_received_scan_user: string | null;
  fc_item_sent_scan_user: string | null;
  add_to_multipart_fc: string | null;
  multipart_batch_id: string | null;
  multipart_fc_batch_id: string | null;
  pb_printer_id: number | null;
  printing_date: string | Date | null;
  is_mystery: string | null;
  similar_products_code: string | null;
  is_manually_added: number | null;
  // Joined from products table
  sms_products_quantity: number | null;
  p_quantity_map: number | null;
  p_manufacturers_id: number | null;
}

/** Query 2: orders_products_attributes */
export interface ProductAttributeRow {
  orders_products_attributes_id: number;
  orders_products_id: number;
  products_options: string | null;
  products_options_values: string | null;
  options_values_price: number | null;
  price_prefix: string | null;
  product_attribute_is_free: number | null;
  products_options_id: number | null;
  products_options_values_id: number | null;
  Size_change: number | null;
  // Joined from pov2po
  resolved_options_values_id: number | null;
}

/** Query 3: SMS quantity lookup */
export interface SmsQuantityRow {
  product_code: string;
  product_lists_id: number;
  products_code_type: number | null;
  parent_product_lists_id: number | null;
  quantity_map: number | null;
  size_id: number | null;
  total_qty: number | null;
}

/** Query 4: suppliers_orders_products */
export interface SupplierAssignmentRow {
  supplier_order_product_id: number;
  order_product_id: number;
  supplier_order_id: number | null;
  supplier_id: number | null;
  product_model: string | null;
  allocate: number | null;
  exception: number | null;
  manufacturers_id: number | null;
}

/** Query 5: product_lists comments */
export interface ProductCommentRow {
  product_code: string;
  pl_comment: string | null;
}

/** Query 6: multipart_fc_orders batch data */
export interface MultipartFcRow {
  mfo_id: number;
  fc_batch_name: string | null;
  fc_order_id: string | null;
}

/** Query 7: T-shirt product IDs (for printing column) */
export interface TshirtCheckRow {
  products_id: number;
}

/** Printer name lookup */
export interface PrinterRow {
  admin_id: number;
  admin_name: string | null;
}

/** Order-level context needed for products endpoint */
export interface OrderContextRow {
  orders_id: number;
  orders_status: number;
  order_site: number | null;
  rtrn_chk: string | null;
  currency: string | null;
  currency_value: number | null;
  id_of_original_order: number | null;
}

// ---------------------------------------------------------------------------
// Assembled response types
// ---------------------------------------------------------------------------

export interface ProductAttribute {
  id: number;
  optionName: string;
  optionValue: string;
  optionId: number | null;
  optionValueId: number | null;
  resolvedOptionValueId: number | null;
  price: number | null;
  pricePrefix: string | null;
  isFree: boolean;
  sizeChanged: boolean;
}

export interface SupplierInfo {
  supplierOrderProductId: number;
  supplierOrderId: number | null;
  supplierId: number | null;
  allocate: number | null;
  exception: number | null;
  manufacturersId: number | null;
}

export interface OrderProductItem {
  ordersProductsId: number;
  productsId: number;
  model: string | null;
  barcode: string | null;
  name: string;
  price: number;
  finalPrice: number;
  tax: number;
  quantity: number;
  onetimeCharges: number;
  freeOffer: boolean;
  backorder: string;
  replacementStatus: string | null;
  changeQuantity: boolean;
  changeName: boolean;
  boxNumber: string | null;
  kidsChk: string | null;
  shipChk: string;
  shipDate: string | null;
  box1: string | null;
  printBoxName: string | null;
  returnChk: string;
  returnComment: string | null;
  refund: boolean;
  taxRefund: boolean;
  scanningStatus: string;
  scanCheckpoint: string | null;
  memberName: string | null;
  matchingStatus: string;
  matchingMemberName: string | null;
  exchangeCommentStatus: string;
  orderPrintingStatus: number;
  printingStatus: string | null;
  arrivedStatus: string | null;
  jitMarked: string;
  assignBoxNumber: string | null;
  bundleProductId: string | null;
  fcOrderId: string | null;
  fcOrderProductId: string | null;
  fcBatchId: string | null;
  fcToteId: string | null;
  fcItemReceivedScanUser: string | null;
  fcItemSentScanUser: string | null;
  addToMultipartFc: string | null;
  multipartBatchId: string | null;
  multipartFcBatchId: string | null;
  pbPrinterId: number | null;
  printingDate: string | null;
  printerName: string | null;
  isMystery: boolean;
  similarProductsCode: string | null;
  isManuallyAdded: boolean;
  // Joined product data
  smsProductsQuantity: number | null;
  productQuantityMap: number | null;
  manufacturersId: number | null;
  // Resolved in service
  attributes: ProductAttribute[];
  smsQuantity: string | number;
  smsQuantityMap: number | null;
  supplier: SupplierInfo | null;
  productComment: string | null;
  multipartFcBatchName: string | null;
  hasTrainersPersonalisation: boolean;
  isTshirtProduct: boolean;
  isAllocationPending: boolean;
  isSupplierSelectable: boolean;
}

export interface OrderProductsResponse {
  products: OrderProductItem[];
  conditionalColumns: {
    showBundleColumn: boolean;
    showAllocateColumn: boolean;
    showPrintingColumn: boolean;
  };
  allBackordered: boolean;
  refundedProducts: OrderProductItem[];
  mysteryProducts: OrderProductItem[];
  orderReturnCheck: string;
  isExchangeOrder: boolean;
  currency: string;
  currencyValue: number;
}
