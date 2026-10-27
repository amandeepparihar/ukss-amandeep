/**
 * Sales Dashboard Cache Helper
 *
 * Implements stale-while-revalidate caching pattern for dashboard data.
 * Cache entries store `{ data, cachedAt }` as JSON. Redis TTL is set to
 * `ttlSeconds + graceSeconds` so stale data remains accessible during the
 * grace window while a background refresh is triggered.
 *
 * Key prefix: `sd:` (sales-dashboard)
 *
 * @taskId #165091-6
 */

import redis from '../../lib/redis';
import { getLogger } from '../../lib/logger-context';

// ====================================================
// Types
// ====================================================

interface CacheEntry<T> {
  data: T;
  cachedAt: number; // epoch ms
}

interface CachedResult<T> {
  data: T;
  isStale: boolean;
}

/**
 * Set of cache keys currently being refreshed in the background.
 * Prevents multiple concurrent refresh calls for the same key.
 */
const refreshInProgress = new Set<string>();

// ====================================================
// Core: getCachedOrFetch
// ====================================================

/**
 * Fetch data with stale-while-revalidate caching.
 *
 * - **Fresh hit** (within ttl): returns `{ data, isStale: false }`.
 * - **Stale hit** (past ttl but within grace): returns `{ data, isStale: true }`
 *   and triggers an async background refresh.
 * - **Miss**: calls `fetchFn` synchronously, caches the result, and returns
 *   `{ data, isStale: false }`.
 *
 * If Redis is unavailable, falls back to a direct `fetchFn` call with no
 * caching and logs a warning.
 *
 * @param key         - Full Redis key (use `buildCacheKey` to generate)
 * @param ttlSeconds  - Freshness window in seconds
 * @param graceSeconds - Additional seconds data is considered stale-but-usable
 * @param fetchFn     - Async function that fetches fresh data (e.g. DB query)
 * @param noCache     - When true: skip the cache read, call fetchFn(), and store the fresh result
 * @returns Cached or freshly-fetched data with a staleness indicator
 *
 * @taskId #165091-6
 */
export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  graceSeconds: number,
  fetchFn: () => Promise<T>,
  noCache = false,
): Promise<CachedResult<T>> {
  const logger = getLogger('sales-dashboard');

  if (noCache) {
    const data = await fetchFn();
    try {
      await cacheData(key, data, ttlSeconds, graceSeconds);
    } catch (error) {
      logger.warn({ err: error, cacheKey: key }, 'Redis error while storing fresh result (noCache)');
    }
    return { data, isStale: false };
  }

  try {
    const raw = await redis.get(key);

    if (raw !== null) {
      const entry: CacheEntry<T> = JSON.parse(raw);
      const ageMs = Date.now() - entry.cachedAt;
      const ttlMs = ttlSeconds * 1000;

      if (ageMs <= ttlMs) {
        // Fresh hit
        return { data: entry.data, isStale: false };
      }

      // Stale hit (still within grace because Redis TTL hasn't expired yet)
      triggerBackgroundRefresh(key, ttlSeconds, graceSeconds, fetchFn);
      return { data: entry.data, isStale: true };
    }

    // Cache miss - fetch synchronously and cache
    const data = await fetchFn();
    await cacheData(key, data, ttlSeconds, graceSeconds);
    return { data, isStale: false };
  } catch (error) {
    logger.warn(
      { err: error, cacheKey: key },
      'Redis unavailable, falling back to direct fetch',
    );
    const data = await fetchFn();
    return { data, isStale: false };
  }
}

// ====================================================
// Internal: cacheData
// ====================================================

/**
 * Store data in Redis with a TTL of `ttlSeconds + graceSeconds`.
 *
 * @taskId #165091-6
 */
async function cacheData<T>(
  key: string,
  data: T,
  ttlSeconds: number,
  graceSeconds: number,
): Promise<void> {
  const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
  const totalTtl = ttlSeconds + graceSeconds;
  await redis.set(key, JSON.stringify(entry), 'EX', totalTtl);
}

// ====================================================
// Internal: triggerBackgroundRefresh
// ====================================================

/**
 * Fire-and-forget background refresh for a stale cache entry.
 * Deduplicates concurrent refreshes for the same key.
 *
 * @taskId #165091-6
 */
function triggerBackgroundRefresh<T>(
  key: string,
  ttlSeconds: number,
  graceSeconds: number,
  fetchFn: () => Promise<T>,
): void {
  if (refreshInProgress.has(key)) {
    return;
  }

  refreshInProgress.add(key);
  const logger = getLogger('sales-dashboard');

  fetchFn()
    .then(async (data) => {
      await cacheData(key, data, ttlSeconds, graceSeconds);
      logger.debug({ cacheKey: key }, 'Background cache refresh completed');
    })
    .catch((error) => {
      logger.warn(
        { err: error, cacheKey: key },
        'Background cache refresh failed',
      );
    })
    .finally(() => {
      refreshInProgress.delete(key);
    });
}

// ====================================================
// invalidateCache
// ====================================================

/**
 * Delete all cache keys matching the given pattern.
 *
 * Uses Redis SCAN to iterate keys matching `sd:{pattern}*` and deletes them
 * in batches. Safe for production — SCAN does not block the server.
 *
 * @param pattern - Key pattern suffix (e.g. `"kpi"` deletes `sd:kpi:*`).
 *                  Pass `"*"` to clear all sales-dashboard cache keys.
 *
 * @taskId #165091-6
 */
export async function invalidateCache(pattern: string): Promise<number> {
  const logger = getLogger('sales-dashboard');
  const matchPattern = pattern === '*' ? 'sd:*' : `sd:${pattern}:*`;
  let deletedCount = 0;

  try {
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    logger.info(
      { pattern: matchPattern, deletedCount },
      'Cache invalidation completed',
    );
  } catch (error) {
    logger.warn(
      { err: error, pattern: matchPattern },
      'Cache invalidation failed — Redis may be unavailable',
    );
  }

  return deletedCount;
}

// ====================================================
// buildCacheKey
// ====================================================

/**
 * Build a deterministic Redis cache key for the sales dashboard.
 *
 * Store IDs are sorted numerically and joined with commas, or replaced with
 * `"all"` when the array is empty or undefined (meaning no store filter).
 *
 * @param prefix - Key prefix (e.g. `"kpi"`, `"trends"`, `"stores"`)
 * @param params - Additional key segments. Arrays of numbers are treated as
 *                 store IDs and normalized.
 * @returns A Redis key like `sd:kpi:today:95,118,126` or `sd:stores`
 *
 * @example
 * buildCacheKey('kpi', 'today', [126, 95, 118])
 * // => "sd:kpi:today:95,118,126"
 *
 * buildCacheKey('kpi', 'today')
 * // => "sd:kpi:today:all"
 *
 * buildCacheKey('stores')
 * // => "sd:stores"
 *
 * @taskId #165091-6
 */
export function buildCacheKey(
  prefix: string,
  ...params: (string | number | number[] | undefined)[]
): string {
  const parts: string[] = [`sd:${prefix}`];

  for (const param of params) {
    if (param === undefined || param === null) {
      continue;
    }

    if (Array.isArray(param)) {
      // Store IDs: sort numerically and join, or "all" if empty
      if (param.length === 0) {
        parts.push('all');
      } else {
        const sorted = [...param].sort((a, b) => a - b);
        parts.push(sorted.join(','));
      }
    } else {
      parts.push(String(param));
    }
  }

  return parts.join(':');
}
