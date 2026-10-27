/**
 * Shopify Sync Performance — read-only monitoring over the append-only
 * `shopify_tracking_history` event log. Pure helpers here; DB calls in
 * getShopifySyncPerformance (added in Task 3). All aggregates coerced to JS
 * numbers (MySQL returns BigInt/Decimal).
 */
import { prisma } from '../../lib/prisma';
import type { ShopifySyncPerformanceResponse } from '@admin/shared';
import type {
  ShopifySyncPerfRow,
  ShopifySyncType,
  ShopifySyncErrorBucket,
  ShopifySyncErrorBucketKey,
  ShopifySyncTrendPoint,
  ShopifySyncTypeBreakdown,
} from '@admin/shared';

/** No run within this many minutes ⇒ stale (cron may be dead). Heuristic: some
 * stores sync hourly, so 120 avoids false alarms while still catching a dead cron. */
export const STALE_THRESHOLD_MINUTES = 120;
export const TREND_HOURS = 48;
export const TOP_BUCKETS = 4;

const num = (v: unknown): number => Number((v as number | bigint | string) ?? 0);

const BUCKET_LABELS: Record<ShopifySyncErrorBucketKey, string> = {
  could_not_be_found: 'Inventory item not found (poison/deleted product)',
  invalid_location: 'Invalid/empty Shopify location id',
  throttled: 'Throttled / rate-limited (self-heals)',
  other: 'Other',
};

export function classifyMessage(msg: string): ShopifySyncErrorBucketKey {
  const m = (msg || '').toLowerCase();
  if (m.includes('could not be found')) return 'could_not_be_found';
  if (m.includes("gid://shopify/location/'") || m.includes('invalid global id')) return 'invalid_location';
  if (m.includes('throttled') || m.includes('429')) return 'throttled';
  return 'other';
}

export interface StoreRaw { store_id: number; store_name: string | null }
export interface AggRaw {
  store_id: number; sth_update_type: ShopifySyncType;
  sth_status: 'success' | 'failure'; cnt: unknown; max_at: Date | string | null;
}
export interface DistinctRaw { store_id: number; distinct_failing_items: unknown }
export interface OnsetRaw { store_id: number; failing_since: Date | string | null }
export interface BucketRaw { store_id: number; sth_message: string | null; cnt: unknown }
export interface TrendRaw { store_id: number; hr: string; fails: unknown; oks: unknown }

export interface AssembleInput {
  now: Date;
  windowHours: number;
  stores: StoreRaw[];
  agg: AggRaw[];
  distinct: DistinctRaw[];
  onset: OnsetRaw[];
  buckets: BucketRaw[];
  trend: TrendRaw[];
}

/**
 * Parse a DB datetime value as UTC. MySQL DATETIME columns are timezone-naive
 * and stored in UTC. Prisma returns them as Date objects (already UTC), but
 * string representations (e.g. '2026-06-19 17:58:00') must be treated as UTC
 * rather than local time to avoid timezone-shift errors on non-UTC hosts.
 */
const parseUtc = (v: Date | string | null): number | null => {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  // Replace space separator with 'T' and append 'Z' to force UTC interpretation.
  return new Date(v.replace(' ', 'T') + 'Z').getTime();
};

/**
 * Convert a DB datetime value to ISO string for display.
 * Reuses parseUtc to ensure consistent timezone handling for both Date objects
 * and bare datetime strings, avoiding timezone-shift errors on non-UTC hosts.
 */
const iso = (v: Date | string | null): string | null => {
  const ms = parseUtc(v);
  return ms === null ? null : new Date(ms).toISOString();
};

