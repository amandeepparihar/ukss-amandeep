// Sales Dashboard Types

// KPI Response
export interface KPIData {
  period: 'today' | 'week' | 'month' | 'year';
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  pendingOrders: number;
  comparisons: {
    label: string;
    ordersChange: number | null;
    revenueChange: number | null;
    aovChange: number | null;
  }[];
}

export interface TrendDataPoint {
  date: string;
  revenue: number;
  orderCount: number;
  breakdown: { storeName: string; revenue: number; orderCount: number }[];
}

export interface TrendInsight {
  direction: 'up' | 'down' | 'stable';
  percentChange: number;
  bestDay: { date: string; revenue: number };
  worstDay: { date: string; revenue: number };
  message: string;
}

export interface TrendResponse {
  granularity: 'daily' | 'weekly';
  data: TrendDataPoint[];
  insight: TrendInsight;
  previousPeriod?: TrendDataPoint[];
}

export interface MarketplacePerformance {
  storeId: number;
  storeName: string;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  sharePercent: number;
  sparkline: number[];
}

export interface TopProduct {
  productSku: string;
  productName: string;
  teamName: string | null;
  unitsSold: number;
  revenue: number;
  orderCount: number;
}

export interface SlowMovingProduct {
  productCode: string;
  productName: string;
  teamName: string | null;
  totalQuantity: number;
  daysSinceLastSale: number;
  lastSaleDate: string | null;
  listedOn: string[];
}

export interface ProductDetail {
  productCode: string;
  productName: string;
  teamName: string | null;
  averageSellingPrice: number;
  sizeBreakdown: {
    sizeId: number;
    sizeName: string;
    quantity: number;
    minimumQuantity: number;
    committedQuantity: number;
  }[];
  salesTrend: {
    date: string;
    unitsSold: number;
    revenue: number;
  }[];
  storeBreakdown: {
    storeName: string;
    unitsSold: number;
    revenue: number;
  }[];
}

export interface OrderFunnel {
  totalReceived: number;
  pending: number;
  processing: number;
  shipped: number;
  cancelled: number;
  avgTimeToProcessingHours: number | null;
  avgTimeToShippedHours: number | null;
  avgTotalProcessingHours: number | null;
  perStore: {
    storeId: number;
    storeName: string;
    total: number;
    shipped: number;
    shippedRate: number;
  }[];
}

export interface OrderSyncDiscrepancy {
  storeId: number;
  storeName: string;
  totalOrders: number;
  syncedCorrectly: number;
  mismatched: number;
  mismatchRate: number;
  details: {
    expectedStatus: string;
    marketplaceStatus: string;
    count: number;
  }[];
}

export interface GeographicData {
  country: string;
  orderCount: number;
  revenue: number;
}

export interface InventoryHealthSummary {
  lowStock: number;
  outOfStock: number;
  agingInventory: number;
}

export interface InventoryHealthItem {
  productCode: string;
  productName: string;
  teamName: string | null;
  quantity: number;
  minimumQuantity: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
}

export interface ShopifySyncStatus {
  storeId: number;
  storeName: string;
  totalActiveProducts: number;
  pendingSync: number;
  failedSync: number;
  outOfSyncItems: number;
  lastCronRun: string | null;
  isHealthy: boolean;
}

export interface MarketplaceSyncStatus {
  storeId: number;
  storeName: string;
  totalActiveListings: number;
  lastSyncTime: string | null;
  syncSuccessRate: number;
  failedSyncs: number;
  outOfSyncItems: number;
  isHealthy: boolean;
}

export interface SyncHealthResponse {
  shopify: ShopifySyncStatus[];
  marketplace: MarketplaceSyncStatus[];
}

/**
 * One marketplace's row in the Marketplace Sync Performance report.
 *
 * Daily buckets (`syncedToday` etc.) count SKUs whose *most recent* successful
 * sync fell on that day — `marketplace_listings` keeps only a single
 * last-write-wins `last_synced_at`, so a SKU that syncs repeatedly counts only
 * on its latest day. They indicate recency/activity, NOT per-day throughput.
 */
