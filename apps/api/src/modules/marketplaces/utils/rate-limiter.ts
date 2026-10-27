/**
 * Rate Limiter
 *
 * Prevents hitting marketplace API rate limits.
 * Supports two strategies:
 * - Fixed: Wait X milliseconds between each request
 * - Burst: Allow N requests per window, then wait until window expires
 */

import { createLogger } from '../../../lib/logger';
import type { RateLimitConfig } from '../config/types';

const logger = createLogger('rate-limiter');

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter for marketplace API requests.
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;

  /** Start of current time window (for burst strategy) */
  private windowStart: number = 0;

  /** Number of requests in current window (for burst strategy) */
  private requestCount: number = 0;

  /** Timestamp of last request (for fixed strategy) */
  private lastRequestTime: number = 0;

  constructor(config: RateLimitConfig) {
    this.config = {
      ...config,
      windowMs: config.windowMs || 60000, // Default: 1 minute
    };
  }

  /**
   * Acquire permission to make a request.
   * Blocks if rate limit is reached until it's safe to proceed.
   */
  async acquire(): Promise<void> {
    if (this.config.strategy === 'fixed') {
      await this.fixedDelay();
    } else {
      await this.burstAndWait();
    }
  }

  /**
   * Fixed delay strategy: Wait X milliseconds between each request.
   * Simple and predictable, good for APIs without burst capability.
   */
  private async fixedDelay(): Promise<void> {
    // Calculate required delay between requests
    const delayMs =
      this.config.delayMs || Math.ceil(60000 / this.config.requestsPerMinute);

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < delayMs) {
      const waitTime = delayMs - timeSinceLastRequest;
      logger.debug({ waitTime }, 'Fixed rate limit: waiting');
      await sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Burst-and-wait strategy: Allow N requests per window, then wait.
   * Better throughput for APIs that allow bursting (e.g., BaseLinker).
   */
  private async burstAndWait(): Promise<void> {
    const now = Date.now();
    const windowMs = this.config.windowMs!;

    // Check if we're in a new window
    if (now - this.windowStart >= windowMs) {
      // New window - reset counters
      this.windowStart = now;
      this.requestCount = 0;
      logger.debug('Burst rate limit: new window started');
    }

    // Check if we've hit the limit for this window
    if (this.requestCount >= this.config.requestsPerMinute) {
      // Calculate how long until window expires
      const waitTime = windowMs - (now - this.windowStart);

      if (waitTime > 0) {
        logger.info(
          {
            waitTime,
            requestCount: this.requestCount,
            limit: this.config.requestsPerMinute,
          },
          'Burst rate limit: waiting for window reset'
        );
        await sleep(waitTime);

        // Reset for new window
        this.windowStart = Date.now();
        this.requestCount = 0;
      }
    }

    // Increment counter
    this.requestCount++;

    logger.debug(
      {
        requestCount: this.requestCount,
        limit: this.config.requestsPerMinute,
        windowRemaining: windowMs - (Date.now() - this.windowStart),
      },
      'Burst rate limit: request allowed'
    );
  }

  /**
   * Get current rate limiter status.
   */
  getStatus(): RateLimiterStatus {
    const now = Date.now();
    const windowMs = this.config.windowMs || 60000;

    if (this.config.strategy === 'fixed') {
      const delayMs =
        this.config.delayMs || Math.ceil(60000 / this.config.requestsPerMinute);
      const timeSinceLastRequest = now - this.lastRequestTime;

      return {
        strategy: 'fixed',
        canProceed: timeSinceLastRequest >= delayMs,
        waitTimeMs: Math.max(0, delayMs - timeSinceLastRequest),
        requestsRemaining: timeSinceLastRequest >= delayMs ? 1 : 0,
      };
    } else {
      // Burst strategy
      const windowExpired = now - this.windowStart >= windowMs;
      const requestsRemaining = windowExpired
        ? this.config.requestsPerMinute
        : this.config.requestsPerMinute - this.requestCount;

      return {
        strategy: 'burst',
        canProceed: requestsRemaining > 0,
        waitTimeMs:
          requestsRemaining > 0 ? 0 : windowMs - (now - this.windowStart),
        requestsRemaining: Math.max(0, requestsRemaining),
        windowResetIn: windowMs - (now - this.windowStart),
      };
    }
  }

  /**
   * Reset the rate limiter (useful for testing or error recovery).
   */
  reset(): void {
    this.windowStart = 0;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    logger.debug('Rate limiter reset');
  }

  /**
   * Get the current configuration.
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
}

/**
 * Status information for rate limiter.
 */
export interface RateLimiterStatus {
  /** Current strategy being used */
  strategy: 'fixed' | 'burst';
  /** Whether a request can proceed immediately */
  canProceed: boolean;
  /** Milliseconds to wait before next request allowed */
  waitTimeMs: number;
  /** Number of requests remaining in current window */
  requestsRemaining: number;
  /** Milliseconds until window resets (burst only) */
  windowResetIn?: number;
}

/**
 * Create a rate limiter with custom configuration.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config);
}
