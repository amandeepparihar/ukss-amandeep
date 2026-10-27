/**
 * Sales Dashboard Service
 *
 * Business logic and raw SQL queries for the Sales Dashboard module.
 * All queries target legacy SMS tables (orders, orders_products, product_lists,
 * products, teams, etc.) which are NOT in the Prisma schema, so we use
 * `prisma.$queryRaw` with tagged template literals for safe parameterization.
 *
 * @taskId #165091-10
 */

import { Prisma } from '@prisma/client';
import type {
  KPIData,
  TopProduct,
  SlowMovingProduct,
  ProductDetail,
  OrderFunnel,
  OrderSyncDiscrepancy,
  TrendResponse,
  TrendDataPoint,
  TrendInsight,
  MarketplacePerformance,
  GeographicData,
  ShopifySyncStatus,
  MarketplaceSyncStatus,
  SyncHealthResponse,
  InventoryHealthSummary,
  InventoryHealthItem,
  StoreInfo,
  PaginationMeta,
} from '@admin/shared';
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { getCachedOrFetch, buildCacheKey } from './cache.helper';

// Re-export KPI stats method from dedicated helper (Task 7)
export { getKPIStats } from './kpi.helper';

// ====================================================
// Constants
// ====================================================

/** Cache TTL for dashboard queries (5 minutes). */
const CACHE_TTL_SECONDS = 5 * 60;

/** Grace period for stale-while-revalidate (2 minutes). */
const CACHE_GRACE_SECONDS = 2 * 60;

// ====================================================
// Raw SQL result types
// ====================================================

/**
 * Raw aggregate row returned by the KPI SQL query.
 * MySQL may return bigint or Decimal types as strings.
 * @taskId #165091-7
 */
interface KPIRawRow {
  totalOrders: number | bigint;
  totalRevenue: number | string | null;
  averageOrderValue: number | string | null;
  pendingOrders: number | bigint;
}

/**
 * A date range with inclusive start and exclusive end (midnight boundaries).
 * Datetimes are in UTC but correspond to London midnight boundaries.
 * @taskId #165091-7
 */
interface KPIDateRange {
  start: string; // YYYY-MM-DD HH:mm:ss (UTC equivalent of London midnight start)
  end: string;   // YYYY-MM-DD HH:mm:ss (UTC equivalent of London midnight end, exclusive)
}

/**
 * Definition of a comparison period to compute.
 * @taskId #165091-7
 */
interface ComparisonDef {
  label: string;
  range: KPIDateRange;
}

/** Shape returned by the top-products aggregate query. */
interface TopProductRow {
  products_model: string;
  product_name: string;
  team_name: string | null;
  units_sold: string | number;
  revenue: string | number;
  order_count: string | number;
}

/**
 * Shape returned by the order funnel status count query.
 *
 * Order Status Code Mapping:
 *   1          = Pending
 *   2, 3       = Processing
 *   5          = Shipped
 *   18, 19, 112, 111 = Cancelled
 */
interface FunnelStatusRow {
  total_received: string | number;
  pending: string | number;
  processing: string | number;
  shipped: string | number;
  cancelled: string | number;
}

/** Shape returned by the processing-times query against orders_status_history. */
interface ProcessingTimesRow {
  avg_to_processing_hours: string | number | null;
  avg_to_shipped_hours: string | number | null;
  avg_total_hours: string | number | null;
}

/** Shape returned by the per-store shipped-rate query. */
interface PerStoreShippedRow {
  order_site: string | number;
  store_name: string;
  total: string | number;
  shipped: string | number;
}

/**
 * Shape returned by the daily trend aggregate query.
 * Raw SQL returns numbers as strings (BigInt/Decimal) in MySQL.
 */
interface TrendDailyRow {
  date_label: string;
  revenue: string | number;
  order_count: string | number;
}

/**
 * Shape returned by the daily trend per-store breakdown query.
 */
interface TrendBreakdownRow {
  date_label: string;
  store_name: string;
  revenue: string | number;
  order_count: string | number;
}

/**
 * Shape returned by the order sync status comparison query.
 *
 * Marketplace Order Status Mapping (orders_status -> expected mop_order_status_of_order):
 *   orders_status 5         -> "Shipped"
 *   orders_status 18, 112   -> "Cancel"
 *   orders_status 16, 24    -> "Return"
 *   orders_status 1         -> "Pending"
 *   orders_status 2, 3      -> "Confirm"
 *
 * @taskId #165091-13
 */
interface OrderSyncRow {
  store_id: number;
  store_name: string;
  expected_status: string;
  marketplace_status: string;
  match_count: string | number;
}

/**
 * Shape returned by the slow-moving products aggregate query.
 * Aggregates product_quantities per product_lists entry, with team name.
 * @taskId #165091-11
 */
interface SlowMovingRow {
  product_code: string;
  product_name: string;
  team_name: string | null;
  total_quantity: string | number;
  last_sale_date: string | null;
}

/**
 * Shape returned by the marketplace presence query for slow-moving products.
 * Each row represents one store where a product is actively listed.
 * @taskId #165091-11
 */
interface MarketplacePresenceRow {
  product_code: string;
  store_name: string;
}

/**
 * Shape returned by the product detail size-level stock query.
 * Joins product_quantities with products_options_values for size names.
 * @taskId #165091-11
 */
interface SizeBreakdownRow {
  size_id: number;
  size_name: string;
  quantity: string | number;
  minimum_quantity: string | number;
  committed_quantity: string | number;
}

/**
 * Shape returned by the product detail sales trend query.
 * Daily sales from orders_products joined with orders for the last 30 days.
 * @taskId #165091-11
 */
interface SalesTrendRow {
  sale_date: string;
  units_sold: string | number;
  revenue: string | number;
}

/**
 * Shape returned by the per-store sales breakdown query.
 * Groups orders_products by order_site with store name resolution.
 * @taskId #165091-11
 */
interface StoreBreakdownRow {
  store_name: string;
  units_sold: string | number;
  revenue: string | number;
}

/**
 * Shape returned by the average selling price query.
 * @taskId #165091-11
 */
interface AvgPriceRow {
  avg_price: string | number | null;
}

/**
 * Shape returned by the product info query (name + team).
 * @taskId #165091-11
 */
interface ProductInfoRow {
  product_code: string;
  product_name: string;
  team_name: string | null;
}

/** Maximum range in days before switching from daily to weekly granularity. */
const MAX_DAILY_RANGE_DAYS = 90;

// ====================================================
// Service methods
// ====================================================

/**
 * Fetch the best-selling products within a date range, optionally filtered
 * by store IDs.
 *
 * Joins:
 *   orders_products -> orders (date/store filter)
 *                   -> products -> product_lists -> teams
 *
 * Groups by `products_model` and orders by total units sold descending.
 *
 * Edge cases handled:
 * - Product with null team_name (team not assigned) -> returns `null` for teamName.
 * - Product whose products_model is NOT in product_lists -> still appears using
 *   the name from orders_products (via COALESCE).
 * - No matching orders -> returns empty array.
 *
 * @param startDate - Start of date range (YYYY-MM-DD, inclusive)
 * @param endDate   - End of date range (YYYY-MM-DD, inclusive)
 * @param stores    - Optional array of store IDs to filter by (order_site)
 * @param limit     - Maximum number of products to return (default 20)
 * @returns Array of TopProduct sorted by units sold descending
 *
 * @taskId #165091-10
 */
export async function getTopProducts(
  startDate: string,
  endDate: string,
  stores?: number[],
  limit: number = 20,
): Promise<TopProduct[]> {
  const logger = getLogger('sales-dashboard');

  // Cache key pattern: sd:top-products:{startDate}:{endDate}:{storeIds}:{limit}
  // Limit is included to avoid serving 20 items from cache when 10 were requested.
  const cacheKey = buildCacheKey('top-products', startDate, endDate, stores ?? [], limit);

  const { data } = await getCachedOrFetch<TopProduct[]>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { startDate, endDate, stores, limit },
        'Fetching top products from database',
      );

      // Raw SQL: Legacy table not in Prisma schema
      // Build the WHERE clause dynamically based on whether stores are provided.
      // We always filter by date range on o.date_purchased. If stores are supplied
      // we additionally restrict to those order_site values.
      const rows = stores && stores.length > 0
        ? await prisma.$queryRaw<TopProductRow[]>`
            SELECT
              op.products_model                          AS products_model,
              COALESCE(pl.product_name, op.products_name) AS product_name,
              t.team_name                                AS team_name,
              SUM(op.products_quantity)                   AS units_sold,
              SUM(op.products_quantity * op.final_price) AS revenue,
              COUNT(DISTINCT o.orders_id)                 AS order_count
            FROM orders_products op
              INNER JOIN orders o
                ON op.orders_id = o.orders_id
              LEFT JOIN products p
                ON op.products_id = p.products_id
              LEFT JOIN product_lists pl
                ON p.products_model = pl.product_code
              LEFT JOIN teams t
                ON pl.teams_id = t.teams_id
            WHERE o.date_purchased >= ${startDate}
              AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
              AND o.order_site IN (${Prisma.join(stores)})
            GROUP BY op.products_model, product_name, t.team_name
            ORDER BY units_sold DESC
            LIMIT ${limit}
          `
        : await prisma.$queryRaw<TopProductRow[]>`
            SELECT
              op.products_model                          AS products_model,
              COALESCE(pl.product_name, op.products_name) AS product_name,
              t.team_name                                AS team_name,
              SUM(op.products_quantity)                   AS units_sold,
              SUM(op.products_quantity * op.final_price) AS revenue,
              COUNT(DISTINCT o.orders_id)                 AS order_count
            FROM orders_products op
              INNER JOIN orders o
                ON op.orders_id = o.orders_id
              LEFT JOIN products p
                ON op.products_id = p.products_id
              LEFT JOIN product_lists pl
                ON p.products_model = pl.product_code
              LEFT JOIN teams t
                ON pl.teams_id = t.teams_id
            WHERE o.date_purchased >= ${startDate}
              AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY op.products_model, product_name, t.team_name
            ORDER BY units_sold DESC
            LIMIT ${limit}
          `;

      const products: TopProduct[] = rows.map((row) => ({
        productSku: row.products_model ?? '',
        productName: row.product_name ?? '',
        teamName: row.team_name ?? null,
        unitsSold: Number(row.units_sold) || 0,
        revenue: Number(row.revenue) || 0,
        orderCount: Number(row.order_count) || 0,
      }));

      logger.info(
        { count: products.length, startDate, endDate },
        'Top products query completed',
      );

      return products;
    },
  );

  return data;
}

/**
 * Compare marketplace order statuses against UKSS internal order statuses
 * to identify synchronisation discrepancies per store.
 *
 * Joins:
 *   mo_marketplace_orders (Prisma) -> mop_marketplace_order_products (Prisma)
 *                                  -> orders (legacy, raw SQL join via mo_ukss_order_id)
 *
 * The query uses a CASE expression to map UKSS `orders_status` codes to the
 * expected marketplace `mop_order_status_of_order` value:
 *
 *   orders_status  | Expected marketplace status
 *   -------------- | --------------------------
 *   5              | "Shipped"
 *   18, 112        | "Cancel"
 *   16, 24         | "Return"
 *   1              | "Pending"
 *   2, 3           | "Confirm"
 *   (other)        | "Unknown"
 *
 * Results are grouped by store, expected status, and actual marketplace status
 * so that per-store mismatch counts can be computed.
 *
 * Edge cases:
 * - Marketplace order with NULL `mo_ukss_order_id` is skipped (not yet linked).
 * - Store with 0 marketplace orders in the date range is excluded from results.
 * - 0 % mismatch still included in output with `syncedCorrectly = totalOrders`.
 *
 * @param startDate - Start of date range (YYYY-MM-DD, inclusive)
 * @param endDate   - End of date range (YYYY-MM-DD, inclusive)
 * @param stores    - Optional array of store IDs (mo_store_id) to filter by
 * @returns Array of OrderSyncDiscrepancy, one per store with orders in range
 *
 * @taskId #165091-13
 */
