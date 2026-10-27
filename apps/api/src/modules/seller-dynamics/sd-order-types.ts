/**
 * Seller Dynamics Order Integration — Types
 *
 * TypeScript interfaces for the SD SOAP API order responses and
 * service result types used by sd-order-service.ts and sd-status-update.service.ts.
 *
 * Source: D011V010 - Seller Dynamics Order API.pdf + Postman collection.
 *
 * IMPORTANT: GetCustomerOrdersExtended returns a FLAT list — each row is one
 * line item (GoodsPurchasedID). Multiple rows share the same MarketPlaceOrderID
 * when an order has multiple products. The fetch service groups by
 * MarketPlaceOrderID before transforming.
 */

/**
 * Single row from GetCustomerOrdersExtended response.
 * Each row = one GoodsPurchased line item. Order-level fields are repeated
 * across all rows sharing the same MarketPlaceOrderID.
 */
export interface SdCustomerOrderExtended {
  // Order identifiers
  MarketPlaceOrderID: string;
  PurchaseID: string;
  GoodsPurchasedID: string;
  MarketPlaceOrderItemID?: string;

  // Customer
  CustomerName: string;
  CustomerEmail: string;
  CustomerPhone?: string;
  CustomerMarketplaceIdentifier?: string;

  // Shipping address
  ShippingAddress1?: string;
  ShippingAddress2?: string;
  ShippingAddress3?: string;
  ShippingAddressTown?: string;
  ShippingAddressRegion?: string;
  ShippingAddressCountry?: string;
  ShippingAddressPostZIPCode?: string;

  // Billing address
  BillingAddress1?: string;
  BillingAddress2?: string;
  BillingAddress3?: string;
  BillingAddressTown?: string;
  BillingAddressRegion?: string;
  BillingAddressCountry?: string;
  BillingAddressPostZIPCode?: string;

  // Product / line item
  SKU: string;
  ItemTitle: string;
  Quantity: number;
  EANBarCode?: string;

  // Pricing (marketplace currency)
  PricePaid: string;
  PostagePaid: string;
  OrderPostagePaid: string;
  CurrencyCode: string;

  // Pricing (converted to retailer currency)
  ConvertedPricePaid: string;
  ConvertedPostagePaid: string;
  ConvertedOrderPostagePaid: string;

  // Tax
  TaxRate?: number;
  TaxPaid?: number;
  ShippingTaxPaid?: number;
  ConvertedTaxPaid?: number;
  ConvertedShippingTaxPaid?: number;
  TotalTaxPaid?: number;

  // Status
  Status: string;
  OrderStatusID: number;
  IsPaid: boolean;

  // Marketplace
  MarketPlaceName: string;
  /** Routing flag set by SD: 'UKSS' | 'UKSS-POD' | 'UKSS-CUST'. Per line item, not per order. */
  Flag?: string;
  /**
   * Product customisation text (name/number printed on the shirt).
   * SD sends a labelled, LF-separated string: "Name: Leo Numan\nNumber: 19".
   * Parsed by parseSdNotes(); the raw value is preserved in mop_extra_info.
   */
  Notes?: string;

  // Dates
  PurchaseDate?: string;
  ItemShipDate?: string;

  // Shipping
  ShippingMethodRequested?: string;
  PostageMethodName?: string;
  TrackingCode?: string;

  // Other
  EbaySalesRecordNumber?: string;
  PayPalTransactionID?: string;
  PurchaseOrderNumber?: string;
  CostPrice?: number;
  RecordVersion?: string;
  SupplierID?: string;

  // Kit fields
  IsKit?: boolean;
  NoOfKits?: number;
  NoOfKitsAllocated?: number;
  KitCostPrice?: number;
}

/**
 * Grouped order: all line items sharing the same MarketPlaceOrderID.
 * Built by the fetch service before transformation.
 */
export interface SdGroupedOrder {
  orderId: string;
  purchaseId: string;
  lineItems: SdCustomerOrderExtended[];
}

/**
 * Pagination metadata from GetCustomerOrdersExtended response.
 */
export interface SdOrdersResponseMeta {
  PageSize: number;
  PageNumber: number;
  RecordsAffected: number;
  IsError: boolean;
  ErrorMessage?: string;
}

/**
 * Parsed response from GetCustomerOrdersExtended.
 */
export interface SdGetOrdersResult {
  success: boolean;
  orders: SdCustomerOrderExtended[];
  meta: SdOrdersResponseMeta;
  error?: string;
}

/**
 * Input for UpdateOrdersWithTracking — one item per GoodsPurchasedId.
 */
export interface SdOrderUpdateItem {
  GoodsPurchasedId: string;
  Courier: string;
  OtherCourier: string;
  ShippingMethod: string;
  TrackingNumber: string;
  RecordVersion: string;
}

/**
 * Result from UpdateOrdersWithTracking SOAP call.
 */
export interface SdUpdateOrdersResult {
  success: boolean;
  error?: string;
}

/**
 * Result for a single MOP row status push attempt.
 */
export interface UpdateSdOrderStatusResult {
  success: boolean;
  mopId: number;
  status: string;
  error?: string;
}

/**
 * Batch result from the SD status update service.
 */
export interface BatchUpdateSdOrderStatusResult {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<UpdateSdOrderStatusResult & { orderId: string }>;
  error?: string;
}