export function assembleRows(input: AssembleInput): ShopifySyncPerfRow[] {
  const { now, windowHours /* passed through for response, not used for filtering here; DB queries in Task 3 apply the window */, stores, agg, distinct, onset, buckets, trend } = input;

  const distinctByStore = new Map(distinct.map((d) => [d.store_id, num(d.distinct_failing_items)]));
  const onsetByStore = new Map(onset.map((o) => [o.store_id, iso(o.failing_since)]));

  // Per-store: type breakdown + totals + last run.
  const aggByStore = new Map<number, AggRaw[]>();
  for (const a of agg) {
    const list = aggByStore.get(a.store_id) ?? [];
    list.push(a); aggByStore.set(a.store_id, list);
  }

  // Buckets per store, classified + summed.
  const bucketsByStore = new Map<number, Map<ShopifySyncErrorBucketKey, { count: number; sample: string }>>();
  for (const b of buckets) {
    const key = classifyMessage(b.sth_message ?? '');
    const m = bucketsByStore.get(b.store_id) ?? new Map();
    const cur = m.get(key) ?? { count: 0, sample: b.sth_message ?? '' };
    cur.count += num(b.cnt);
    m.set(key, cur); bucketsByStore.set(b.store_id, m);
  }

  const trendByStore = new Map<number, ShopifySyncTrendPoint[]>();
  for (const t of trend) {
    const list = trendByStore.get(t.store_id) ?? [];
    list.push({ hour: t.hr, fails: num(t.fails), oks: num(t.oks) });
    trendByStore.set(t.store_id, list);
  }

  const rows: ShopifySyncPerfRow[] = stores.map((s) => {
    const aggs = aggByStore.get(s.store_id) ?? [];
    let successTotal = 0, failureTotal = 0;
    let lastRun: number | null = null;
    const typeMap = new Map<ShopifySyncType, ShopifySyncTypeBreakdown>();
    for (const a of aggs) {
      const c = num(a.cnt);
      if (a.sth_status === 'success') successTotal += c; else failureTotal += c;
      const tb = typeMap.get(a.sth_update_type) ?? { type: a.sth_update_type, success: 0, failure: 0 };
      if (a.sth_status === 'success') tb.success += c; else tb.failure += c;
      typeMap.set(a.sth_update_type, tb);
      if (a.max_at) {
        const t = parseUtc(a.max_at);
        if (t !== null && (lastRun === null || t > lastRun)) lastRun = t;
      }
    }
    const total = successTotal + failureTotal;
    const minutesSince = lastRun === null ? null : Math.round((now.getTime() - lastRun) / 60000);

    const bucketMap = bucketsByStore.get(s.store_id);
    const errorBuckets: ShopifySyncErrorBucket[] = bucketMap
      ? [...bucketMap.entries()]
          .map(([key, v]) => ({ key, label: BUCKET_LABELS[key], count: v.count, sampleMessage: v.sample }))
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_BUCKETS)
      : [];

    return {
      storeId: s.store_id,
      storeName: s.store_name ?? `Store #${s.store_id}`,
      lastRunAt: lastRun === null ? null : new Date(lastRun).toISOString(),
      minutesSinceLastRun: minutesSince,
      isStale: minutesSince === null || minutesSince > STALE_THRESHOLD_MINUTES,
      successTotal,
      failureTotal,
      successRate: total > 0 ? Math.round((successTotal / total) * 1000) / 10 : 0,
      distinctFailingItems: distinctByStore.get(s.store_id) ?? 0,
      failingSince: onsetByStore.get(s.store_id) ?? null,
      byType: [...typeMap.values()],
      errorBuckets,
      trend: trendByStore.get(s.store_id) ?? [],
    };
  });

  // Worst-first: currently-failing (failingSince set) first, then by failure count.
  return rows.sort((a, b) => {
    const af = a.failingSince ? 1 : 0, bf = b.failingSince ? 1 : 0;
    if (af !== bf) return bf - af;
    return b.failureTotal - a.failureTotal;
  });
}

// ---------------------------------------------------------------------------
// DB query layer (Task 3)
// ---------------------------------------------------------------------------

/**
 * NOTE on IN (?) with Prisma $queryRawUnsafe + MySQL connector:
 * Prisma 5.22.0 does NOT expand a JS array passed as a single `?` placeholder
 * into `?,?,?,...`. No existing usage of array-to-IN(?) expansion was found in
 * this codebase. To be safe and explicit we build the placeholder list manually:
 *   IN (${ids.map(() => '?').join(',')})
 * and spread `...ids` as individual positional parameters. This is the same
 * pattern used in listing.service.ts and other modules where IN lists appear.
 */

/** Resolve the live Shopify store list (data-driven, never hardcoded). */
const STORES_SQL = `
  SELECT store_id, store_name
  FROM store_management
  WHERE store_platform = 'Shopify'
`;

