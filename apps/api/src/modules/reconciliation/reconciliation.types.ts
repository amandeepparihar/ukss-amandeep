/**
 * Order Reconciliation Types
 *
 * Shared types for the reconciliation system.
 */

// ============================================
// CLI Options
// ============================================

export type MarketplaceName = 'shopify' | 'toffs' | 'fruugo' | 'debenhams';

export interface ReconcileOptions {
  marketplace: MarketplaceName | 'all';
  storeIds?: number[];
  hours: number;
  stuckThreshold: number;
  unconvertedThreshold: number;
  verbose: boolean;
  json: boolean;
  noEmail: boolean;
}

// ============================================
// Adapter Types
// ============================================

export interface MarketplaceApiOrder {
  /** Order ID on the marketplace (Shopify order ID, Toffs increment_id, etc.) */
  orderId: string;
  /** Store name as stored in mo_store_name */
  storeName: string;
  /** Store ID as stored in mo_store_id */
  storeId: number;
  /** When the order was placed */
  orderDate: Date;
  /** Total quantity of products (sum of all line item quantities) */
  totalProductQuantity: number;
  /** Marketplace-specific raw data for verbose output */
  raw?: Record<string, unknown>;
}

// ============================================
// Check Result Types
// ============================================

export interface MissingOrderDetail {
  orderId: string;
  storeName: string;
  orderDate: Date;
  marketplaceUrl?: string;
}

export interface MissingOrdersResult {
  apiOrderCount: number;
  dbOrderCount: number;
  missingOrders: MissingOrderDetail[];
}

export interface ProductMismatchDetail {
  orderId: string;
  storeName: string;
  apiQuantity: number;
  dbQuantity: number;
  ukssOrderId?: string;
  marketplaceUrl?: string;
}

export interface MissingProductsResult {
  mismatches: ProductMismatchDetail[];
}

export interface StuckStatusDetail {
  mopId: string;
  orderId: string;
  storeName: string;
  statusToUpdate: string;
  waitingSinceHours: number;
  ukssOrderId?: string;
  marketplaceUrl?: string;
}

export interface StatusSyncResult {
  stuckStatuses: StuckStatusDetail[];
}

export interface UnconvertedOrderDetail {
  moId: string;
  orderId: string;
  storeName: string;
  orderDate: Date;
  ageHours: number;
  marketplaceUrl?: string;
}

export interface UnconvertedOrdersResult {
  unconvertedOrders: UnconvertedOrderDetail[];
}

// ============================================
// Marketplace Result (per marketplace)
// ============================================

export interface MarketplaceReconciliationResult {
  marketplace: string;
  /** Stores checked (for Shopify this is multiple, for others it's 1) */
  storeCount: number;
  apiError?: string;
  missingOrders?: MissingOrdersResult;
  missingProducts?: MissingProductsResult;
  statusSync: StatusSyncResult;
  unconvertedOrders: UnconvertedOrdersResult;
}

// ============================================
// Overall Report
// ============================================

export interface ReconciliationReport {
  runDate: Date;
  windowHours: number;
  stuckThresholdHours: number;
  unconvertedThresholdHours: number;
  results: MarketplaceReconciliationResult[];
  summary: ReconciliationSummary;
}

export interface ReconciliationSummary {
  totalMissing: number;
  totalProductMismatches: number;
  totalStuck: number;
  totalUnconverted: number;
  hasIssues: boolean;
}

// ============================================
// Reconciliation Logging Types
// ============================================

export type ReconciliationLogLevel = 'info' | 'warn' | 'error';

export type ReconciliationLogPhase =
  | 'api_fetch'
  | 'check_missing_orders'
  | 'check_missing_products'
  | 'check_status_sync'
  | 'check_unconverted'
  | 'summary';

export interface ReconciliationLogEntry {
  id: string;
  timestamp: string;
  level: ReconciliationLogLevel;
  marketplace: string;
  store?: string;
  phase: ReconciliationLogPhase;
  message: string;
  details?: {
    endpoint?: string;
    httpStatus?: number;
    durationMs?: number;
    orderCount?: number;
    errorMessage?: string;
    recordCount?: number;
    retryAttempt?: number;
  };
}
