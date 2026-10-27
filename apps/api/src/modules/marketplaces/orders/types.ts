/**
 * Marketplace Order Pipeline — Shared Types
 *
 * Types used across all 5 marketplace order integrations for the shared pipeline:
 *   Stage 1 (Fetch) → Stage 2 (MOP Insert) → Stage 3 (UKSS Create) →
 *   Stage 4 (Status Sync) → Stage 5 (Status Push)
 *
 * Each marketplace service produces data conforming to TransformedOrder,
 * which is passed to insertMarketPlaceOrderDetails() in Stage 2.
 */

/**
 * Configuration for a marketplace order integration.
 * Each marketplace defines one of these to configure its service.
 *
 * @example
 * const sportdealConfig: MarketplaceOrderConfig = {
 *   marketplaceName: 'Sportdeal',
 *   storeId: 127,
 *   currency: 'EUR',
 *   shippingMethod: 'Sportdeal Standard',
 * };
 */
export interface MarketplaceOrderConfig {
  /** Display name of the marketplace (e.g., 'Sportdeal', 'Fruugo', 'Toffs') */
  marketplaceName: string;

  /** Store ID from store_management table */
  storeId: number;

  /** Default currency code (e.g., 'EUR', 'GBP'). Can be overridden per order. */
  currency: string;

  /** Default shipping method label (e.g., 'Sportdeal Standard') */
  shippingMethod: string;
}

/**
 * Result of a fetch orders operation (Stage 1 + 2).
 *
 * Returned by each marketplace's fetchOrders() function.
 * Provides enough detail to understand what happened without reading logs.
 */
export interface FetchOrdersResult {
  success: boolean;
  message: string;

  /** Total orders returned by the marketplace API */
  ordersFound: number;

  /** Orders successfully inserted into MOP tables */
  ordersInserted: number;

  /** Orders skipped because they already exist (duplicates) */
  ordersSkipped: number;

  /** Orders that failed during transformation or insertion */
  ordersFailed: number;

  /** Details of individual failures for debugging */
  errors: Array<{ orderId: string; error: string }>;

  /** Total wall-clock time for the entire fetch operation (ms) */
  duration: number;
}

/**
 * Result of a status push operation (Stage 5).
 *
 * Returned by each marketplace's pushStatuses() function.
 */
export interface StatusPushResult {
  success: boolean;

  /** Total products processed */
  processed: number;

  /** Products where marketplace API accepted the status update */
  succeeded: number;

  /** Products where marketplace API rejected or errored */
  failed: number;

  /** Per-product results for debugging */
  results: Array<{
    mopId: number;
    orderId: string;
    status: string;
    success: boolean;
    error?: string;
  }>;

  /** Total wall-clock time for the entire push operation (ms) */
  duration: number;
}

/**
 * The data shape expected by insertMarketPlaceOrderDetails().
 *
 * Each marketplace's transformOrder() must produce a record of these objects,
 * keyed by marketplace order ID. This is the contract between Stage 1 (fetch)
 * and Stage 2 (MOP insert).
 *
 * @see apps/api/src/lib/marketplace-orders/marketplace-orders-utils.ts
 */
export type TransformedOrderMap = Record<string, TransformedOrder>;

export interface TransformedOrder {
  MoMarketplaceOrder: MoOrderData;
  MopMarketplaceOrderProduct: MopProductData[];
  MoshMarketplaceOrderStatusHistory: MoshStatusData;
  PaypalData?: { Paypal: Record<string, unknown> };
}

/**
 * Marketplace order header data (mo_marketplace_orders table).
 *
 * All monetary values are in the marketplace's original currency.
 * Conversion to GBP happens in Stage 3 using moUkssConversionRate.
 */
export interface MoOrderData {
  moStoreName: string;
  moStoreId: number;
  moOrderId: string;
  moOrderPlaceDate: Date | null;
  moOrderUpdateDate: Date | null;
  moOrderShipByDate: Date | null;
  moOrderStatus: string | null;
  moOrderSubtotal: number;
  moShippingTotal: number;
  moOrderTotal: number;
  moOrderCurrency: string | null;
  moOrderCustomerId: string | null;
  moOrderCustomerEmail: string | null;
  moCustomerPhone: string | null;
  moOrderCustomerName: string | null;
  moOrderShippingMethod: string | null;
  moOrderShippingLine1: string | null;
  moOrderShippingLine2: string | null;
  moOrderShippingLine3: string | null;
  moOrderShippingCity: string | null;
  moOrderShippingState: string | null;
  moOrderShippingCountry: string | null;
  moOrderShippingZipcode: string | null;
  moUkssConversionRate: number;
  moUkssOrderId: null;
  moCreatedBy: string;
  moModifiedBy: string;
  moDateAdded: Date;
  moDateModified: Date;
}

/**
 * Marketplace order product data (mop_marketplace_order_products table).
 *
 * One record per product unit (if quantity=3, create 3 records).
 */
export interface MopProductData {
  mopStoreName: string;
  mopOrderId: string;
  mopMoId: number;
  mopProductId: string | null;
  mopProductSku: string | null;
  mopProductStatus: string | null;
  mopProductName: string | null;
  mopProductUpcEan: string | null;
  mopProductPrice: number;
  mopProductVatAmount: number;
  mopProductVatIncluded: string;
  mopProductQuantity: number;
  mopProductAttributeName: string | null;
  mopUkssProductSku: string;
  mopUkssProductId: string;
  mopExtraInfo: string | null;
  mopUkssProductConfirmationStatus: string | null;
  mopUkssProductShippingStatus: string | null;
  mopUkssProductCancelReason: string | null;
  mopUkssProductReturnReason: string | null;
  mopUkssTrackingCode: string | null;
  mopUkssShippingCarrier: string | null;
  mopCreatedBy: string;
  mopModifiedBy: string;
  mopDateAdded: Date;
  mopDateModified: Date;
}

/**
 * Marketplace order status history data (mosh_marketplace_order_status_history table).
 *
 * Created once when the order is first inserted (Stage 2),
 * and again each time the status changes (Stage 4).
 */
export interface MoshStatusData {
  moshMoOrderId: string;
  moshMoId: number;
  moshMoOrderStatus: string;
  moshMuosmId: bigint;
  moshCreatedBy: string;
  moshModifiedBy: string;
  moshDateAdded: Date;
  moshDateModified: Date;
}
