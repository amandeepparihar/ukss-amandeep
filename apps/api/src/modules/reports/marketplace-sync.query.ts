/**
 * Marketplace Sync Performance — read-only monitoring queries.
 *
 * Powers the "Marketplace Sync Performance" tab of the Sales Performance report.
 * Everything here reads the shared MySQL `marketplace_listings` table (the LIVE
 * sync table — NOT the abandoned `jsa_marketplacelisting` shell) via the Prisma
 * MySQL client. No schema changes: the table stores only the *current* state of
 * each listing (last-write-wins `last_synced_at`), so the daily buckets below
 * count "SKUs whose LAST successful sync fell on that day", not per-day sync
 * throughput. See the component tooltip + caveat banner for the user-facing note.
 */

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import type {
  MarketplaceSyncPerfRow,
  MarketplaceSyncPerformanceResponse,
} from '@admin/shared';

/**
 * A listing is treated as "stuck" once its consecutive-failure counter reaches
 * the default max-retries (3). There is NO automatic reset job — these stay
 * stuck until a human investigates the error and fixes it, so they are the most
 * important thing the BA needs surfaced.
 */
export const STUCK_THRESHOLD = 3;

/** MySQL `SUM(bool)`/`COUNT` return Decimal/BigInt — coerce to JS number. */
const num = (v: unknown): number => Number((v as number | bigint | string) ?? 0);

interface AggRow {
  store_id: number;
  store_name: string | null;
  total: unknown;
  live: unknown;
  success_total: unknown;
  failed_total: unknown;
  pending_total: unknown;
  retrying_total: unknown;
  stuck_total: unknown;
  oversell_risk: unknown;
  synced_today: unknown;
  synced_yesterday: unknown;
  synced_day_before: unknown;
  synced_last_3_days: unknown;
  last_sync_time: Date | string | null;
}

interface ErrorRow {
  store_id: number;
  code: string | null;
  message: string | null;
  cnt: unknown;
}

/**
 * Per-marketplace aggregate. "live" = active + confirmed because eBay/Debenhams
 * listings carry status 'confirmed' while OnBuy/Allegro/Seller-Dynamics use
 * 'active' — counting only 'active' would wrongly show eBay/Debenhams as 0.
 */
const AGG_SQL = `
  SELECT
    ml.store_id,
    sm.store_name,
    COUNT(*)                                                                                  AS total,
    SUM(ml.marketplace_listing_status IN ('active','confirmed'))                              AS live,
    SUM(ml.last_sync_status = 'success')                                                      AS success_total,
    SUM(ml.last_sync_status = 'failed')                                                       AS failed_total,
    SUM(ml.last_sync_status = 'pending')                                                      AS pending_total,
    SUM(ml.last_sync_status = 'retrying')                                                     AS retrying_total,
    SUM(ml.retry_count >= ${STUCK_THRESHOLD})                                                 AS stuck_total,
    -- Generic, REACTIVE oversell signal for most marketplaces: a push that the
    -- marketplace rejected for negative stock. eBay never trips this, so the eBay
    -- row's oversellRisk is overridden below with a PROACTIVE measure (EBAY_OVERSELL_SQL).
    SUM(ml.last_sync_status = 'failed' AND ml.api_last_error_code = 'VALIDATION_NEGATIVE_STOCK') AS oversell_risk,
    SUM(ml.last_sync_status = 'success' AND DATE(ml.last_synced_at) = CURDATE())                          AS synced_today,
    SUM(ml.last_sync_status = 'success' AND DATE(ml.last_synced_at) = CURDATE() - INTERVAL 1 DAY)         AS synced_yesterday,
    SUM(ml.last_sync_status = 'success' AND DATE(ml.last_synced_at) = CURDATE() - INTERVAL 2 DAY)         AS synced_day_before,
    SUM(ml.last_sync_status = 'success' AND ml.last_synced_at >= CURDATE() - INTERVAL 2 DAY)              AS synced_last_3_days,
    MAX(ml.last_synced_at)                                                                    AS last_sync_time
  FROM marketplace_listings ml
  LEFT JOIN store_management sm ON sm.store_id = ml.store_id
  GROUP BY ml.store_id, sm.store_name
  ORDER BY total DESC
`;

/**
 * Failed listings grouped by API error code, for the BA to triage/fix.
 *
 * Also surfaces a representative human-readable message per code, taken from the
 * marketplace's own error text already stored in `api_last_error_message` (eBay
 * ShortMessage, Mirakl/Seller-Dynamics message, etc.) — NOT a hardcoded code→text
 * table. The stored text is wrapped by the shared sync writer as
 * `[<MARKETPLACE>_BATCH/SYNC_…] <message>` and may append a LongMessage after
 * ` : `; we strip the correlation prefix and keep the short part so the same
 * cleanup works for every marketplace. `MAX()` picks one stable representative
 * (the per-listing prefix differs but the cleaned text is identical per code).
 */
const ERROR_SQL = `
  SELECT
    ml.store_id,
    ml.api_last_error_code AS code,
    COUNT(*) AS cnt,
    MAX(LEFT(TRIM(
      SUBSTRING_INDEX(
        REGEXP_REPLACE(ml.api_last_error_message, '^\\\\[[^]]*\\\\] *', ''),
        ' : ', 1
      )
    ), 300)) AS message
  FROM marketplace_listings ml
  WHERE ml.last_sync_status = 'failed' AND ml.api_last_error_code IS NOT NULL
  GROUP BY ml.store_id, ml.api_last_error_code
`;

/** How many distinct error codes to surface per marketplace. */
const TOP_ERRORS_PER_STORE = 6;

