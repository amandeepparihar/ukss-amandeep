import { redis } from '../../../lib/redis';
import { getLogger } from '../../../lib/logger-context';

const DEFAULT_TTL = 3600; // 1 hour
const REDIS_TIMEOUT_MS = 5000; // 5 seconds

/**
 * Wraps a Redis get/set with a timeout to prevent infinite hangs
 * when Redis has maxRetriesPerRequest: null.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis operation timed out')), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Cache-through helper for dashboard endpoints.
 *
 * @param key        Redis key
 * @param ttlSeconds TTL in seconds (default 3600)
 * @param fn         Data-fetching function to call on cache miss
 * @param noCache    When true: bypass cache, call fn(), delete stale key, store fresh result
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number = DEFAULT_TTL,
  fn: () => Promise<T>,
  noCache = false,
): Promise<T> {
  const logger = getLogger();

  if (noCache) {
    // Bypass cache: call fn() first, then update Redis
    const result = await fn();
    try {
      await withTimeout(redis.del(key), REDIS_TIMEOUT_MS);
      await withTimeout(
        redis.set(key, JSON.stringify(result), 'EX', ttlSeconds),
        REDIS_TIMEOUT_MS,
      );
    } catch (err) {
      logger.warn({ err, key }, 'Redis error while storing fresh result (noCache)');
    }
    return result;
  }

  // Normal path: check cache first
  try {
    const cached = await withTimeout(redis.get(key), REDIS_TIMEOUT_MS);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis error on cache lookup, falling through to fn()');
  }

  // Cache miss — call the data function
  const result = await fn();

  // Store in Redis (best-effort)
  try {
    await withTimeout(
      redis.set(key, JSON.stringify(result), 'EX', ttlSeconds),
      REDIS_TIMEOUT_MS,
    );
  } catch (err) {
    logger.warn({ err, key }, 'Redis error while storing result');
  }

  return result;
}
