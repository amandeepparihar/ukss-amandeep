/**
 * Retry Handler
 *
 * Automatic retry for transient failures with exponential backoff and jitter.
 * Prevents thundering herd and handles rate limits gracefully.
 */

import { createLogger } from '../../../lib/logger';
import { isRetryableError, RateLimitError } from './errors';
import type { RetryConfig } from '../config/types';

const logger = createLogger('retry-handler');

/**
 * Default retry configuration.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handles automatic retries with exponential backoff.
 */
export class RetryHandler {
  private readonly config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };
  }

  /**
   * Execute a function with automatic retry on failure.
   *
   * @param fn - Function to execute
   * @param context - Optional context for logging
   * @returns Result of the function
   * @throws Last error if all retries exhausted
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const result = await fn();

        // Log recovery if this wasn't the first attempt
        if (attempt > 1) {
          logger.info(
            { attempt, context },
            `Retry succeeded on attempt ${attempt}`
          );
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry
        const shouldRetry = isRetryableError(error) && attempt < this.config.maxAttempts;

        if (!shouldRetry) {
          // Log final failure
          logger.error(
            {
              attempt,
              maxAttempts: this.config.maxAttempts,
              context,
              error: lastError.message,
              retryable: isRetryableError(error),
            },
            `Request failed (not retrying)`
          );
          throw error;
        }

        // Calculate delay
        const delay = this.calculateDelay(attempt, error);

        logger.warn(
          {
            attempt,
            maxAttempts: this.config.maxAttempts,
            delay,
            context,
            error: lastError.message,
          },
          `Request failed, retrying in ${delay}ms`
        );

        await sleep(delay);
      }
    }

    // Should not reach here, but throw last error just in case
    throw lastError;
  }

  /**
   * Calculate delay before next retry attempt.
   * Uses exponential backoff with optional jitter.
   */
  private calculateDelay(attempt: number, error: unknown): number {
    // Check for Retry-After header in rate limit errors
    if (error instanceof RateLimitError && error.retryAfter) {
      return error.retryAfter * 1000; // Convert seconds to ms
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, etc.
    let delay = this.config.baseDelayMs * Math.pow(2, attempt - 1);

    // Cap at maximum delay
    delay = Math.min(delay, this.config.maxDelayMs);

    // Add jitter (±25%) to prevent thundering herd
    if (this.config.jitter) {
      const jitterRange = delay * 0.25;
      const jitter = Math.random() * jitterRange * 2 - jitterRange;
      delay = Math.round(delay + jitter);
    }

    return delay;
  }

  /**
   * Check if an error is retryable.
   */
  isRetryable(error: unknown): boolean {
    return isRetryableError(error);
  }

  /**
   * Get the current configuration.
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}

/**
 * Create a retry handler with custom configuration.
 */
export function createRetryHandler(config?: Partial<RetryConfig>): RetryHandler {
  return new RetryHandler(config);
}