export async function getOrderSyncStatus(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<OrderSyncDiscrepancy[]> {
  const logger = getLogger('sales-dashboard');

  // Cache key: sd:order-sync:{startDate}:{endDate}:{storeIds}
  const cacheKey = buildCacheKey('order-sync', startDate, endDate, stores ?? []);

  const { data } = await getCachedOrFetch<OrderSyncDiscrepancy[]>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { startDate, endDate, stores },
        'Fetching order sync status from database',
      );

      // Raw SQL: Legacy `orders` table is not in Prisma schema.
      // mo_marketplace_orders and mop_marketplace_order_products ARE in Prisma
      // but we use raw SQL for the cross-table JOIN with orders.
      //
      // The CASE maps orders_status to the expected mop_order_status_of_order
      // enum value. We then GROUP BY store, expected status, and actual
      // marketplace status to get counts for each combination.
      const rows = stores && stores.length > 0
        ? await prisma.$queryRaw<OrderSyncRow[]>`
            SELECT
              mo.mo_store_id                            AS store_id,
              sm.store_name                             AS store_name,
              CASE
                WHEN o.orders_status = 5             THEN 'Shipped'
                WHEN o.orders_status IN (18, 112)    THEN 'Cancel'
                WHEN o.orders_status IN (16, 24)     THEN 'Return'
                WHEN o.orders_status = 1             THEN 'Pending'
                WHEN o.orders_status IN (2, 3)       THEN 'Confirm'
                ELSE 'Unknown'
              END                                       AS expected_status,
              mop.mop_order_status_of_order             AS marketplace_status,
              COUNT(*)                                  AS match_count
            FROM mo_marketplace_orders mo
              INNER JOIN mop_marketplace_order_products mop
                ON mop.mop_mo_id = mo.mo_id
              INNER JOIN orders o
                ON o.orders_id = mo.mo_ukss_order_id
              INNER JOIN store_management sm
                ON sm.store_id = mo.mo_store_id
            WHERE mo.mo_ukss_order_id IS NOT NULL
              AND mo.mo_date_added >= ${startDate}
              AND mo.mo_date_added < DATE_ADD(${endDate}, INTERVAL 1 DAY)
              AND mo.mo_store_id IN (${Prisma.join(stores)})
            GROUP BY mo.mo_store_id, sm.store_name, expected_status, mop.mop_order_status_of_order
            ORDER BY mo.mo_store_id, match_count DESC
          `
        : await prisma.$queryRaw<OrderSyncRow[]>`
            SELECT
              mo.mo_store_id                            AS store_id,
              sm.store_name                             AS store_name,
              CASE
                WHEN o.orders_status = 5             THEN 'Shipped'
                WHEN o.orders_status IN (18, 112)    THEN 'Cancel'
                WHEN o.orders_status IN (16, 24)     THEN 'Return'
                WHEN o.orders_status = 1             THEN 'Pending'
                WHEN o.orders_status IN (2, 3)       THEN 'Confirm'
                ELSE 'Unknown'
              END                                       AS expected_status,
              mop.mop_order_status_of_order             AS marketplace_status,
              COUNT(*)                                  AS match_count
            FROM mo_marketplace_orders mo
              INNER JOIN mop_marketplace_order_products mop
                ON mop.mop_mo_id = mo.mo_id
              INNER JOIN orders o
                ON o.orders_id = mo.mo_ukss_order_id
              INNER JOIN store_management sm
                ON sm.store_id = mo.mo_store_id
            WHERE mo.mo_ukss_order_id IS NOT NULL
              AND mo.mo_date_added >= ${startDate}
              AND mo.mo_date_added < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY mo.mo_store_id, sm.store_name, expected_status, mop.mop_order_status_of_order
            ORDER BY mo.mo_store_id, match_count DESC
          `;

      // Aggregate raw rows into per-store OrderSyncDiscrepancy objects.
      // Each row represents one (store, expected_status, marketplace_status) combination.
      const storeMap = new Map<number, {
        storeName: string;
        totalOrders: number;
        syncedCorrectly: number;
        details: { expectedStatus: string; marketplaceStatus: string; count: number }[];
      }>();

      for (const row of rows) {
        const storeId = Number(row.store_id);
        const count = Number(row.match_count) || 0;
        const isMatch = row.expected_status === row.marketplace_status;

        let entry = storeMap.get(storeId);
        if (!entry) {
          entry = {
            storeName: row.store_name,
            totalOrders: 0,
            syncedCorrectly: 0,
            details: [],
          };
          storeMap.set(storeId, entry);
        }

        entry.totalOrders += count;

        if (isMatch) {
          entry.syncedCorrectly += count;
        } else {
          // Only record detail entries for mismatches
          entry.details.push({
            expectedStatus: row.expected_status,
            marketplaceStatus: row.marketplace_status,
            count,
          });
        }
      }

      // Convert map to OrderSyncDiscrepancy array
      const discrepancies: OrderSyncDiscrepancy[] = [];

      for (const [storeId, entry] of storeMap) {
        const mismatched = entry.totalOrders - entry.syncedCorrectly;
        const mismatchRate = entry.totalOrders > 0
          ? Math.round((mismatched / entry.totalOrders) * 10000) / 100
          : 0;

        discrepancies.push({
          storeId,
          storeName: entry.storeName,
          totalOrders: entry.totalOrders,
          syncedCorrectly: entry.syncedCorrectly,
          mismatched,
          mismatchRate,
          details: entry.details,
        });
      }

      logger.info(
        { storeCount: discrepancies.length, startDate, endDate },
        'Order sync status query completed',
      );

      return discrepancies;
    },
  );

  return data;
}

// ====================================================
// Slow Moving Products
// ====================================================

/**
 * Fetch products with the oldest last sale dates that still have stock.
 *
 * Aggregates `product_quantities` per product (GROUP BY product_lists_id)
 * to get total quantity and the most recent (MAX) last_sale_date across sizes.
 * Joins `product_lists` for product name and `teams` for team/brand name.
 *
 * Marketplace presence is determined via two separate queries:
 *   1. `marketplace_listings` (via products table): for eBay/OnBuy/Debenhams/Fruugo/Sportdeal
 *   2. `shopify_products`: for Shopify stores
 * Both are LEFT JOINed to `store_management` for the store display name.
 *
 * Edge cases handled:
 * - Product with NULL last_sale_date: treated as "never sold", sorted first
 *   (most stale). daysSinceLastSale is set to -1 to indicate "never sold".
 * - Product not listed on any marketplace: returns empty `listedOn` array.
 * - Product with NULL team_name: returns `null` for teamName.
 * - Product with zero total quantity across all sizes: excluded (WHERE SUM > 0).
 *
 * @param limit  - Maximum number of products to return (default 20)
 * @param offset - Number of products to skip for pagination (default 0)
 * @returns Array of SlowMovingProduct sorted by last_sale_date ASC (oldest first)
 *
 * @taskId #165091-11
 */