/** §5.1 covering aggregate — Using index. */
const makeAggSql = (placeholders: string) => `
  SELECT store_id, sth_update_type, sth_status,
         COUNT(*) AS cnt, MAX(sth_created_at) AS max_at
  FROM shopify_tracking_history
  WHERE store_id IN (${placeholders}) AND sth_created_at >= NOW() - INTERVAL ? HOUR
  GROUP BY store_id, sth_update_type, sth_status
`;

/** §5.2 distinct failing items (reads the failure subset only). */
const makeDistinctSql = (placeholders: string) => `
  SELECT store_id, COUNT(DISTINCT spv_variation_id) AS distinct_failing_items
  FROM shopify_tracking_history
  WHERE store_id IN (${placeholders}) AND sth_status = 'failure'
    AND sth_created_at >= NOW() - INTERVAL ? HOUR
  GROUP BY store_id
`;

/** §5.3 onset: earliest failure since each store's last success in window.
 *  The id list is referenced twice in this query (outer WHERE + inner subquery),
 *  so the placeholders and ...ids are spread twice. */
const makeOnsetSql = (placeholders: string) => `
  SELECT f.store_id, MIN(f.sth_created_at) AS failing_since
  FROM shopify_tracking_history f
  JOIN (
    SELECT store_id,
           MAX(CASE WHEN sth_status = 'success' THEN sth_created_at END) AS last_success_at
    FROM shopify_tracking_history
    WHERE store_id IN (${placeholders}) AND sth_created_at >= NOW() - INTERVAL ? HOUR
    GROUP BY store_id
  ) s ON s.store_id = f.store_id
  WHERE f.store_id IN (${placeholders}) AND f.sth_status = 'failure'
    AND f.sth_created_at >= NOW() - INTERVAL ? HOUR
    AND f.sth_created_at > COALESCE(s.last_success_at, '1970-01-01 00:00:00')
  GROUP BY f.store_id
`;

/** §5.4 failures grouped by raw message (classified in the app layer). */
const makeBucketSql = (placeholders: string) => `
  SELECT store_id, sth_message, COUNT(*) AS cnt
  FROM shopify_tracking_history
  WHERE store_id IN (${placeholders}) AND sth_status = 'failure'
    AND sth_created_at >= NOW() - INTERVAL ? HOUR
  GROUP BY store_id, sth_message
`;

/** §5.5 fixed 48h hourly trend. */
const makeTrendSql = (placeholders: string) => `
  SELECT store_id, DATE_FORMAT(sth_created_at, '%Y-%m-%d %H:00') AS hr,
         SUM(sth_status = 'failure') AS fails, SUM(sth_status = 'success') AS oks
  FROM shopify_tracking_history
  WHERE store_id IN (${placeholders}) AND sth_created_at >= NOW() - INTERVAL ? HOUR
  GROUP BY store_id, hr
`;

export async function getShopifySyncPerformance(
  generatedAt: string,
  windowHours: number,
): Promise<ShopifySyncPerformanceResponse> {
  const stores = await prisma.$queryRawUnsafe<StoreRaw[]>(STORES_SQL);
  const ids = stores.map((s) => s.store_id);
  if (ids.length === 0) {
    return { generatedAt, windowHours, staleThresholdMinutes: STALE_THRESHOLD_MINUTES, rows: [] };
  }

  // Build per-id placeholder string once; reuse across all queries.
  const ph = ids.map(() => '?').join(',');

  const [agg, distinct, onset, buckets, trend] = await Promise.all([
    prisma.$queryRawUnsafe<AggRaw[]>(makeAggSql(ph), ...ids, windowHours),
    prisma.$queryRawUnsafe<DistinctRaw[]>(makeDistinctSql(ph), ...ids, windowHours),
    // ONSET references the id list twice (inner subquery + outer WHERE) and windowHours twice.
    prisma.$queryRawUnsafe<OnsetRaw[]>(makeOnsetSql(ph), ...ids, windowHours, ...ids, windowHours),
    prisma.$queryRawUnsafe<BucketRaw[]>(makeBucketSql(ph), ...ids, windowHours),
    prisma.$queryRawUnsafe<TrendRaw[]>(makeTrendSql(ph), ...ids, TREND_HOURS),
  ]);

  const rows = assembleRows({
    now: new Date(generatedAt), windowHours, stores, agg, distinct, onset, buckets, trend,
  });
  return { generatedAt, windowHours, staleThresholdMinutes: STALE_THRESHOLD_MINUTES, rows };
}
