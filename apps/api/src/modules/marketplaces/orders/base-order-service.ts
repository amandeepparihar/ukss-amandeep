/**
 * Base Marketplace Order Service — Lightweight Helpers
 *
 * Provides shared utilities for marketplace order integrations without imposing
 * an abstract pipeline. Each marketplace service uses these helpers directly
 * and implements its own fetch/transform/push flow.
 *
 * What this provides:
 *   - HttpClient factory pre-configured with auth, retry, and rate limiting
 *   - Execution context (unique ID + child logger per run)
 *   - Consistent result logging for fetch and status push operations
 *   - Standardized error email notifications
 *
 * What this does NOT do:
 *   - No abstract methods to implement
 *   - No pipeline orchestration
 *   - No inheritance required (use composition)
 */

import { nanoid } from 'nanoid';
import { createLogger, type Logger } from '../../../lib/logger';
import { HttpClient, type HttpClientConfig } from '../utils/http-client';
import { emailService } from '../../../lib/email';
import { serializeError, getErrorMessage } from '../../../lib/helpers/error-utils';
import type { FetchOrdersResult, StatusPushResult, MarketplaceOrderConfig } from './types';

// Re-export commonly used utilities so marketplace services can import from one place
export { serializeError, getErrorMessage } from '../../../lib/helpers/error-utils';
export { insertMarketPlaceOrderDetails, getOrderStatus, getOrderStatusWithGlobalExternalId } from '../../../lib/marketplace-orders/marketplace-orders-utils';
export { getLastFetchedOrderDate, getOrderProductDetails } from '../../../lib/marketplace-orders/marketplace-orders-products-util';
export { getProductVariationDataFromSKU } from '../../../lib/new-product-variations/new-product-variations-utils';
export { getStoreDetails, getStoreInfo, getEbayUkStoreInfo } from '../../../lib/store-management/store-management-utils';
export { getCurrencyDetails } from '../../../lib/helpers/common-utils';

/**
 * Execution context for a single pipeline run.
 *
 * Every fetch or status push creates one of these at the start.
 * The executionId ties together all log entries for a single run,
 * making it easy to trace a complete operation in production logs.
 */
export interface ExecutionContext {
  /** Unique ID for this run (nanoid, 10 chars) */
  executionId: string;

  /** Logger with executionId already bound as context */
  logger: Logger;
}

/**
 * Create an execution context for a marketplace order operation.
 *
 * @param marketplaceName - Used as the logger module name (e.g., 'sportdeal-order-service')
 * @returns Context with unique execution ID and pre-configured logger
 *
 * @example
 * const { executionId, logger } = createExecutionContext('sportdeal-order-service');
 * logger.info('Starting fetch'); // logs with { executionId: "abc123xyz" }
 */
export function createExecutionContext(loggerModule: string): ExecutionContext {
  const executionId = nanoid(10);
  const baseLogger = createLogger(loggerModule);
  const logger = baseLogger.child({ executionId });

  return { executionId, logger };
}

/**
 * Create an HttpClient pre-configured for a marketplace.
 *
 * Wraps the existing HttpClient from modules/marketplaces/utils/ with
 * marketplace-specific auth, rate limiting, and retry settings.
 *
 * @param config - HttpClient configuration (baseUrl, auth, rateLimit, retry, marketplace)
 * @returns Configured HttpClient instance
 *
 * @example
 * const client = createOrderHttpClient({
 *   baseUrl: '',  // Sportdeal uses full URLs
 *   auth: { type: 'token-header', token: apiKey, tokenPrefix: '' },
 *   rateLimit: { strategy: 'fixed', requestsPerMinute: 120, delayMs: 500 },
 *   retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, jitter: true },
 *   marketplace: 'Sportdeal',
 * });
 */
export function createOrderHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}

/**
 * Log a standardized summary of a fetch orders operation.
 *
 * Call this at the end of every fetchOrders() to ensure consistent logging
 * across all marketplace integrations.
 *
 * @param logger - Logger instance (from execution context)
 * @param result - The fetch result to summarize
 */
export function logFetchSummary(logger: Logger, result: FetchOrdersResult): void {
  const level = result.success ? 'info' : 'error';
  logger[level](
    {
      success: result.success,
      ordersFound: result.ordersFound,
      ordersInserted: result.ordersInserted,
      ordersSkipped: result.ordersSkipped,
      ordersFailed: result.ordersFailed,
      duration: result.duration,
      errorCount: result.errors.length,
    },
    `Order fetch complete: ${result.ordersInserted} inserted, ${result.ordersSkipped} skipped, ${result.ordersFailed} failed`
  );
}

/**
 * Log a standardized summary of a status push operation.
 *
 * @param logger - Logger instance (from execution context)
 * @param result - The status push result to summarize
 */
export function logStatusPushSummary(logger: Logger, result: StatusPushResult): void {
  const level = result.success ? 'info' : 'error';
  logger[level](
    {
      success: result.success,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      duration: result.duration,
    },
    `Status push complete: ${result.succeeded} succeeded, ${result.failed} failed`
  );
}

/**
 * Send a standardized error notification email for marketplace order failures.
 *
 * @param marketplaceName - Marketplace name for the email subject
 * @param subject - Specific error subject (e.g., 'Order Fetch Failed')
 * @param errorMessage - Human-readable error description (HTML)
 * @param context - Additional context for debugging (logged in email body)
 */
export async function sendOrderFailureEmail(
  marketplaceName: string,
  subject: string,
  errorMessage: string,
  context?: Record<string, unknown>,
  additionalRecipients?: string | string[]
): Promise<void> {
  await emailService.sendErrorNotification({
    subject: `${marketplaceName} ${subject}`,
    errorMessage,
    module: `${marketplaceName.toLowerCase()}-order-service`,
    context,
    additionalRecipients,
  });
}

/**
 * Send an order cancellation / manual-action request email.
 *
 * Same signature and behaviour as sendOrderFailureEmail, but uses the neutral
 * 'order-cancellation-request' template instead of the error template — for when
 * a marketplace order must be cancelled/rejected manually on the marketplace
 * dashboard (e.g. Seller Dynamics has no automated refund/cancel push). This is
 * a routine workflow request, not an error.
 *
 * @param marketplaceName - Marketplace name for the email subject
 * @param subject - Specific subject (e.g., 'Order Requires Manual Action - Order 123')
 * @param message - Human-readable message (HTML)
 * @param context - Additional context for debugging (logged in email body)
 * @param additionalRecipients - Extra recipients beyond the dev team (e.g. Simon)
 */
export async function sendOrderCancellationRequest(
  marketplaceName: string,
  subject: string,
  message: string,
  context?: Record<string, unknown>,
  additionalRecipients?: string | string[]
): Promise<void> {
  await emailService.sendCancellationRequest({
    subject: `${marketplaceName} ${subject}`,
    message,
    module: `${marketplaceName.toLowerCase()}-order-service`,
    context,
    additionalRecipients,
  });
}

/**
 * Create a default FetchOrdersResult for error cases.
 * Use this when the fetch fails before any orders are processed.
 */
export function createFailedFetchResult(message: string, duration: number): FetchOrdersResult {
  return {
    success: false,
    message,
    ordersFound: 0,
    ordersInserted: 0,
    ordersSkipped: 0,
    ordersFailed: 0,
    errors: [{ orderId: 'N/A', error: message }],
    duration,
  };
}