export async function getSlowMovingProducts(
  limit: number = 20,
  offset: number = 0,
): Promise<SlowMovingProduct[]> {
  const logger = getLogger('sales-dashboard');

  // Cache key: sd:slow-products:{limit}:{offset}
  const cacheKey = buildCacheKey('slow-products', limit, offset);

  const { data } = await getCachedOrFetch<SlowMovingProduct[]>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { limit, offset },
        'Fetching slow moving products from database',
      );

      // Raw SQL: Legacy table not in Prisma schema
      // Step 1: Get slow-moving products with aggregated quantities
      // NULL last_sale_date is treated as '1970-01-01' for sorting so "never sold"
      // products appear first (oldest).
      const productRows = await prisma.$queryRaw<SlowMovingRow[]>`
        SELECT
          pl.product_code                     AS product_code,
          pl.product_name                     AS product_name,
          t.team_name                         AS team_name,
          SUM(pq.quantity)                    AS total_quantity,
          CASE
            WHEN MAX(pq.last_sale_date) = '0000-00-00' THEN NULL
            ELSE MAX(pq.last_sale_date)
          END                                 AS last_sale_date
        FROM product_quantities pq
          INNER JOIN product_lists pl
            ON pq.product_lists_id = pl.product_lists_id
          LEFT JOIN teams t
            ON pl.teams_id = t.teams_id
        GROUP BY pl.product_lists_id, pl.product_code, pl.product_name, t.team_name
        HAVING SUM(pq.quantity) > 0
        ORDER BY
          CASE WHEN MAX(pq.last_sale_date) IS NULL OR MAX(pq.last_sale_date) = '0000-00-00' THEN 0 ELSE 1 END ASC,
          CASE WHEN MAX(pq.last_sale_date) = '0000-00-00' THEN NULL ELSE MAX(pq.last_sale_date) END ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      if (productRows.length === 0) {
        logger.info('No slow moving products found');
        return [];
      }

      // Step 2: Get marketplace presence for these product codes.
      // We query both marketplace_listings (non-Shopify) and shopify_products
      // to build the listedOn array.
      const productCodes = productRows.map((r) => r.product_code);

      // Raw SQL: Legacy table not in Prisma schema
      // marketplace_listings -> products (products_id -> products_model) -> product_lists (product_code)
      // shopify_products -> product_lists (np_products_id -> product_lists_id)
      const marketplaceRows = await prisma.$queryRaw<MarketplacePresenceRow[]>`
        SELECT DISTINCT
          pl.product_code                     AS product_code,
          sm.store_name                       AS store_name
        FROM marketplace_listings ml
          INNER JOIN products p
            ON ml.products_id = p.products_id
          INNER JOIN product_lists pl
            ON p.products_model = pl.product_code
          INNER JOIN store_management sm
            ON ml.store_id = sm.store_id
        WHERE ml.marketplace_listing_status = 'active'
          AND pl.product_code IN (${Prisma.join(productCodes)})

        UNION

        SELECT DISTINCT
          pl.product_code                     AS product_code,
          sm.store_name                       AS store_name
        FROM shopify_products sp
          INNER JOIN product_lists pl
            ON sp.np_products_id = pl.product_lists_id
          INNER JOIN store_management sm
            ON sp.sm_store_id = sm.store_id
        WHERE sp.sp_status = 'active'
          AND pl.product_code IN (${Prisma.join(productCodes)})
      `;

      // Build a lookup map: product_code -> store_name[]
      const presenceMap = new Map<string, string[]>();
      for (const row of marketplaceRows) {
        const existing = presenceMap.get(row.product_code);
        if (existing) {
          existing.push(row.store_name);
        } else {
          presenceMap.set(row.product_code, [row.store_name]);
        }
      }

      // Step 3: Map raw rows to SlowMovingProduct interface
      const now = new Date();
      const products: SlowMovingProduct[] = productRows.map((row) => {
        const lastSaleDateStr = row.last_sale_date
          ? String(row.last_sale_date).substring(0, 10)
          : null;

        let daysSinceLastSale: number;
        if (lastSaleDateStr) {
          const lastSaleDate = new Date(lastSaleDateStr);
          daysSinceLastSale = Math.floor(
            (now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24),
          );
        } else {
          // Never sold — use -1 to indicate "never sold"
          daysSinceLastSale = -1;
        }

        return {
          productCode: row.product_code,
          productName: row.product_name ?? '',
          teamName: row.team_name ?? null,
          totalQuantity: Number(row.total_quantity) || 0,
          daysSinceLastSale,
          lastSaleDate: lastSaleDateStr,
          listedOn: presenceMap.get(row.product_code) ?? [],
        };
      });

      logger.info(
        { count: products.length, limit, offset },
        'Slow moving products query completed',
      );

      return products;
    },
  );

  return data;
}

// ====================================================
// Product Detail
// ====================================================

/**
 * Fetch detailed information for a specific product, including:
 *   1. Product info (name, team)
 *   2. Size-level stock breakdown from product_quantities
 *   3. Sales trend over the last 30 days from orders_products + orders
 *   4. Per-store sales breakdown (GROUP BY order_site)
 *   5. Average selling price (AVG of products_price from orders_products)
 *
 * Size names are resolved via the `products_options_values` table, where
 * `product_quantities.size_id` maps to `products_options_values_id`.
 *
 * Edge cases handled:
 * - Product with no sales in the last 30 days: returns empty salesTrend array.
 * - Product with no order history at all: empty storeBreakdown, 0 avg price.
 * - Product not found in product_lists: returns null.
 * - Size not found in products_options_values: uses "Unknown" as size name.
 *
 * @param productCode - The product code (product_lists.product_code) to look up
 * @returns ProductDetail or null if the product code is not found
 *
 * @taskId #165091-11
 */
export async function getProductDetail(
  productCode: string,
): Promise<ProductDetail | null> {
  const logger = getLogger('sales-dashboard');

  // Cache key: sd:product-detail:{productCode}
  const cacheKey = `sd:product-detail:${productCode}`;

  const { data } = await getCachedOrFetch<ProductDetail | null>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { productCode },
        'Fetching product detail from database',
      );

      // Raw SQL: Legacy table not in Prisma schema
      // Step 1: Get product info (name + team)
      const productInfoRows = await prisma.$queryRaw<ProductInfoRow[]>`
        SELECT
          pl.product_code                     AS product_code,
          pl.product_name                     AS product_name,
          t.team_name                         AS team_name
        FROM product_lists pl
          LEFT JOIN teams t
            ON pl.teams_id = t.teams_id
        WHERE pl.product_code = ${productCode}
        LIMIT 1
      `;

      if (productInfoRows.length === 0) {
        logger.warn({ productCode }, 'Product not found in product_lists');
        return null;
      }

      const productInfo = productInfoRows[0];

      // Raw SQL: Legacy table not in Prisma schema
      // Step 2: Size-level stock breakdown
      // product_quantities.size_id -> products_options_values.products_options_values_id
      const sizeRows = await prisma.$queryRaw<SizeBreakdownRow[]>`
        SELECT
          pq.size_id                          AS size_id,
          COALESCE(pov.products_options_values_name, 'Unknown') AS size_name,
          pq.quantity                         AS quantity,
          pq.minimum_quantity                 AS minimum_quantity,
          pq.committed_quantity               AS committed_quantity
        FROM product_quantities pq
          INNER JOIN product_lists pl
            ON pq.product_lists_id = pl.product_lists_id
          LEFT JOIN products_options_values pov
            ON pq.size_id = pov.products_options_values_id
        WHERE pl.product_code = ${productCode}
        ORDER BY pq.size_id ASC
      `;

      // Raw SQL: Legacy table not in Prisma schema
      // Step 3: Sales trend — last 30 days
      // Join orders_products -> orders for date filtering, then products
      // for linking products_model to productCode.
      const salesTrendRows = await prisma.$queryRaw<SalesTrendRow[]>`
        SELECT
          DATE(o.date_purchased)              AS sale_date,
          SUM(op.products_quantity)            AS units_sold,
          SUM(op.products_quantity * op.final_price) AS revenue
        FROM orders_products op
          INNER JOIN orders o
            ON op.orders_id = o.orders_id
        WHERE op.products_model = ${productCode}
          AND o.date_purchased >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(o.date_purchased)
        ORDER BY sale_date ASC
      `;

      // Raw SQL: Legacy table not in Prisma schema
      // Step 4: Per-store sales breakdown (all time for this product)
      // Uses order_site -> store_management for store name.
      // order_site = 0 maps to the main store "UKSoccershop".
      const storeBreakdownRows = await prisma.$queryRaw<StoreBreakdownRow[]>`
        SELECT
          COALESCE(sm.store_name, 'UKSoccershop') AS store_name,
          SUM(op.products_quantity)                AS units_sold,
          SUM(op.products_quantity * op.final_price) AS revenue
        FROM orders_products op
          INNER JOIN orders o
            ON op.orders_id = o.orders_id
          LEFT JOIN store_management sm
            ON o.order_site = sm.store_id
        WHERE op.products_model = ${productCode}
        GROUP BY COALESCE(sm.store_name, 'UKSoccershop')
        ORDER BY revenue DESC
      `;

      // Raw SQL: Legacy table not in Prisma schema
      // Step 5: Average selling price
      const avgPriceRows = await prisma.$queryRaw<AvgPriceRow[]>`
        SELECT
          AVG(op.products_price)              AS avg_price
        FROM orders_products op
        WHERE op.products_model = ${productCode}
      `;

      // Assemble the ProductDetail response
      const detail: ProductDetail = {
        productCode: productInfo.product_code,
        productName: productInfo.product_name ?? '',
        teamName: productInfo.team_name ?? null,
        averageSellingPrice: avgPriceRows.length > 0 && avgPriceRows[0].avg_price !== null
          ? Math.round(Number(avgPriceRows[0].avg_price) * 100) / 100
          : 0,
        sizeBreakdown: sizeRows.map((row) => ({
          sizeId: Number(row.size_id),
          sizeName: row.size_name,
          quantity: Number(row.quantity) || 0,
          minimumQuantity: Number(row.minimum_quantity) || 0,
          committedQuantity: Number(row.committed_quantity) || 0,
        })),
        salesTrend: salesTrendRows.map((row) => ({
          date: String(row.sale_date).substring(0, 10),
          unitsSold: Number(row.units_sold) || 0,
          revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
        })),
        storeBreakdown: storeBreakdownRows.map((row) => ({
          storeName: row.store_name,
          unitsSold: Number(row.units_sold) || 0,
          revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
        })),
      };

      logger.info(
        {
          productCode,
          sizeCount: detail.sizeBreakdown.length,
          trendDays: detail.salesTrend.length,
          storeCount: detail.storeBreakdown.length,
        },
        'Product detail query completed',
      );

      return detail;
    },
  );

  return data;
}

// ====================================================
// Order Funnel
// ====================================================

/**
 * Fetch order funnel data for the given date range, optionally filtered by stores.
 *
 * Includes:
 *  1. Counts by status category:
 *     - Pending (status=1)
 *     - Processing (status IN 2,3)
 *     - Shipped (status=5)
 *     - Cancelled (status IN 18,19,112,111)
 *  2. Average processing times from `orders_status_history`:
 *     - date_purchased -> first status=2 (avg time to processing)
 *     - first status=2 -> first status=5 (avg time processing to shipped)
 *     - date_purchased -> first status=5 (avg total time to shipped)
 *  3. Per-store shipped rate: shipped / total as a percentage
 *
 * Edge cases:
 * - No orders_status_history entries -> null for processing times
 * - Store with 0 orders -> excluded from perStore array
 * - Division by zero for shipped rate -> returns 0
 *
 * @param startDate - Start of date range (YYYY-MM-DD, inclusive)
 * @param endDate   - End of date range (YYYY-MM-DD, inclusive)
 * @param stores    - Optional array of store IDs to filter by (order_site)
 * @returns OrderFunnel with counts, processing times, and per-store rates
 *
 * @taskId #165091-12
 */
export async function getOrderFunnel(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<OrderFunnel> {
  const logger = getLogger('sales-dashboard');

  // Cache key: sd:funnel:{startDate}:{endDate}:{storeIds}
  const cacheKey = buildCacheKey('funnel', startDate, endDate, stores ?? []);

  const { data } = await getCachedOrFetch<OrderFunnel>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { startDate, endDate, stores },
        'Fetching order funnel data from database',
      );

      // Run all three queries in parallel for performance
      const [statusCounts, processingTimes, perStoreData] = await Promise.all([
        fetchFunnelStatusCounts(startDate, endDate, stores),
        fetchProcessingTimes(startDate, endDate, stores),
        fetchPerStoreShippedRates(startDate, endDate, stores),
      ]);

      const funnel: OrderFunnel = {
        totalReceived: Number(statusCounts.total_received) || 0,
        pending: Number(statusCounts.pending) || 0,
        processing: Number(statusCounts.processing) || 0,
        shipped: Number(statusCounts.shipped) || 0,
        cancelled: Number(statusCounts.cancelled) || 0,
        avgTimeToProcessingHours: processingTimes.avg_to_processing_hours !== null
          ? Number(processingTimes.avg_to_processing_hours)
          : null,
        avgTimeToShippedHours: processingTimes.avg_to_shipped_hours !== null
          ? Number(processingTimes.avg_to_shipped_hours)
          : null,
        avgTotalProcessingHours: processingTimes.avg_total_hours !== null
          ? Number(processingTimes.avg_total_hours)
          : null,
        perStore: perStoreData.map((row) => {
          const total = Number(row.total) || 0;
          const shipped = Number(row.shipped) || 0;
          // Edge case: Division by zero -> return 0
          const shippedRate = total > 0
            ? Math.round((shipped / total) * 10000) / 100
            : 0;

          return {
            storeId: Number(row.order_site),
            storeName: row.store_name ?? 'Unknown Store',
            total,
            shipped,
            shippedRate,
          };
        }),
      };

      logger.info(
        {
          totalReceived: funnel.totalReceived,
          perStoreCount: funnel.perStore.length,
          startDate,
          endDate,
        },
        'Order funnel query completed',
      );

      return funnel;
    },
  );

  return data;
}

// ====================================================
// Order Funnel — Internal query helpers
// ====================================================

/**
 * Count orders by status category.
 *
 * Order Status Code Mapping:
 *   1          = Pending
 *   2, 3       = Processing
 *   5          = Shipped
 *   18, 19, 112, 111 = Cancelled
 *
 * @taskId #165091-12
 */
async function fetchFunnelStatusCounts(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<FunnelStatusRow> {
  // Raw SQL: Legacy table not in Prisma schema
  const rows = stores && stores.length > 0
    ? await prisma.$queryRaw<FunnelStatusRow[]>`
        SELECT
          COUNT(*)                                                                     AS total_received,
          SUM(CASE WHEN o.orders_status = 1 THEN 1 ELSE 0 END)                        AS pending,
          SUM(CASE WHEN o.orders_status IN (2, 3) THEN 1 ELSE 0 END)                  AS processing,
          SUM(CASE WHEN o.orders_status = 5 THEN 1 ELSE 0 END)                        AS shipped,
          SUM(CASE WHEN o.orders_status IN (18, 19, 112, 111) THEN 1 ELSE 0 END)      AS cancelled
        FROM orders o
        WHERE o.date_purchased >= ${startDate}
          AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          AND o.order_site IN (${Prisma.join(stores)})
      `
    : await prisma.$queryRaw<FunnelStatusRow[]>`
        SELECT
          COUNT(*)                                                                     AS total_received,
          SUM(CASE WHEN o.orders_status = 1 THEN 1 ELSE 0 END)                        AS pending,
          SUM(CASE WHEN o.orders_status IN (2, 3) THEN 1 ELSE 0 END)                  AS processing,
          SUM(CASE WHEN o.orders_status = 5 THEN 1 ELSE 0 END)                        AS shipped,
          SUM(CASE WHEN o.orders_status IN (18, 19, 112, 111) THEN 1 ELSE 0 END)      AS cancelled
        FROM orders o
        WHERE o.date_purchased >= ${startDate}
          AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
      `;

  // Aggregate query always returns exactly one row
  return rows[0] ?? {
    total_received: 0,
    pending: 0,
    processing: 0,
    shipped: 0,
    cancelled: 0,
  };
}

/**
 * Calculate average processing times from orders_status_history.
 *
 * Computes three metrics:
 *   - avg_to_processing_hours: AVG time from date_purchased to first status=2
 *   - avg_to_shipped_hours:    AVG time from first status=2 to first status=5
 *   - avg_total_hours:         AVG time from date_purchased to first status=5
 *
 * Uses MIN(date_added) per order per status to get the FIRST occurrence of each
 * status transition, avoiding inflated averages from status re-entries.
 *
 * Edge case: No orders_status_history entries -> returns null for all times.
 *
 * @taskId #165091-12
 */
async function fetchProcessingTimes(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<ProcessingTimesRow> {
  // Raw SQL: Legacy table not in Prisma schema
  // Sub-query approach: first derive per-order timestamps from orders_status_history,
  // then aggregate averages across all orders.
  const rows = stores && stores.length > 0
    ? await prisma.$queryRaw<ProcessingTimesRow[]>`
        SELECT
          AVG(TIMESTAMPDIFF(HOUR, per_order.date_purchased, per_order.first_processing))
            AS avg_to_processing_hours,
          AVG(TIMESTAMPDIFF(HOUR, per_order.first_processing, per_order.first_shipped))
            AS avg_to_shipped_hours,
          AVG(TIMESTAMPDIFF(HOUR, per_order.date_purchased, per_order.first_shipped))
            AS avg_total_hours
        FROM (
          SELECT
            o.orders_id,
            o.date_purchased,
            MIN(CASE WHEN osh.orders_status_id = 2 THEN osh.date_added END) AS first_processing,
            MIN(CASE WHEN osh.orders_status_id = 5 THEN osh.date_added END) AS first_shipped
          FROM orders o
            INNER JOIN orders_status_history osh
              ON o.orders_id = osh.orders_id
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY o.orders_id, o.date_purchased
        ) AS per_order
      `
    : await prisma.$queryRaw<ProcessingTimesRow[]>`
        SELECT
          AVG(TIMESTAMPDIFF(HOUR, per_order.date_purchased, per_order.first_processing))
            AS avg_to_processing_hours,
          AVG(TIMESTAMPDIFF(HOUR, per_order.first_processing, per_order.first_shipped))
            AS avg_to_shipped_hours,
          AVG(TIMESTAMPDIFF(HOUR, per_order.date_purchased, per_order.first_shipped))
            AS avg_total_hours
        FROM (
          SELECT
            o.orders_id,
            o.date_purchased,
            MIN(CASE WHEN osh.orders_status_id = 2 THEN osh.date_added END) AS first_processing,
            MIN(CASE WHEN osh.orders_status_id = 5 THEN osh.date_added END) AS first_shipped
          FROM orders o
            INNER JOIN orders_status_history osh
              ON o.orders_id = osh.orders_id
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY o.orders_id, o.date_purchased
        ) AS per_order
      `;

  // Aggregate query always returns exactly one row; AVG returns NULL if no rows
  return rows[0] ?? {
    avg_to_processing_hours: null,
    avg_to_shipped_hours: null,
    avg_total_hours: null,
  };
}

/**
 * Calculate per-store shipped rates.
 *
 * Groups orders by order_site, joins with store_management for store names,
 * and counts total vs shipped orders per store.
 *
 * Edge case: Stores with 0 orders in the date range are excluded (the GROUP BY
 * only includes stores with at least one order in the range).
 *
 * @taskId #165091-12
 */
async function fetchPerStoreShippedRates(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<PerStoreShippedRow[]> {
  // Raw SQL: Legacy table not in Prisma schema
  const rows = stores && stores.length > 0
    ? await prisma.$queryRaw<PerStoreShippedRow[]>`
        SELECT
          o.order_site                                         AS order_site,
          COALESCE(sm.store_name, 'Unknown Store')             AS store_name,
          COUNT(*)                                             AS total,
          SUM(CASE WHEN o.orders_status = 5 THEN 1 ELSE 0 END) AS shipped
        FROM orders o
          LEFT JOIN store_management sm
            ON o.order_site = sm.store_id
        WHERE o.date_purchased >= ${startDate}
          AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          AND o.order_site IN (${Prisma.join(stores)})
        GROUP BY o.order_site, sm.store_name
        ORDER BY total DESC
      `
    : await prisma.$queryRaw<PerStoreShippedRow[]>`
        SELECT
          o.order_site                                         AS order_site,
          COALESCE(sm.store_name, 'Unknown Store')             AS store_name,
          COUNT(*)                                             AS total,
          SUM(CASE WHEN o.orders_status = 5 THEN 1 ELSE 0 END) AS shipped
        FROM orders o
          LEFT JOIN store_management sm
            ON o.order_site = sm.store_id
        WHERE o.date_purchased >= ${startDate}
          AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
        GROUP BY o.order_site, sm.store_name
        ORDER BY total DESC
      `;

  return rows;
}

// ====================================================
// Raw SQL result types — Marketplace Breakdown (Task 9)
// ====================================================

/**
 * Raw aggregate row returned by the marketplace breakdown order query.
 * MySQL returns bigint as BigInt and Decimal as string.
 * @taskId #165091-9
 */
interface MarketplaceOrderRow {
  order_site: number;
  order_count: bigint;
  total_revenue: number | string | null;
  avg_order_value: number | string | null;
}

/**
 * Raw row from the 7-day sparkline sub-query.
 * @taskId #165091-9
 */
interface SparklineRow {
  order_site: number;
  day_date: string;
  daily_revenue: number | string | null;
}

/**
 * Raw row from the store lookup query (all stores, including inactive).
 * @taskId #165091-9
 */
interface ActiveStoreRow {
  store_id: number;
  store_name: string;
  status: string;
}

// ====================================================
// Raw SQL result types — Geographic Breakdown (Task 9)
// ====================================================

/**
 * Raw row from the geographic country aggregate query.
 * @taskId #165091-9
 */
interface CountryRow {
  country: string | null;
  order_count: bigint;
  total_revenue: number | string | null;
}

/**
 * Raw row from the geographic grand totals query.
 * @taskId #165091-9
 */
interface GrandTotalsRow {
  total_orders: bigint;
  total_revenue: number | string | null;
}

// ====================================================
// Marketplace Breakdown — Task 9
// ====================================================

/**
 * Fetch marketplace/store performance breakdown for the selected date range.
 *
 * Groups orders by `order_site`, joins `store_management` for display names,
 * calculates each store's share of total revenue, and includes a 7-day
 * sparkline (daily revenue array) per store.
 *
 * All stores (including inactive) with 0 orders in the range are still
 * included from store_management. An unknown `order_site` value (no
 * matching store_management row) is labelled "Unknown Store".
 * UKSoccershop (store_id = 0) is included from store_management.
 *
 * Cache key: `sd:marketplace:{startDate}:{endDate}`
 *
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param endDate   - ISO date string (YYYY-MM-DD)
 * @returns Array of MarketplacePerformance sorted by revenue DESC
 *
 * @taskId #165091-9
 */
export async function getMarketplaceBreakdown(
  startDate: string,
  endDate: string,
  limit: number = 5,
  noCache?: boolean,
): Promise<MarketplacePerformance[]> {
  const logger = getLogger('sales-dashboard');
  const cacheKey = buildCacheKey('marketplace', startDate, endDate);

  const { data } = await getCachedOrFetch<MarketplacePerformance[]>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info({ startDate, endDate }, 'Fetching marketplace breakdown from database');

      // Step 1: Get all stores (including inactive) for name resolution
      // Raw SQL: store_management IS in Prisma but we use raw SQL for consistency
      const allStores = await prisma.$queryRaw<ActiveStoreRow[]>(
        Prisma.sql`
          SELECT store_id, store_name, status
          FROM store_management
        `,
      );

      // Build lookup map: store_id -> store_name
      const storeNameMap = new Map<number, string>();
      for (const store of allStores) {
        storeNameMap.set(store.store_id, store.store_name);
      }

      // Step 2: Aggregate orders by order_site within the date range
      // Raw SQL: Legacy table not in Prisma schema
      const orderAggregates = await prisma.$queryRaw<MarketplaceOrderRow[]>(
        Prisma.sql`
          SELECT
            o.order_site,
            COUNT(o.orders_id) AS order_count,
            COALESCE(SUM(o.order_total), 0) AS total_revenue,
            CASE
              WHEN COUNT(o.orders_id) > 0
                THEN ROUND(SUM(o.order_total) / COUNT(o.orders_id), 2)
              ELSE 0
            END AS avg_order_value
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY o.order_site
        `,
      );

      // Step 3: Calculate grand total revenue for share % calculation
      let grandTotalRevenue = 0;
      for (const row of orderAggregates) {
        grandTotalRevenue += Number(row.total_revenue ?? 0);
      }

      // Step 4: Fetch 7-day sparkline data (last 7 days ending on endDate)
      // Raw SQL: Legacy table not in Prisma schema
      const sparklineData = await prisma.$queryRaw<SparklineRow[]>(
        Prisma.sql`
          SELECT
            o.order_site,
            DATE(o.date_purchased) AS day_date,
            COALESCE(SUM(o.order_total), 0) AS daily_revenue
          FROM orders o
          WHERE o.date_purchased >= DATE_SUB(${endDate}, INTERVAL 6 DAY)
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY o.order_site, DATE(o.date_purchased)
          ORDER BY o.order_site, day_date ASC
        `,
      );

      // Build sparkline lookup: order_site -> Map<dateString, revenue>
      const sparklineMap = new Map<number, Map<string, number>>();
      for (const row of sparklineData) {
        // Ensure order_site is converted to number (MySQL may return as string)
        const storeId = Number(row.order_site);
        if (!sparklineMap.has(storeId)) {
          sparklineMap.set(storeId, new Map());
        }
        sparklineMap
          .get(storeId)!
          .set(String(row.day_date), Number(row.daily_revenue ?? 0));
      }

      // Generate the 7-day date range for sparkline alignment
      const sparklineDates: string[] = [];
      const endDateObj = new Date(endDate + 'T00:00:00Z');
      for (let i = 6; i >= 0; i--) {
        const d = new Date(endDateObj);
        d.setUTCDate(d.getUTCDate() - i);
        sparklineDates.push(d.toISOString().split('T')[0]);
      }

      // Step 5: Build order data map
      const orderDataMap = new Map<
        number,
        { orderCount: number; totalRevenue: number; avgOrderValue: number }
      >();
      for (const row of orderAggregates) {
        // Ensure order_site is converted to number (MySQL may return as string)
        const storeId = Number(row.order_site);
        orderDataMap.set(storeId, {
          orderCount: Number(row.order_count),
          totalRevenue: Number(row.total_revenue ?? 0),
          avgOrderValue: Number(row.avg_order_value ?? 0),
        });
      }

      // Step 6: Merge all stores + order data
      // Include all stores from store_management
      const allStoreIds = new Set<number>([...allStores.map((s) => s.store_id)]);
      // Also include any order_site values that have orders but are not in active stores
      // These will be labelled "Unknown Store"
      for (const row of orderAggregates) {
        // Ensure order_site is converted to number (MySQL may return as string)
        allStoreIds.add(Number(row.order_site));
      }

      const results: MarketplacePerformance[] = [];
      for (const storeId of allStoreIds) {
        const storeName = storeNameMap.get(storeId) ?? 'Unknown Store';
        const orderData = orderDataMap.get(storeId) ?? {
          orderCount: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
        };

        // Build sparkline array: 7 daily revenue values aligned to sparklineDates
        const storeSparkline = sparklineMap.get(storeId);
        const sparkline = sparklineDates.map((dateStr) =>
          storeSparkline ? Number(storeSparkline.get(dateStr) ?? 0) : 0,
        );

        const sharePercent =
          grandTotalRevenue > 0
            ? Math.round((orderData.totalRevenue / grandTotalRevenue) * 10000) / 100
            : 0;

        results.push({
          storeId,
          storeName,
          orderCount: orderData.orderCount,
          revenue: Math.round(orderData.totalRevenue * 100) / 100,
          averageOrderValue: Math.round(orderData.avgOrderValue * 100) / 100,
          sharePercent,
          sparkline,
        });
      }

      // Sort by revenue descending, filter zero-revenue, and limit
      const filtered = results
        .filter((r) => r.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);

      logger.info(
        { storeCount: filtered.length, totalStores: results.length, grandTotalRevenue: Math.round(grandTotalRevenue * 100) / 100 },
        'Marketplace breakdown query completed',
      );

      return filtered;
    },
    noCache,
  );

  return data;
}

// ====================================================
// Geographic Breakdown — Task 9
// ====================================================

/**
 * Fetch geographic sales distribution for the selected date range.
 *
 * Groups orders by `delivery_country`, returns the top 10 countries by
 * order count, and aggregates all remaining countries into an "Others"
 * entry. Empty or NULL `delivery_country` values are labelled "Unknown".
 *
 * Cache key: `sd:geo:{startDate}:{endDate}:{storeIds}`
 *
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param endDate   - ISO date string (YYYY-MM-DD)
 * @param stores    - Optional array of store IDs to filter by
 * @returns Array of GeographicData (top 10 + optional "Others"), sorted by orderCount DESC
 *
 * @taskId #165091-9
 */
export async function getGeographicBreakdown(
  startDate: string,
  endDate: string,
  stores?: number[],
): Promise<GeographicData[]> {
  const logger = getLogger('sales-dashboard');
  const cacheKey = buildCacheKey('geo', startDate, endDate, stores);

  const { data } = await getCachedOrFetch<GeographicData[]>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info({ startDate, endDate, stores }, 'Fetching geographic breakdown from database');

      const hasStoreFilter = stores && stores.length > 0;

      // Raw SQL: Legacy table not in Prisma schema
      // Query top 11 countries by order count. We fetch 11 to determine
      // whether "Others" aggregation is needed (if exactly 11 rows returned,
      // there are more countries beyond the top 10).
      const countryData = hasStoreFilter
        ? await prisma.$queryRaw<CountryRow[]>(
            Prisma.sql`
              SELECT
                CASE
                  WHEN o.delivery_country IS NULL OR TRIM(o.delivery_country) = ''
                    THEN 'Unknown'
                  ELSE o.delivery_country
                END AS country,
                COUNT(o.orders_id) AS order_count,
                COALESCE(SUM(o.order_total), 0) AS total_revenue
              FROM orders o
              WHERE o.date_purchased >= ${startDate}
                AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
                AND o.order_site IN (${Prisma.join(stores!)})
              GROUP BY country
              ORDER BY order_count DESC
              LIMIT 11
            `,
          )
        : await prisma.$queryRaw<CountryRow[]>(
            Prisma.sql`
              SELECT
                CASE
                  WHEN o.delivery_country IS NULL OR TRIM(o.delivery_country) = ''
                    THEN 'Unknown'
                  ELSE o.delivery_country
                END AS country,
                COUNT(o.orders_id) AS order_count,
                COALESCE(SUM(o.order_total), 0) AS total_revenue
              FROM orders o
              WHERE o.date_purchased >= ${startDate}
                AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
              GROUP BY country
              ORDER BY order_count DESC
              LIMIT 11
            `,
          );

      // If we got exactly 11 rows, there are more countries -> compute "Others"
      if (countryData.length === 11) {
        const top10 = countryData.slice(0, 10);

        // Query grand totals for "Others" calculation
        // Raw SQL: Legacy table not in Prisma schema
        const grandTotals = hasStoreFilter
          ? await prisma.$queryRaw<GrandTotalsRow[]>(
              Prisma.sql`
                SELECT
                  COUNT(o.orders_id) AS total_orders,
                  COALESCE(SUM(o.order_total), 0) AS total_revenue
                FROM orders o
                WHERE o.date_purchased >= ${startDate}
                  AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
                  AND o.order_site IN (${Prisma.join(stores!)})
              `,
            )
          : await prisma.$queryRaw<GrandTotalsRow[]>(
              Prisma.sql`
                SELECT
                  COUNT(o.orders_id) AS total_orders,
                  COALESCE(SUM(o.order_total), 0) AS total_revenue
                FROM orders o
                WHERE o.date_purchased >= ${startDate}
                  AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
              `,
            );

        const grandTotalOrders = Number(grandTotals[0]?.total_orders ?? 0);
        const grandTotalRevenue = Number(grandTotals[0]?.total_revenue ?? 0);

        // Sum top 10 orders and revenue
        let top10Orders = 0;
        let top10Revenue = 0;
        for (const row of top10) {
          top10Orders += Number(row.order_count);
          top10Revenue += Number(row.total_revenue ?? 0);
        }

        // Build result: top 10 + Others
        const results: GeographicData[] = top10.map((row) => ({
          country: String(row.country ?? 'Unknown'),
          orderCount: Number(row.order_count),
          revenue: Math.round(Number(row.total_revenue ?? 0) * 100) / 100,
        }));

        const othersOrders = grandTotalOrders - top10Orders;
        const othersRevenue = grandTotalRevenue - top10Revenue;

        if (othersOrders > 0) {
          results.push({
            country: 'Others',
            orderCount: othersOrders,
            revenue: Math.round(othersRevenue * 100) / 100,
          });
        }

        logger.info(
          { countriesReturned: results.length, grandTotalOrders },
          'Geographic breakdown completed (with Others aggregation)',
        );

        return results;
      }

      // 10 or fewer distinct countries -> return all as-is
      const results: GeographicData[] = countryData.map((row) => ({
        country: String(row.country ?? 'Unknown'),
        orderCount: Number(row.order_count),
        revenue: Math.round(Number(row.total_revenue ?? 0) * 100) / 100,
      }));

      logger.info(
        { countriesReturned: results.length },
        'Geographic breakdown completed (no Others needed)',
      );

      return results;
    },
  );

  return data;
}

// ====================================================
// getTrends — helpers
// ====================================================

/**
 * Calculate the number of days between two YYYY-MM-DD date strings (inclusive).
 * Returns 1 for a single-day range where startDate === endDate.
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Calculate the previous equivalent period's start and end dates.
 * For a range of N days ending on endDate, the previous period covers
 * the N days immediately before startDate.
 *
 * Example: 2026-02-20 to 2026-02-27 (8 days) -> previous: 2026-02-12 to 2026-02-19
 */
function getPreviousPeriodDates(startDate: string, endDate: string): { prevStart: string; prevEnd: string } {
  const rangeDays = daysBetween(startDate, endDate);
  const start = new Date(startDate + 'T00:00:00Z');
  const prevEnd = new Date(start.getTime() - 1000 * 60 * 60 * 24); // day before startDate
  const prevStart = new Date(prevEnd.getTime() - (rangeDays - 1) * 1000 * 60 * 60 * 24);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

/**
 * Calculate trend insight from an array of trend data points.
 *
 * - **direction**: Compare average revenue of the first half vs second half
 *   of the range. "up" if second half > first half by more than 5%,
 *   "down" if lower by more than 5%, "stable" otherwise.
 * - **bestDay / worstDay**: Data point with highest / lowest revenue.
 * - **message**: Human-readable summary.
 *
 * @taskId #165091-8
 */
function calculateInsight(data: TrendDataPoint[], granularity: 'daily' | 'weekly' | 'monthly'): TrendInsight {
  const periodLabel = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

  // Empty data fallback
  if (data.length === 0) {
    return {
      direction: 'stable',
      percentChange: 0,
      bestDay: { date: '', revenue: 0 },
      worstDay: { date: '', revenue: 0 },
      message: 'No data available for the selected period.',
    };
  }

  // Single data point — no trend can be derived
  if (data.length === 1) {
    const point = data[0];
    return {
      direction: 'stable',
      percentChange: 0,
      bestDay: { date: point.date, revenue: point.revenue },
      worstDay: { date: point.date, revenue: point.revenue },
      message: `Single ${periodLabel} with £${point.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue and ${point.orderCount} orders.`,
    };
  }

  // Find best and worst data points by revenue
  let best = data[0];
  let worst = data[0];
  for (const point of data) {
    if (point.revenue > best.revenue) best = point;
    if (point.revenue < worst.revenue) worst = point;
  }

  // Calculate direction by comparing first half vs second half average revenue
  const midpoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midpoint);
  const secondHalf = data.slice(midpoint);

  const avgFirst = firstHalf.reduce((sum, p) => sum + p.revenue, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, p) => sum + p.revenue, 0) / secondHalf.length;

  let percentChange = 0;
  let direction: 'up' | 'down' | 'stable' = 'stable';

  if (avgFirst > 0) {
    percentChange = ((avgSecond - avgFirst) / avgFirst) * 100;
    percentChange = Math.round(percentChange * 100) / 100; // 2 decimal places
    if (percentChange > 5) {
      direction = 'up';
    } else if (percentChange < -5) {
      direction = 'down';
    }
  } else if (avgSecond > 0) {
    // First half had zero revenue but second half has some — trending up
    direction = 'up';
    percentChange = 100;
  }

  // Build human-readable message
  const dirLabel = direction === 'up' ? 'trending up' : direction === 'down' ? 'trending down' : 'stable';
  const pctLabel = Math.abs(percentChange).toFixed(1);
  const bestRevFmt = best.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const worstRevFmt = worst.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const message = `Revenue is ${dirLabel} ${pctLabel}% over the selected period. Best ${periodLabel}: ${best.date} (£${bestRevFmt}). Lowest: ${worst.date} (£${worstRevFmt}).`;

  return {
    direction,
    percentChange,
    bestDay: { date: best.date, revenue: best.revenue },
    worstDay: { date: worst.date, revenue: worst.revenue },
    message,
  };
}

// ====================================================
// getTrends — data fetching
// ====================================================

/**
 * Fetch a trend dataset (totals + per-store breakdown) for a given date range.
 * Used by getTrends for both the primary period and previous-period queries.
 *
 * Runs two queries:
 *   1. Totals per date bucket (revenue, order count)
 *   2. Per-store breakdown per date bucket (LEFT JOIN store_management)
 *
 * @param startDate   - YYYY-MM-DD, inclusive
 * @param endDate     - YYYY-MM-DD, inclusive
 * @param stores      - Optional store IDs to filter
 * @param granularity - 'daily' or 'weekly'
 * @returns Array of TrendDataPoint with per-store breakdown
 *
 * @taskId #165091-8
 */
async function fetchTrendData(
  startDate: string,
  endDate: string,
  stores: number[] | undefined,
  granularity: 'daily' | 'weekly' | 'monthly',
): Promise<TrendDataPoint[]> {
  const logger = getLogger('sales-dashboard');
  const isDaily = granularity === 'daily';
  const isMonthly = granularity === 'monthly';

  // ------------------------------------------------------------------
  // Query 1: Totals per date bucket
  // Raw SQL: Legacy table not in Prisma schema
  // Daily:  GROUP BY DATE(date_purchased), label is YYYY-MM-DD
  // Weekly: GROUP BY YEARWEEK(date_purchased, 3), label is YYYY-Www (ISO 8601)
  // ------------------------------------------------------------------
  let totalRows: TrendDailyRow[];

  if (isDaily) {
    totalRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            DATE_FORMAT(DATE(o.date_purchased), '%Y-%m-%d') AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY DATE(o.date_purchased)
          ORDER BY date_label ASC
        `
      : await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            DATE_FORMAT(DATE(o.date_purchased), '%Y-%m-%d') AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY DATE(o.date_purchased)
          ORDER BY date_label ASC
        `;
  } else if (isMonthly) {
    // Monthly aggregation, labeled as the first day of the month (YYYY-MM-01)
    totalRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            DATE_FORMAT(o.date_purchased, '%Y-%m-01')       AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY DATE_FORMAT(o.date_purchased, '%Y-%m')
          ORDER BY date_label ASC
        `
      : await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            DATE_FORMAT(o.date_purchased, '%Y-%m-01')       AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY DATE_FORMAT(o.date_purchased, '%Y-%m')
          ORDER BY date_label ASC
        `;
  } else {
    // Weekly aggregation using YEARWEEK mode 3 (ISO 8601 weeks)
    totalRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            CONCAT(
              LPAD(FLOOR(YEARWEEK(o.date_purchased, 3) / 100), 4, '0'),
              '-W',
              LPAD(YEARWEEK(o.date_purchased, 3) % 100, 2, '0')
            )                                               AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY YEARWEEK(o.date_purchased, 3)
          ORDER BY date_label ASC
        `
      : await prisma.$queryRaw<TrendDailyRow[]>`
          SELECT
            CONCAT(
              LPAD(FLOOR(YEARWEEK(o.date_purchased, 3) / 100), 4, '0'),
              '-W',
              LPAD(YEARWEEK(o.date_purchased, 3) % 100, 2, '0')
            )                                               AS date_label,
            COALESCE(SUM(o.order_total), 0)                 AS revenue,
            COUNT(*)                                        AS order_count
          FROM orders o
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY YEARWEEK(o.date_purchased, 3)
          ORDER BY date_label ASC
        `;
  }

  logger.debug({ totalRowCount: totalRows.length, granularity }, 'Trend totals fetched');

  // ------------------------------------------------------------------
  // Query 2: Per-store breakdown per date bucket
  // Raw SQL: Legacy table not in Prisma schema
  // LEFT JOIN store_management to resolve store names.
  // order_site is VARCHAR in the orders table, store_id is INT in
  // store_management, so we CAST for the join.
  // ------------------------------------------------------------------
  let breakdownRows: TrendBreakdownRow[];

  if (isDaily) {
    breakdownRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            DATE_FORMAT(DATE(o.date_purchased), '%Y-%m-%d')    AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY DATE(o.date_purchased), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `
      : await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            DATE_FORMAT(DATE(o.date_purchased), '%Y-%m-%d')    AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY DATE(o.date_purchased), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `;
  } else if (isMonthly) {
    // Monthly per-store breakdown, labeled as the first day of the month (YYYY-MM-01)
    breakdownRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            DATE_FORMAT(o.date_purchased, '%Y-%m-01')          AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY DATE_FORMAT(o.date_purchased, '%Y-%m'), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `
      : await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            DATE_FORMAT(o.date_purchased, '%Y-%m-01')          AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY DATE_FORMAT(o.date_purchased, '%Y-%m'), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `;
  } else {
    // Weekly per-store breakdown
    breakdownRows = stores && stores.length > 0
      ? await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            CONCAT(
              LPAD(FLOOR(YEARWEEK(o.date_purchased, 3) / 100), 4, '0'),
              '-W',
              LPAD(YEARWEEK(o.date_purchased, 3) % 100, 2, '0')
            )                                                  AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            AND o.order_site IN (${Prisma.join(stores)})
          GROUP BY YEARWEEK(o.date_purchased, 3), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `
      : await prisma.$queryRaw<TrendBreakdownRow[]>`
          SELECT
            CONCAT(
              LPAD(FLOOR(YEARWEEK(o.date_purchased, 3) / 100), 4, '0'),
              '-W',
              LPAD(YEARWEEK(o.date_purchased, 3) % 100, 2, '0')
            )                                                  AS date_label,
            COALESCE(sm.store_name, CONCAT('Store #', o.order_site)) AS store_name,
            COALESCE(SUM(o.order_total), 0)                    AS revenue,
            COUNT(*)                                           AS order_count
          FROM orders o
            LEFT JOIN store_management sm
              ON sm.store_id = CAST(o.order_site AS UNSIGNED)
          WHERE o.date_purchased >= ${startDate}
            AND o.date_purchased < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          GROUP BY YEARWEEK(o.date_purchased, 3), o.order_site
          ORDER BY date_label ASC, revenue DESC
        `;
  }

  logger.debug({ breakdownRowCount: breakdownRows.length }, 'Trend breakdown fetched');

  // ------------------------------------------------------------------
  // Merge totals + breakdown into TrendDataPoint[]
  // ------------------------------------------------------------------

  // Index breakdown rows by date_label for fast lookup
  const breakdownMap = new Map<string, { storeName: string; revenue: number; orderCount: number }[]>();
  for (const row of breakdownRows) {
    const label = String(row.date_label);
    if (!breakdownMap.has(label)) {
      breakdownMap.set(label, []);
    }
    breakdownMap.get(label)!.push({
      storeName: row.store_name ?? 'Unknown',
      revenue: Number(row.revenue) || 0,
      orderCount: Number(row.order_count) || 0,
    });
  }

  const dataPoints: TrendDataPoint[] = totalRows.map((row) => {
    const label = String(row.date_label);
    return {
      date: label,
      revenue: Number(row.revenue) || 0,
      orderCount: Number(row.order_count) || 0,
      breakdown: breakdownMap.get(label) ?? [],
    };
  });

  return dataPoints;
}

// ====================================================
// getTrends — main method
// ====================================================

/**
 * Fetch trend chart data for the sales dashboard.
 *
 * Returns revenue and order counts grouped by day (date range <= 90 days) or
 * by ISO week (range > 90 days), with per-store breakdown, trend insight, and
 * optional previous-period comparison.
 *
 * Raw SQL queries:
 *   - `orders` table grouped by DATE(date_purchased) or YEARWEEK(date_purchased, 3)
 *   - LEFT JOIN `store_management` on CAST(order_site AS UNSIGNED) = store_id
 *
 * Edge cases:
 * - Empty date range (no orders) -> returns empty data array with stable insight.
 * - Single day range -> 1 data point with stable direction.
 * - Store IDs filter is optional; when omitted all stores are included.
 *
 * Cache key: sd:trends:{startDate}:{endDate}:{storeIds}:{cmp|nocmp}
 * TTL: 5 minutes, grace: 2 minutes
 *
 * @param startDate       - Start date (YYYY-MM-DD, inclusive)
 * @param endDate         - End date (YYYY-MM-DD, inclusive)
 * @param stores          - Optional store IDs to filter
 * @param comparePrevious - If true, also fetch the previous equivalent period
 * @returns TrendResponse with granularity, data points, insight, and optional previousPeriod
 *
 * @taskId #165091-8
 */
export async function getTrends(
  startDate: string,
  endDate: string,
  stores?: number[],
  comparePrevious?: boolean,
  granularityOverride?: 'daily' | 'weekly' | 'monthly',
  noCache?: boolean,
): Promise<TrendResponse> {
  const logger = getLogger('sales-dashboard');

  // Determine granularity based on range length, unless the caller forces one.
  const rangeDays = daysBetween(startDate, endDate);
  const granularity: 'daily' | 'weekly' | 'monthly' =
    granularityOverride ?? (rangeDays > MAX_DAILY_RANGE_DAYS ? 'weekly' : 'daily');

  // Cache key: sd:trends:{startDate}:{endDate}:{storeIds}:{comparePrevious}:{granularity}
  // Granularity is folded into the key so an explicit override never collides
  // with a different caller's auto-selected granularity for the same range.
  const cacheKey = buildCacheKey('trends', startDate, endDate, stores ?? [], comparePrevious ? 'cmp' : 'nocmp', granularity);

  const { data } = await getCachedOrFetch<TrendResponse>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info(
        { startDate, endDate, stores, comparePrevious },
        'Fetching trend data from database',
      );

      logger.debug({ rangeDays, granularity }, 'Trend granularity determined');

      // Fetch primary period data
      const trendData = await fetchTrendData(startDate, endDate, stores, granularity);

      // Calculate insight from primary data
      const insight = calculateInsight(trendData, granularity);

      // Optionally fetch previous period for comparison overlay
      let previousPeriod: TrendDataPoint[] | undefined;
      if (comparePrevious) {
        const { prevStart, prevEnd } = getPreviousPeriodDates(startDate, endDate);

        logger.debug(
          { prevStart, prevEnd },
          'Fetching previous period trend data for comparison',
        );

        previousPeriod = await fetchTrendData(prevStart, prevEnd, stores, granularity);
      }

      const response: TrendResponse = {
        granularity,
        data: trendData,
        insight,
        ...(previousPeriod !== undefined ? { previousPeriod } : {}),
      };

      logger.info(
        {
          dataPoints: trendData.length,
          granularity,
          hasPreviousPeriod: !!previousPeriod,
          insightDirection: insight.direction,
        },
        'Trend data query completed',
      );

      return response;
    },
    noCache,
  );

  return data;
}

// ====================================================
// Inventory Health
// ====================================================

/** Cache TTL for active-stores list (30 minutes). */
const STORES_CACHE_TTL = 30 * 60;

/** Grace period for the active-stores cache (5 minutes). */
const STORES_CACHE_GRACE = 5 * 60;

/** Number of days without a sale to classify inventory as "aging". */
const AGING_THRESHOLD_DAYS = 90;

/**
 * Inventory health summary counts and paginated detail list.
 *
 * Summary is computed with a single aggregation query using conditional
 * SUM(CASE WHEN ...) across all products (grouped by product_code to
 * collapse size rows). Detail items are fetched for the selected
 * `category` with server-side pagination.
 *
 * Definitions:
 *   - **Low stock**: SUM(quantity) < SUM(minimum_quantity) AND SUM(quantity) > 0
 *   - **Out of stock**: SUM(quantity) = 0 AND SUM(minimum_quantity) > 0
 *   - **Aging**: MAX(last_sale_date) < NOW() - 90 days AND SUM(quantity) > 0
 *
 * The summary is cached (5 min TTL) because it is category-independent.
 * Detail items are NOT cached because pagination params would create too
 * many distinct cache keys with little reuse benefit.
 *
 * @param category  Which category to paginate ("low-stock" | "out-of-stock" | "aging")
 * @param page      Page number (1-based)
 * @param pageSize  Items per page
 * @returns Summary counts, paginated items, and pagination metadata
 *
 * @taskId #165091-14
 */
export async function getInventoryHealth(
  category: 'low-stock' | 'out-of-stock' | 'aging' | undefined,
  page: number = 1,
  pageSize: number = 20,
): Promise<{
  summary: InventoryHealthSummary;
  items: InventoryHealthItem[];
  pagination: PaginationMeta;
}> {
  const logger = getLogger('sales-dashboard');
  const cacheKey = buildCacheKey('inventory-health');

  // Summary is cached (category-independent); detail list is not cached
  // because pagination params would create too many cache keys.
  const { data: summary } = await getCachedOrFetch<InventoryHealthSummary>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    () => fetchInventoryHealthSummary(),
  );

  // If no category specified, return summary only (skip detail query)
  if (!category) {
    return {
      summary,
      items: [],
      pagination: { total: 0, page: 1, pageSize: 0, totalPages: 0 },
    };
  }

  // Fetch paginated detail for the selected category
  const { items, total } = await fetchInventoryHealthItems(category, page, pageSize);

  const pagination: PaginationMeta = {
    total,
    page,
    pageSize,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
  };

  logger.debug(
    { category, page, pageSize, total, summaryLow: summary.lowStock },
    'Inventory health data returned',
  );

  return { summary, items, pagination };
}

/**
 * Fetch aggregate inventory health counts using conditional sums.
 *
 * Groups product_quantities by product_code (collapsing sizes), then
 * classifies each aggregated product into low-stock, out-of-stock, or
 * aging using a single outer-level SUM(CASE WHEN ...) query.
 *
 * Raw SQL: Legacy table not in Prisma schema
 *
 * @taskId #165091-14
 */
async function fetchInventoryHealthSummary(): Promise<InventoryHealthSummary> {
  const logger = getLogger('sales-dashboard');

  // Raw SQL: Legacy table not in Prisma schema
  // Single query with conditional counts to minimise DB round-trips.
  // Inner sub-query groups by product_code, outer classifies.
  const query = `
    SELECT
      COALESCE(SUM(CASE
        WHEN total_qty < total_min_qty AND total_qty > 0 THEN 1
        ELSE 0
      END), 0) AS lowStock,
      COALESCE(SUM(CASE
        WHEN total_qty = 0 AND total_min_qty > 0 THEN 1
        ELSE 0
      END), 0) AS outOfStock,
      COALESCE(SUM(CASE
        WHEN latest_sale < DATE_SUB(NOW(), INTERVAL ${AGING_THRESHOLD_DAYS} DAY)
             AND total_qty > 0 THEN 1
        ELSE 0
      END), 0) AS agingInventory
    FROM (
      SELECT
        pl.product_code,
        SUM(pq.quantity)         AS total_qty,
        SUM(pq.minimum_quantity) AS total_min_qty,
        CASE
          WHEN MAX(pq.last_sale_date) = '0000-00-00' THEN NULL
          ELSE MAX(pq.last_sale_date)
        END                      AS latest_sale
      FROM product_quantities pq
      INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      GROUP BY pl.product_code
    ) product_agg
  `;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ lowStock: bigint; outOfStock: bigint; agingInventory: bigint }>
  >(query);

  const row = rows[0];

  const result: InventoryHealthSummary = {
    lowStock: Number(row?.lowStock ?? 0),
    outOfStock: Number(row?.outOfStock ?? 0),
    agingInventory: Number(row?.agingInventory ?? 0),
  };

  logger.debug(result, 'Inventory health summary fetched');

  return result;
}

/**
 * Fetch paginated inventory health detail items for a specific category.
 *
 * Joins product_quantities -> product_lists -> teams to resolve product
 * and team names. Aggregates by product_code (collapsing sizes) and
 * applies the category-specific HAVING filter.
 *
 * Raw SQL: Legacy table not in Prisma schema
 *
 * @taskId #165091-14
 */
async function fetchInventoryHealthItems(
  category: 'low-stock' | 'out-of-stock' | 'aging',
  page: number,
  pageSize: number,
): Promise<{ items: InventoryHealthItem[]; total: number }> {
  // Build the HAVING clause based on category
  let havingClause: string;

  switch (category) {
    case 'low-stock':
      havingClause = 'total_qty < total_min_qty AND total_qty > 0';
      break;
    case 'out-of-stock':
      havingClause = 'total_qty = 0 AND total_min_qty > 0';
      break;
    case 'aging':
      havingClause = `latest_sale < DATE_SUB(NOW(), INTERVAL ${AGING_THRESHOLD_DAYS} DAY) AND total_qty > 0`;
      break;
  }

  const offset = (page - 1) * pageSize;

  // Raw SQL: Legacy table not in Prisma schema
  // Count query for pagination total
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM (
      SELECT
        pl.product_code,
        SUM(pq.quantity)         AS total_qty,
        SUM(pq.minimum_quantity) AS total_min_qty,
        CASE
          WHEN MAX(pq.last_sale_date) = '0000-00-00' THEN NULL
          ELSE MAX(pq.last_sale_date)
        END                      AS latest_sale
      FROM product_quantities pq
      INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      GROUP BY pl.product_code
      HAVING ${havingClause}
    ) filtered
  `;

  const countResult = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(countQuery);
  const total = Number(countResult[0]?.total ?? 0);

  if (total === 0) {
    return { items: [], total: 0 };
  }

  // Raw SQL: Legacy table not in Prisma schema
  // Detail query with product_lists and teams JOIN for names.
  // ORDER BY quantity ascending so lowest-stock items appear first.
  const detailQuery = `
    SELECT
      agg.product_code      AS productCode,
      COALESCE(pl.product_name, agg.product_code) AS productName,
      t.team_name           AS teamName,
      agg.total_qty         AS quantity,
      agg.total_min_qty     AS minimumQuantity,
      agg.latest_sale       AS lastSaleDate,
      CASE
        WHEN agg.latest_sale IS NOT NULL
        THEN DATEDIFF(NOW(), agg.latest_sale)
        ELSE NULL
      END                   AS daysSinceLastSale
    FROM (
      SELECT
        pl.product_code,
        SUM(pq.quantity)         AS total_qty,
        SUM(pq.minimum_quantity) AS total_min_qty,
        CASE
          WHEN MAX(pq.last_sale_date) = '0000-00-00' THEN NULL
          ELSE MAX(pq.last_sale_date)
        END                      AS latest_sale
      FROM product_quantities pq
      INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      GROUP BY pl.product_code
      HAVING ${havingClause}
    ) agg
    LEFT JOIN product_lists pl ON pl.product_code = agg.product_code
    LEFT JOIN teams t          ON t.teams_id = pl.teams_id
    ORDER BY agg.total_qty ASC, agg.product_code ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      productCode: string;
      productName: string;
      teamName: string | null;
      quantity: number | bigint;
      minimumQuantity: number | bigint;
      lastSaleDate: Date | string | null;
      daysSinceLastSale: number | bigint | null;
    }>
  >(detailQuery);

  const items: InventoryHealthItem[] = rows.map((row) => ({
    productCode: row.productCode,
    productName: row.productName,
    teamName: row.teamName ?? null,
    quantity: Number(row.quantity),
    minimumQuantity: Number(row.minimumQuantity),
    lastSaleDate: row.lastSaleDate
      ? (row.lastSaleDate instanceof Date
          ? row.lastSaleDate.toISOString().split('T')[0]
          : String(row.lastSaleDate).split('T')[0])
      : null,
    daysSinceLastSale: row.daysSinceLastSale !== null ? Number(row.daysSinceLastSale) : null,
  }));

  return { items, total };
}

// ====================================================
// Active Stores
// ====================================================

/**
 * Retrieve the list of active stores for the dashboard filter dropdown.
 *
 * Queries `store_management` via Prisma ORM (the table IS in Prisma
 * schema as StoreManagement). Includes UKSoccershop (store_id = 0)
 * as the main store from the database.
 *
 * Result is cached for 30 minutes because the store list rarely changes.
 *
 * @returns Array of StoreInfo from active stores in store_management
 *
 * @taskId #165091-14
 */
export async function getActiveStores(): Promise<StoreInfo[]> {
  const logger = getLogger('sales-dashboard');
  const cacheKey = buildCacheKey('stores');

  const { data: stores } = await getCachedOrFetch<StoreInfo[]>(
    cacheKey,
    STORES_CACHE_TTL,
    STORES_CACHE_GRACE,
    async () => {
      const dbStores = await prisma.storeManagement.findMany({
        where: { status: '1' },
        select: {
          storeId: true,
          storeName: true,
          storePlatform: true,
        },
        orderBy: { storeName: 'asc' },
      });

      // Map DB rows to StoreInfo shape
      const storeInfoList: StoreInfo[] = dbStores.map((s) => ({
        storeId: s.storeId,
        storeName: s.storeName,
        storePlatform: s.storePlatform ?? null,
      }));

      logger.debug({ storeCount: storeInfoList.length }, 'Active stores list fetched from DB');

      return storeInfoList;
    },
  );

  return stores;
}

// ====================================================
// Sync Health — Raw SQL result types
// ====================================================

/**
 * Raw row from the Shopify store sync aggregate query.
 * @taskId #165091-15
 */
interface ShopifyStoreSyncRow {
  sm_store_id: number;
  store_name: string;
  total_active: string | number;
  pending_sync: string | number;
  failed_sync: string | number;
}

/**
 * Raw row from the Shopify out-of-sync count query.
 * @taskId #165091-15
 */
interface ShopifyOutOfSyncCountRow {
  sm_store_id: number;
  out_of_sync: string | number;
}

/**
 * Raw row from the Shopify cron run history query.
 * @taskId #165091-15
 */
interface ShopifyCronRunRow {
  sm_store_id: number;
  last_cron_run: string | Date | null;
}

/**
 * Raw row from the marketplace out-of-sync count query.
 * @taskId #165091-15
 */
interface MarketplaceOutOfSyncCountRow {
  store_id: number;
  out_of_sync: string | number;
}

/**
 * Raw row from the Shopify sync details query (paginated list).
 * @taskId #165091-15
 */
interface ShopifySyncDetailRow {
  sp_id: number;
  sp_product_code: string;
  sm_store_id: number;
  sp_status: string;
  sp_update_inventory_status: string;
  spv_option_value: string | null;
  spv_inventory_quantity: string | number | null;
  pq_quantity: string | number | null;
}

/**
 * Raw row used for total count queries.
 * @taskId #165091-15
 */
interface SyncCountRow {
  total: string | number;
}

/**
 * Raw row from the marketplace sync detail query (paginated list).
 * @taskId #165091-15
 */
interface MarketplaceSyncDetailRow {
  marketplace_listings_id: number;
  products_sku: string | null;
  store_id: number;
  marketplace_listing_status: string;
  last_sync_status: string;
  last_synced_at: string | Date | null;
  last_synced_quantity: number | null;
  pq_quantity: string | number | null;
  api_last_error_message: string | null;
  retry_count: number;
}

// ====================================================
// getSyncHealth
// ====================================================

/**
 * Fetch combined inventory sync health for all Shopify stores and
 * marketplace listing stores.
 *
 * **Shopify** (raw SQL -- legacy tables not in Prisma schema):
 *   - Per store: total active products, pending sync, failed sync, out-of-sync
 *     variant count, and latest cron run timestamp.
 *
 * **Marketplace** (Prisma ORM for basic aggregates + raw SQL for out-of-sync):
 *   - Per store: total active listings, last sync time, sync success rate,
 *     failed syncs, and out-of-sync count.
 *
 * A store is considered healthy when `failedSync === 0` AND `outOfSyncItems`
 * is less than 10% of the total product/listing count.
 *
 * Cached under `sd:sync-health` with 5 min TTL and 2 min grace.
 *
 * Edge cases:
 * - Store with no Shopify products -> empty array (not included).
 * - No cron history -> lastCronRun = null.
 * - Marketplace with all listings inactive -> still included with 0 active count.
 * - Size-level matching: if npv_size_options_value_id is NULL, that variant is
 *   skipped in the out-of-sync comparison.
 *
 * @returns Combined Shopify + marketplace sync status per store
 *
 * @taskId #165091-15
 */
export async function getSyncHealth(): Promise<SyncHealthResponse> {
  const logger = getLogger('sales-dashboard');

  const cacheKey = buildCacheKey('sync-health');

  const { data } = await getCachedOrFetch<SyncHealthResponse>(
    cacheKey,
    CACHE_TTL_SECONDS,
    CACHE_GRACE_SECONDS,
    async () => {
      logger.info('Fetching sync health from database');

      const [shopifyStatuses, marketplaceStatuses] = await Promise.all([
        fetchShopifySyncHealth(),
        fetchMarketplaceSyncHealth(),
      ]);

      logger.info(
        {
          shopifyStores: shopifyStatuses.length,
          marketplaceStores: marketplaceStatuses.length,
        },
        'Sync health query completed',
      );

      return {
        shopify: shopifyStatuses,
        marketplace: marketplaceStatuses,
      };
    },
  );

  return data;
}

/**
 * Fetch Shopify sync health data for all stores.
 *
 * Executes three parallel raw SQL queries:
 * 1. Per-store counts of active, pending, and failed products
 * 2. Per-store out-of-sync variant count (spv_inventory_quantity vs pq quantity)
 * 3. Per-store latest cron run from shopify_cron_run_history
 *
 * Join chain for out-of-sync check:
 *   shopify_products (sp.np_products_id)
 *     -> products (products_id)
 *       -> product_lists (products_model = product_code)
 *         -> product_quantities (product_lists_id, size_id)
 *   Size matching via new_products_variations:
 *     npv_products_id = sp.np_products_id
 *     npv_size_options_value_id = pq.size_id
 *
 * @taskId #165091-15
 */
async function fetchShopifySyncHealth(): Promise<ShopifySyncStatus[]> {
  const logger = getLogger('sales-dashboard');

  // Raw SQL: Legacy table not in Prisma schema
  // Query 1: Per-store aggregate counts of active, pending sync, and failed sync products
  const storeCountsPromise = prisma.$queryRaw<ShopifyStoreSyncRow[]>`
    SELECT
      sp.sm_store_id,
      COALESCE(sm.store_name, CONCAT('Store #', sp.sm_store_id)) AS store_name,
      SUM(CASE WHEN sp.sp_status = 'active' THEN 1 ELSE 0 END)                    AS total_active,
      SUM(CASE WHEN sp.sp_update_inventory_status = 'modified' THEN 1 ELSE 0 END)  AS pending_sync,
      SUM(CASE WHEN sp.sp_update_inventory_status = 'error' THEN 1 ELSE 0 END)     AS failed_sync
    FROM shopify_products sp
    LEFT JOIN store_management sm ON sp.sm_store_id = sm.store_id
    GROUP BY sp.sm_store_id, sm.store_name
  `;

  // Raw SQL: Legacy table not in Prisma schema
  // Query 2: Per-store out-of-sync count.
  // A variant is out-of-sync when its Shopify quantity does not match
  // the actual warehouse quantity in product_quantities.
  // Join chain:
  //   shopify_products sp -> shopify_products_variations spv (sp_id)
  //   sp.np_products_id -> products p (products_id)
  //   p.products_model -> product_lists pl (product_code)
  //   pl.product_lists_id -> product_quantities pq (product_lists_id)
  //   Size matching: new_products_variations npv joins sp.np_products_id
  //     and provides npv_size_options_value_id = pq.size_id
  const outOfSyncPromise = prisma.$queryRaw<ShopifyOutOfSyncCountRow[]>`
    SELECT
      sp.sm_store_id,
      COUNT(*) AS out_of_sync
    FROM shopify_products sp
    INNER JOIN shopify_products_variations spv ON spv.sp_id = sp.sp_id
    INNER JOIN products p ON sp.np_products_id = p.products_id
    INNER JOIN product_lists pl ON p.products_model = pl.product_code
    INNER JOIN new_products_variations npv
      ON npv.npv_products_id = sp.np_products_id
      AND npv.npv_size_options_value_id IS NOT NULL
    INNER JOIN product_quantities pq
      ON pq.product_lists_id = pl.product_lists_id
      AND pq.size_id = npv.npv_size_options_value_id
    WHERE sp.sp_status = 'active'
      AND spv.spv_inventory_quantity != pq.quantity
    GROUP BY sp.sm_store_id
  `;

  // Raw SQL: Legacy table not in Prisma schema
  // Query 3: Latest cron run per store from shopify_cron_run_history
  const cronRunPromise = prisma.$queryRaw<ShopifyCronRunRow[]>`
    SELECT
      scrh.scrh_store_id AS sm_store_id,
      MAX(scrh.scrh_end_time) AS last_cron_run
    FROM shopify_cron_run_history scrh
    WHERE scrh.scrh_status = 'completed'
    GROUP BY scrh.scrh_store_id
  `;

  const [storeCounts, outOfSyncRows, cronRuns] = await Promise.all([
    storeCountsPromise,
    outOfSyncPromise,
    cronRunPromise,
  ]);

  // Build lookup maps for out-of-sync counts and cron run data
  const outOfSyncMap = new Map<number, number>();
  for (const row of outOfSyncRows) {
    outOfSyncMap.set(Number(row.sm_store_id), Number(row.out_of_sync) || 0);
  }

  const cronMap = new Map<number, string | null>();
  for (const row of cronRuns) {
    const cronDate = row.last_cron_run;
    cronMap.set(
      Number(row.sm_store_id),
      cronDate ? new Date(cronDate as string | Date).toISOString() : null,
    );
  }

  // Combine into ShopifySyncStatus[]
  const result: ShopifySyncStatus[] = storeCounts.map((row) => {
    const storeId = Number(row.sm_store_id);
    const totalActive = Number(row.total_active) || 0;
    const failedSync = Number(row.failed_sync) || 0;
    const outOfSyncItems = outOfSyncMap.get(storeId) ?? 0;

    // isHealthy: no failed syncs AND out-of-sync items < 10% of total active
    const isHealthy =
      failedSync === 0 &&
      (totalActive === 0 || outOfSyncItems < totalActive * 0.1);

    return {
      storeId,
      storeName: row.store_name,
      totalActiveProducts: totalActive,
      pendingSync: Number(row.pending_sync) || 0,
      failedSync,
      outOfSyncItems,
      lastCronRun: cronMap.get(storeId) ?? null,
      isHealthy,
    };
  });

  logger.debug(
    { storeCount: result.length },
    'Shopify sync health assembled',
  );

  return result;
}

/**
 * Fetch marketplace listing sync health data for all stores.
 *
 * Uses Prisma ORM for the basic aggregate counts (marketplace_listings IS in
 * the Prisma schema) and a raw SQL query for the out-of-sync count (because
 * product_quantities is a legacy table not in the schema).
 *
 * Join chain for out-of-sync:
 *   marketplace_listings (products_sku)
 *     -> new_products_variations (npv_products_sku)
 *       -> products (npv_products_id = products_id)
 *         -> product_lists (products_model = product_code)
 *           -> product_quantities (product_lists_id, size_id matched via npv)
 *
 * @taskId #165091-15
 */
async function fetchMarketplaceSyncHealth(): Promise<MarketplaceSyncStatus[]> {
  const logger = getLogger('sales-dashboard');

  // Prisma ORM: Aggregate marketplace listings per store
  const storeAggregates = await prisma.marketplaceListing.groupBy({
    by: ['storeId'],
    _count: {
      marketplaceListingsId: true,
    },
    _max: {
      lastSyncedAt: true,
    },
  });

  const storeIds = storeAggregates.map((s) => s.storeId);

  if (storeIds.length === 0) {
    logger.debug('No marketplace listing stores found');
    return [];
  }

  // Parallel queries for per-store detailed counts
  const [activeCounts, successCounts, failedCounts, outOfSyncRows, storeNames] =
    await Promise.all([
      // Prisma ORM: Active listings per store
      prisma.marketplaceListing.groupBy({
        by: ['storeId'],
        where: { marketplaceListingStatus: 'active' },
        _count: { marketplaceListingsId: true },
      }),

      // Prisma ORM: Successful syncs per store
      prisma.marketplaceListing.groupBy({
        by: ['storeId'],
        where: { lastSyncStatus: 'success' },
        _count: { marketplaceListingsId: true },
      }),

      // Prisma ORM: Failed syncs per store
      prisma.marketplaceListing.groupBy({
        by: ['storeId'],
        where: { lastSyncStatus: 'failed' },
        _count: { marketplaceListingsId: true },
      }),

      // Raw SQL: Legacy table not in Prisma schema (product_quantities)
      // Out-of-sync: marketplace last_synced_quantity != product_quantities.quantity
      // Join via products_sku -> new_products_variations -> products -> product_lists -> product_quantities
      prisma.$queryRaw<MarketplaceOutOfSyncCountRow[]>`
        SELECT
          ml.store_id,
          COUNT(*) AS out_of_sync
        FROM marketplace_listings ml
        INNER JOIN new_products_variations npv
          ON ml.products_sku = npv.npv_products_sku
        INNER JOIN products p
          ON npv.npv_products_id = p.products_id
        INNER JOIN product_lists pl
          ON p.products_model = pl.product_code
        INNER JOIN product_quantities pq
          ON pq.product_lists_id = pl.product_lists_id
          AND pq.size_id = npv.npv_size_options_value_id
        WHERE ml.marketplace_listing_status = 'active'
          AND ml.last_synced_quantity IS NOT NULL
          AND ml.last_synced_quantity != pq.quantity
          AND npv.npv_size_options_value_id IS NOT NULL
        GROUP BY ml.store_id
      `,

      // Prisma ORM: Store names from store_management
      prisma.storeManagement.findMany({
        where: { storeId: { in: storeIds } },
        select: { storeId: true, storeName: true },
      }),
    ]);

  // Build lookup maps
  const activeMap = new Map<number, number>();
  for (const row of activeCounts) {
    activeMap.set(row.storeId, row._count.marketplaceListingsId);
  }

  const successMap = new Map<number, number>();
  for (const row of successCounts) {
    successMap.set(row.storeId, row._count.marketplaceListingsId);
  }

  const failedMap = new Map<number, number>();
  for (const row of failedCounts) {
    failedMap.set(row.storeId, row._count.marketplaceListingsId);
  }

  const outOfSyncMap = new Map<number, number>();
  for (const row of outOfSyncRows) {
    outOfSyncMap.set(Number(row.store_id), Number(row.out_of_sync) || 0);
  }

  const nameMap = new Map<number, string>();
  for (const s of storeNames) {
    nameMap.set(s.storeId, s.storeName);
  }

  // Assemble MarketplaceSyncStatus[]
  const result: MarketplaceSyncStatus[] = storeAggregates.map((agg) => {
    const storeId = agg.storeId;
    const totalListings = agg._count.marketplaceListingsId;
    const totalActive = activeMap.get(storeId) ?? 0;
    const successCount = successMap.get(storeId) ?? 0;
    const failedSyncs = failedMap.get(storeId) ?? 0;
    const outOfSyncItems = outOfSyncMap.get(storeId) ?? 0;

    // Sync success rate: % of all listings with last_sync_status='success'
    const syncSuccessRate =
      totalListings > 0
        ? Math.round((successCount / totalListings) * 10000) / 100
        : 0;

    const lastSyncTime = agg._max.lastSyncedAt
      ? new Date(agg._max.lastSyncedAt).toISOString()
      : null;

    // isHealthy: no failed syncs AND out-of-sync items < 10% of total active
    const isHealthy =
      failedSyncs === 0 &&
      (totalActive === 0 || outOfSyncItems < totalActive * 0.1);

    return {
      storeId,
      storeName: nameMap.get(storeId) ?? `Store #${storeId}`,
      totalActiveListings: totalActive,
      lastSyncTime,
      syncSuccessRate,
      failedSyncs,
      outOfSyncItems,
      isHealthy,
    };
  });

  logger.debug(
    { storeCount: result.length },
    'Marketplace sync health assembled',
  );

  return result;
}