/**
 * PROACTIVE eBay oversell risk — listings LIVE and buyable on eBay
 * (`last_synced_quantity > 0`) whose rule-derived target quantity is 0, i.e. items
 * that should already be delisted but are still advertising stock. Unlike the
 * generic `VALIDATION_NEGATIVE_STOCK` signal (which is reactive and never fires for
 * eBay), this catches the exposure BEFORE an order is taken.
 *
 * The "target = 0" conditions MUST mirror the eBay quantity arms in
 * `marketplace-sync.query.ts` (`ebayQuantityArms`) — keep them in sync:
 *   - t-shirts (virtual_product_type_id = 4) are POD and legitimately stay at qty 1 -> excluded.
 *   - npv_delete_status = '1'  (variant retired) -> must be 0.
 *   - npv_always_in_stock = 'Yes'  (not real stock) -> must be 0.
 *   - fc_product_id IS NULL or 0  (no FC product = cannot ship; refs #166187) -> must be 0.
 *   - non-bestseller (np_best_seller_lifetime NULL/<=0)  (listing-count cap) -> must be 0.
 *   - npv_quantities <= 0  (sold out but still advertising stock) -> the textbook oversell.
 *
 * eBay's quantity cap is 1, so last_synced_quantity is 0 or 1; any non-t-shirt above
 * with last_synced_quantity > 0 is advertising stock it should not. (If the cap ever
 * exceeds 1, this becomes a lower bound — extend to last_synced_quantity > rule_target.)
 *
 * Collation-safe join: marketplace_listings.products_sku is utf8mb4 but
 * new_products_variations.npv_products_sku is latin1, so CONVERT(... USING latin1)
 * is required or the join full-scans/times out.
 *
 * `?` placeholder: eBay store_id.
 */
const EBAY_OVERSELL_SQL = `
  SELECT COUNT(*) AS oversell_risk
  FROM marketplace_listings ml
  INNER JOIN new_products_variations npv
    ON npv.npv_products_sku = CONVERT(ml.products_sku USING latin1)
  INNER JOIN new_products np
    ON np.products_id = ml.products_id
  WHERE ml.store_id = ?
    AND ml.marketplace_listing_status IN ('active','confirmed')
    AND ml.last_synced_quantity > 0
    AND np.virtual_product_type_id <> 4
    AND (
          npv.npv_delete_status = '1'
          OR npv.npv_always_in_stock = 'Yes'
          OR npv.fc_product_id IS NULL OR npv.fc_product_id = 0
          OR np.np_best_seller_lifetime IS NULL OR np.np_best_seller_lifetime <= 0
          OR npv.npv_quantities <= 0
        )
`;

/**
 * Assemble the full Marketplace Sync Performance payload from the two queries.
 * `generatedAt` is stamped by the route handler (kept out of the cached/raw
 * layer) so the value reflects the actual request time.
 */
export async function getMarketplaceSyncPerformance(
  generatedAt: string,
): Promise<MarketplaceSyncPerformanceResponse> {
  const ebayStoreId = config.EBAY_STORE_ID;
  const [aggRows, errorRows, ebayOversellRows] = await Promise.all([
    prisma.$queryRawUnsafe<AggRow[]>(AGG_SQL),
    prisma.$queryRawUnsafe<ErrorRow[]>(ERROR_SQL),
    prisma.$queryRawUnsafe<{ oversell_risk: unknown }[]>(EBAY_OVERSELL_SQL, ebayStoreId),
  ]);
  // eBay's reactive negative-stock count is always ~0; replace it with the proactive
  // measure (live listings advertising stock the rules say should be 0).
  const ebayOversellRisk = num(ebayOversellRows[0]?.oversell_risk);

  // Group error codes by store, descending by count, capped per store.
  const errorsByStore = new Map<number, { code: string; message: string; count: number }[]>();
  for (const r of errorRows) {
    if (!r.code) continue;
    const list = errorsByStore.get(r.store_id) ?? [];
    list.push({ code: r.code, message: r.message ?? '', count: num(r.cnt) });
    errorsByStore.set(r.store_id, list);
  }
  for (const list of errorsByStore.values()) {
    list.sort((a, b) => b.count - a.count);
  }

  const rows: MarketplaceSyncPerfRow[] = aggRows.map((r) => {
    const total = num(r.total);
    const successTotal = num(r.success_total);
    return {
      storeId: r.store_id,
      storeName: r.store_name ?? `Store #${r.store_id}`,
      total,
      live: num(r.live),
      successTotal,
      failedTotal: num(r.failed_total),
      pendingTotal: num(r.pending_total),
      retryingTotal: num(r.retrying_total),
      stuckTotal: num(r.stuck_total),
      oversellRisk: r.store_id === ebayStoreId ? ebayOversellRisk : num(r.oversell_risk),
      syncedToday: num(r.synced_today),
      syncedYesterday: num(r.synced_yesterday),
      syncedDayBefore: num(r.synced_day_before),
      syncedLast3Days: num(r.synced_last_3_days),
      successRate: total > 0 ? Math.round((successTotal / total) * 1000) / 10 : 0,
      lastSyncTime: r.last_sync_time ? new Date(r.last_sync_time).toISOString() : null,
      topErrors: (errorsByStore.get(r.store_id) ?? []).slice(0, TOP_ERRORS_PER_STORE),
    };
  });

  return { generatedAt, stuckThreshold: STUCK_THRESHOLD, rows };
}

export async function resetFailedMarketplaceListings(storeId: number): Promise<{ storeId: number; resetCount: number }> {
  const resetCount = await prisma.$executeRaw`
    UPDATE marketplace_listings
    SET last_sync_status = 'pending',
        retry_count = 0,
        api_last_error_code = '',
        api_last_error_message = ''
    WHERE store_id = ${storeId}
      AND last_sync_status = 'failed'
  `;

  return { storeId, resetCount: num(resetCount) };
}