export interface MarketplaceSyncPerfRow {
  storeId: number;
  storeName: string;
  /** Total listing rows for this marketplace. */
  total: number;
  /** Live listings: status IN ('active','confirmed'). */
  live: number;
  successTotal: number;
  failedTotal: number;
  pendingTotal: number;
  retryingTotal: number;
  /** retry_count >= stuckThreshold — failed and NOT auto-retried; needs manual fix. */
  stuckTotal: number;
  /** Failed with api_last_error_code = 'VALIDATION_NEGATIVE_STOCK' (oversell signal). */
  oversellRisk: number;
  /** SKUs whose last successful sync was today / yesterday / day-before / within 3 days. */
  syncedToday: number;
  syncedYesterday: number;
  syncedDayBefore: number;
  syncedLast3Days: number;
  /** % of all listings with last_sync_status = 'success'. */
  successRate: number;
  /** ISO timestamp of the most recent successful sync, or null. */
  lastSyncTime: string | null;
  /**
   * Failed listings grouped by API error code (descending), capped per store.
   * `message` is a representative human-readable error (the marketplace's own
   * ShortMessage), with the internal `[…BATCH…]` correlation prefix stripped;
   * empty string when the marketplace stored no message text.
   */
  topErrors: { code: string; message: string; count: number }[];
}

export interface MarketplaceSyncPerformanceResponse {
  /** ISO timestamp stamped when the request was served (manual-refresh marker). */
  generatedAt: string;
  /** retry_count value at/above which a listing is considered stuck. */
  stuckThreshold: number;
  rows: MarketplaceSyncPerfRow[];
}

// ── Shopify Sync Performance ────────────────────────────────────────────────
// Reads the append-only `shopify_tracking_history` event log (unlike the
// marketplace tab's current-state table), so counts are real throughput and
// `failingSince` is a true onset time.

export type ShopifySyncType =
  | 'product' | 'price' | 'inventory' | 'image' | 'inventoryPolicy';

export type ShopifySyncErrorBucketKey =
  | 'could_not_be_found' | 'invalid_location' | 'throttled' | 'other';

export interface ShopifySyncErrorBucket {
  key: ShopifySyncErrorBucketKey;
  label: string;
  count: number;
  /** A raw example message for the tooltip. */
  sampleMessage: string;
}

export interface ShopifySyncTrendPoint {
  /** 'YYYY-MM-DD HH:00' bucket. */
  hour: string;
  fails: number;
  oks: number;
}

export interface ShopifySyncTypeBreakdown {
  type: ShopifySyncType;
  success: number;
  failure: number;
}

export interface ShopifySyncPerfRow {
  storeId: number;
  storeName: string;
  /** ISO of the most recent log row (any status), or null if none in window. */
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  /** No run within staleThresholdMinutes — cron may be dead. */
  isStale: boolean;
  successTotal: number;
  failureTotal: number;
  /** % success over the window. */
  successRate: number;
  /** COUNT(DISTINCT spv_variation_id) among failures in window. */
  distinctFailingItems: number;
  /** ISO onset of the current failure streak (since last success), or null if healthy. */
  failingSince: string | null;
  byType: ShopifySyncTypeBreakdown[];
  errorBuckets: ShopifySyncErrorBucket[];
  /** Fixed 48h hourly series for the sparkline (independent of window). */
  trend: ShopifySyncTrendPoint[];
}

export interface ShopifySyncPerformanceResponse {
  generatedAt: string;
  windowHours: number;
  staleThresholdMinutes: number;
  rows: ShopifySyncPerfRow[];
}

export interface ShopifySyncFailureRow {
  variationId: string;
  productId: string;
  sku: string | null;
  inventoryItemId: string | null;
  /** Current shopify_products.sp_status (active/draft/...). */
  productStatus: string | null;
  lastMessage: string | null;
  lastSeen: string;
}

export interface ShopifySyncFailuresResponse {
  storeId: number;
  total: number;
  page: number;
  pageSize: number;
  rows: ShopifySyncFailureRow[];
}

export interface ChatbotResponse {
  queryId: string;
  question: string;
  sql: string;
  results: Record<string, unknown>[];
  summary: string;
  resultCount: number;
  executionTimeMs: number;
}

export interface PredefinedQuestion {
  category: 'sales' | 'inventory' | 'operations';
  question: string;
}

export interface StoreInfo {
  storeId: number;
  storeName: string;
  storePlatform: string | null;
}