// ====================================================
// getSyncDetails
// ====================================================

/**
 * Paginated detail view of sync issues for a specific store.
 *
 * - **Shopify (type='shopify')**: Lists products with `sp_update_inventory_status`
 *   = 'modified' or 'error', plus out-of-sync variants. Paginated.
 * - **Marketplace (type='marketplace')**: Lists items with `last_sync_status`
 *   = 'failed' or out-of-sync quantities. Includes `api_last_error_message`.
 *   Paginated.
 *
 * Not cached -- sync detail is always real-time for operational accuracy.
 *
 * Edge cases:
 * - Store with no sync issues -> returns empty items array, total = 0.
 * - Variant with unresolvable size (npv_size_options_value_id IS NULL) -> skipped.
 * - Marketplace listing with NULL last_synced_quantity -> not included in out-of-sync.
 *
 * @param storeId  - The store ID to fetch details for
 * @param type     - 'shopify' or 'marketplace'
 * @param page     - Page number (1-based)
 * @param pageSize - Items per page
 * @returns Paginated array of detail rows with total count
 *
 * @taskId #165091-15
 */
export async function getSyncDetails(
  storeId: number,
  type: 'shopify' | 'marketplace',
  page: number = 1,
  pageSize: number = 20,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const logger = getLogger('sales-dashboard');

  logger.info({ storeId, type, page, pageSize }, 'Fetching sync details');

  const offset = (page - 1) * pageSize;

  if (type === 'shopify') {
    return fetchShopifySyncDetails(storeId, offset, pageSize, page);
  }

  return fetchMarketplaceSyncDetails(storeId, offset, pageSize, page);
}

