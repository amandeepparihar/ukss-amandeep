/**
 * Order Audit Report Types
 *
 * Types for the order audit system that performs deep comparison
 * between marketplace API data, marketplace_orders DB records,
 * and UKSS orders.
 */

import type { MarketplaceName } from './reconciliation.types';

// ============================================
// Line Item Types
// ============================================

export interface AuditLineItem {
  /** Product SKU from the marketplace */
  sku: string;
  /** Product name from the marketplace */
  productName: string;
  /** Quantity ordered */
  quantity: number;
  /** Unit price */
  price: number;
}

// ============================================
// Marketplace Order (from API)
// ============================================

export interface AuditMarketplaceOrder {
  /** Order ID on the marketplace */
  orderId: string;
  /** Store name as stored in mo_store_name */
  storeName: string;
  /** Store ID as stored in mo_store_id */
  storeId: number;
  /** When the order was placed */
  orderDate: Date;
  /** Current order status on the marketplace */
  status: string;
  /** Financial/payment status (Shopify-specific) */
  financialStatus?: string;
  /** Customer full name */
  customerName: string;
  /** Customer email address */
  customerEmail: string;
  /** Shipping address details */
  shippingAddress: {
    line1: string;
    city: string;
    postcode: string;
    country: string;
  };
  /** Line items from the marketplace order */
  lineItems: AuditLineItem[];
  /** Direct URL to view the order on the marketplace */
  marketplaceUrl?: string;
}

// ============================================
// Audit Adapter Interface
// ============================================

export interface AuditAdapter {
  /** Marketplace name identifier */
  name: string;
  /** Store IDs this adapter handles */
  storeIds: number[];
  /** Whether to use external_order_id instead of mo_order_id for DB lookups */
  useExternalOrderId?: boolean;
  /** Fetch detailed order data from the marketplace API */
  fetchOrderDetails(fromDate: Date, toDate: Date): Promise<AuditMarketplaceOrder[]>;
  /** Get a direct URL to view an order on the marketplace admin */
  getOrderUrl(orderId: string, storeId: number): Promise<string | null>;
}

// ============================================
// Audit Options
// ============================================

export interface AuditOptions {
  /** Which marketplace to audit */
  marketplace: MarketplaceName;
  /** Specific store IDs to audit (defaults to all for the marketplace) */
  storeIds?: number[];
  /** Start of the date range */
  fromDate: Date;
  /** End of the date range */
  toDate: Date;
}

// ============================================
// Composite Audit Order Record
// ============================================

export interface AuditOrderRecord {
  /** Data fetched from the marketplace API */
  marketplace: AuditMarketplaceOrder;

  /** Data from the marketplace_orders table */
  mo: {
    found: boolean;
    moId?: number;
    moOrderStatus?: string;
    moCustomerName?: string;
    moCustomerEmail?: string;
    moShippingLine1?: string;
    moShippingCity?: string;
    moShippingCountry?: string;
    moShippingZipcode?: string;
    moUkssOrderId?: number;
    moDateAdded?: Date;
  };

  /** Data from the marketplace_orders_products table */
  mop: {
    products: Array<{
      mopId: number;
      mopProductSku: string;
      mopProductName: string;
      mopProductQuantity: number;
      mopProductPrice: number;
      mopUkssProductSku: string;
      mopUkssOrdersProductsId?: number;
    }>;
  };

  /** Data from the UKSS orders table */
  ukssOrder: {
    found: boolean;
    ordersId?: number;
    ordersStatus?: number;
    /** Human-readable status name (e.g. "Processing", "Shipped") */
    ordersStatusName?: string;
    customersName?: string;
    customersEmailAddress?: string;
    deliveryStreetAddress?: string;
    deliveryCity?: string;
    deliveryPostcode?: string;
    deliveryCountry?: string;
    orderTotal?: number;
    datePurchased?: Date;
  };

  /** Data from the UKSS orders_products table */
  ukssProducts: {
    products: Array<{
      ordersProductsId: number;
      productsModel: string;
      productsName: string;
      productsQuantity: number;
      productsPrice: number;
      finalPrice: number;
    }>;
  };

  /** Flags indicating detected issues */
  flags: {
    /** Order exists on marketplace but not in marketplace_orders */
    missingFromMo: boolean;
    /** Order exists in marketplace_orders but not converted to UKSS order */
    unconverted: boolean;
    /** Product count differs between marketplace and DB records */
    productCountMismatch: boolean;
  };
}

// ============================================
// Audit Report
// ============================================

export interface AuditReport {
  /** Unique identifier for this audit run */
  runId: string;
  /** Marketplace that was audited */
  marketplace: string;
  /** Start of the audited date range */
  fromDate: Date;
  /** End of the audited date range */
  toDate: Date;
  /** When this report was generated */
  generatedAt: Date;
  /** Total number of orders in the report */
  totalOrders: number;
  /** Aggregated summary counts */
  summary: {
    totalFromApi: number;
    foundInMo: number;
    convertedToUkss: number;
    missingFromMo: number;
    unconverted: number;
    productMismatches: number;
  };
  /** Individual order records with full comparison data */
  orders: AuditOrderRecord[];
  /** Errors encountered during the audit (per store) */
  errors: Array<{
    storeId: number;
    storeName: string;
    error: string;
  }>;
}

// ============================================
// Audit Status (for polling / progress)
// ============================================

export interface AuditStatus {
  /** Current status of the audit run */
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** When the audit started (ISO string) */
  startedAt?: string;
  /** When the audit completed (ISO string) */
  completedAt?: string;
  /** Who triggered the audit */
  triggeredBy?: string;
  /** Error message if the audit failed */
  error?: string;
  /** Progress information while running */
  progress?: {
    currentStore: string;
    fetchedOrders: number;
    totalStoresProcessed: number;
    totalStores: number;
    phase: 'fetching' | 'querying_db' | 'assembling';
  };
}
