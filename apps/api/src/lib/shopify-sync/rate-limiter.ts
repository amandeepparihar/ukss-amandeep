/**
 * Rate Limiter for Shopify API
 *
 * Shopify has rate limits:
 * - Standard: 2 requests/second (bucket leak rate)
 * - Plus: 4 requests/second
 * - GraphQL: 50 points/second (most queries cost 1 point)
 */

import { createLogger } from '../logger';

const logger = createLogger('shopify-rate-limiter');

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens = 40, refillRate = 2) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /**
   * Wait until a request can be made
   */
  async throttle(): Promise<void> {
    this.refillTokens();

    if (this.tokens < 1) {
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
      logger.debug({ waitTime }, 'Rate limit reached, waiting');
      await this.sleep(waitTime);
      this.refillTokens();
    }

    this.tokens -= 1;
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Update rate limiter based on Shopify response headers
   */
  handleResponse(headers: Record<string, string>): void {
    // Handle REST API rate limit header
    const callLimit = headers['x-shopify-shop-api-call-limit'];
    if (callLimit) {
      const [used, max] = callLimit.split('/').map(Number);
      this.tokens = max - used;
      this.maxTokens = max;

      if (this.tokens < 5) {
        logger.warn({ used, max, remaining: this.tokens }, 'Approaching rate limit');
      }
    }

    // Handle GraphQL throttle status
    const throttleStatus = headers['x-graphql-cost-include-fields'];
    if (throttleStatus) {
      try {
        const status = JSON.parse(throttleStatus);
        if (status.currentlyAvailable !== undefined) {
          this.tokens = status.currentlyAvailable;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Check if we should slow down
   */
  shouldSlowDown(): boolean {
    this.refillTokens();
    return this.tokens < this.maxTokens * 0.2;
  }

  /**
   * Get current available tokens
   */
  getAvailableTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton per store domain to share rate limit state
const limiters = new Map<string, RateLimiter>();

export function getRateLimiter(shopDomain: string): RateLimiter {
  if (!limiters.has(shopDomain)) {
    limiters.set(shopDomain, new RateLimiter());
  }
  return limiters.get(shopDomain)!;
}

export function clearRateLimiter(shopDomain: string): void {
  limiters.delete(shopDomain);
}