/**
 * Fetch paginated Shopify sync detail rows for a specific store.
 *
 * Returns products with sync issues via UNION of two result sets:
 * 1. Products where sp_update_inventory_status = 'modified' or 'error'
 * 2. Active product variants where spv_inventory_quantity != pq.quantity
 *
 * @taskId #165091-15
 */
async function fetchShopifySyncDetails(
  storeId: number,
  offset: number,
  pageSize: number,
  page: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const logger = getLogger('sales-dashboard');

  // Raw SQL: Legacy table not in Prisma schema
  // Fetch products that have sync issues: modified/error status OR out-of-sync variants.
  // We use UNION ALL to combine status-based issues with quantity-mismatch issues,
  // then paginate the combined result set.
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<ShopifySyncDetailRow[]>`
      SELECT sub.* FROM (
        SELECT
          sp.sp_id,
          sp.sp_product_code,
          sp.sm_store_id,
          sp.sp_status,
          sp.sp_update_inventory_status,
          NULL AS spv_option_value,
          NULL AS spv_inventory_quantity,
          NULL AS pq_quantity
        FROM shopify_products sp
        WHERE sp.sm_store_id = ${storeId}
          AND sp.sp_update_inventory_status IN ('modified', 'error')

        UNION ALL

        SELECT
          sp.sp_id,
          sp.sp_product_code,
          sp.sm_store_id,
          sp.sp_status,
          'out_of_sync' AS sp_update_inventory_status,
          spv.spv_option_value,
          spv.spv_inventory_quantity,
          pq.quantity AS pq_quantity
        FROM shopify_products sp
        INNER JOIN shopify_products_variations spv ON spv.sp_id = sp.sp_id
        INNER JOIN products p ON sp.np_products_id = p.products_id
        INNER JOIN product_lists pl ON p.products_model = pl.product_code
        INNER JOIN new_products_variations npv
          ON npv.npv_products_id = sp.np_products_id
          AND npv.npv_size_options_value_id IS NOT NULL
        INNER JOIN product_quantities pq
          ON pq.product_lists_id = pl.product_lists_id
          AND pq.size_id = npv.npv_size_options_value_id
        WHERE sp.sm_store_id = ${storeId}
          AND sp.sp_status = 'active'
          AND spv.spv_inventory_quantity != pq.quantity
      ) sub
      ORDER BY sub.sp_update_inventory_status, sub.sp_product_code
      LIMIT ${pageSize} OFFSET ${offset}
    `,

    // Raw SQL: Legacy table not in Prisma schema
    // Total count for pagination (sum of both UNION parts)
    prisma.$queryRaw<SyncCountRow[]>`
      SELECT (
        (SELECT COUNT(*)
         FROM shopify_products sp
         WHERE sp.sm_store_id = ${storeId}
           AND sp.sp_update_inventory_status IN ('modified', 'error'))
        +
        (SELECT COUNT(*)
         FROM shopify_products sp
         INNER JOIN shopify_products_variations spv ON spv.sp_id = sp.sp_id
         INNER JOIN products p ON sp.np_products_id = p.products_id
         INNER JOIN product_lists pl ON p.products_model = pl.product_code
         INNER JOIN new_products_variations npv
           ON npv.npv_products_id = sp.np_products_id
           AND npv.npv_size_options_value_id IS NOT NULL
         INNER JOIN product_quantities pq
           ON pq.product_lists_id = pl.product_lists_id
           AND pq.size_id = npv.npv_size_options_value_id
         WHERE sp.sm_store_id = ${storeId}
           AND sp.sp_status = 'active'
           AND spv.spv_inventory_quantity != pq.quantity)
      ) AS total
    `,
  ]);

  const total = Number(countRows[0]?.total) || 0;

  const items: Record<string, unknown>[] = rows.map((row) => ({
    spId: Number(row.sp_id),
    productCode: row.sp_product_code,
    status: row.sp_status,
    syncStatus: row.sp_update_inventory_status,
    variantOption: row.spv_option_value ?? null,
    shopifyQuantity:
      row.spv_inventory_quantity != null ? Number(row.spv_inventory_quantity) : null,
    actualQuantity:
      row.pq_quantity != null ? Number(row.pq_quantity) : null,
    difference:
      row.spv_inventory_quantity != null && row.pq_quantity != null
        ? Number(row.spv_inventory_quantity) - Number(row.pq_quantity)
        : null,
  }));

  logger.info(
    { storeId, type: 'shopify', total, returned: items.length, page },
    'Shopify sync details fetched',
  );

  return { items, total, page, pageSize };
}

/**
 * Fetch paginated marketplace sync detail rows for a specific store.
 *
 * Returns listings with sync issues via UNION of two result sets:
 * 1. Listings where last_sync_status = 'failed'
 * 2. Active listings where last_synced_quantity != product_quantities.quantity
 *
 * Includes api_last_error_message for failed items, enabling grouping by
 * error message on the frontend (Req 6.5).
 *
 * @taskId #165091-15
 */
async function fetchMarketplaceSyncDetails(
  storeId: number,
  offset: number,
  pageSize: number,
  page: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const logger = getLogger('sales-dashboard');

  // Raw SQL: Legacy table not in Prisma schema (product_quantities)
  // We use raw SQL because we need to join marketplace_listings with
  // product_quantities (legacy table) for out-of-sync detection.
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<MarketplaceSyncDetailRow[]>`
      SELECT sub.* FROM (
        SELECT
          ml.marketplace_listings_id,
          ml.products_sku,
          ml.store_id,
          ml.marketplace_listing_status,
          ml.last_sync_status,
          ml.last_synced_at,
          ml.last_synced_quantity,
          NULL AS pq_quantity,
          ml.api_last_error_message,
          ml.retry_count
        FROM marketplace_listings ml
        WHERE ml.store_id = ${storeId}
          AND ml.last_sync_status = 'failed'

        UNION ALL

        SELECT
          ml.marketplace_listings_id,
          ml.products_sku,
          ml.store_id,
          ml.marketplace_listing_status,
          'out_of_sync' AS last_sync_status,
          ml.last_synced_at,
          ml.last_synced_quantity,
          pq.quantity AS pq_quantity,
          ml.api_last_error_message,
          ml.retry_count
        FROM marketplace_listings ml
        INNER JOIN new_products_variations npv
          ON ml.products_sku = npv.npv_products_sku
        INNER JOIN products p
          ON npv.npv_products_id = p.products_id
        INNER JOIN product_lists pl
          ON p.products_model = pl.product_code
        INNER JOIN product_quantities pq
          ON pq.product_lists_id = pl.product_lists_id
          AND pq.size_id = npv.npv_size_options_value_id
        WHERE ml.store_id = ${storeId}
          AND ml.marketplace_listing_status = 'active'
          AND ml.last_synced_quantity IS NOT NULL
          AND ml.last_synced_quantity != pq.quantity
          AND npv.npv_size_options_value_id IS NOT NULL
      ) sub
      ORDER BY sub.last_sync_status, sub.products_sku
      LIMIT ${pageSize} OFFSET ${offset}
    `,

    // Raw SQL: Legacy table not in Prisma schema (product_quantities)
    // Total count for pagination (sum of both UNION parts)
    prisma.$queryRaw<SyncCountRow[]>`
      SELECT (
        (SELECT COUNT(*)
         FROM marketplace_listings ml
         WHERE ml.store_id = ${storeId}
           AND ml.last_sync_status = 'failed')
        +
        (SELECT COUNT(*)
         FROM marketplace_listings ml
         INNER JOIN new_products_variations npv
           ON ml.products_sku = npv.npv_products_sku
         INNER JOIN products p
           ON npv.npv_products_id = p.products_id
         INNER JOIN product_lists pl
           ON p.products_model = pl.product_code
         INNER JOIN product_quantities pq
           ON pq.product_lists_id = pl.product_lists_id
           AND pq.size_id = npv.npv_size_options_value_id
         WHERE ml.store_id = ${storeId}
           AND ml.marketplace_listing_status = 'active'
           AND ml.last_synced_quantity IS NOT NULL
           AND ml.last_synced_quantity != pq.quantity
           AND npv.npv_size_options_value_id IS NOT NULL)
      ) AS total
    `,
  ]);

  const total = Number(countRows[0]?.total) || 0;

  const items: Record<string, unknown>[] = rows.map((row) => ({
    listingId: Number(row.marketplace_listings_id),
    productSku: row.products_sku ?? '',
    listingStatus: row.marketplace_listing_status,
    syncStatus: row.last_sync_status,
    lastSyncedAt: row.last_synced_at
      ? new Date(row.last_synced_at as string | Date).toISOString()
      : null,
    lastSyncedQuantity:
      row.last_synced_quantity != null ? Number(row.last_synced_quantity) : null,
    actualQuantity:
      row.pq_quantity != null ? Number(row.pq_quantity) : null,
    difference:
      row.last_synced_quantity != null && row.pq_quantity != null
        ? Number(row.last_synced_quantity) - Number(row.pq_quantity)
        : null,
    errorMessage: row.api_last_error_message ?? null,
    retryCount: Number(row.retry_count) || 0,
  }));

  logger.info(
    { storeId, type: 'marketplace', total, returned: items.length, page },
    'Marketplace sync details fetched',
  );

  return { items, total, page, pageSize };
}
