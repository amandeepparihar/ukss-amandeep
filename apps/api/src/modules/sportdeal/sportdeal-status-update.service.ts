/**
 * Sportdeal Status Update Service
 *
 * Pushes order status updates (Confirm/Cancel) back to the Sportdeal API.
 *
 * Pipeline: Stage 5 (Status Push)
 * Cron: `pnpm cli update-sportdeal-orders-status`
 *
 * Flow:
 *   1. Query mop_marketplace_order_products for pending Sportdeal status updates
 *   2. For each product:
 *      - 'Confirmed' → GET Sportdeal confirm API → mark all products for that order as 'Shipped'
 *      - Other status → No API call → mark as 'Cancelled' + 'Need to update manually'
 *   3. Deduplication: one API call per order ID (not per product)
 *
 * WHY: Sportdeal's confirm endpoint uses GET (not POST). This is their API design,
 * not a bug. The endpoint idempotently confirms the order.
 */

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { RateLimiter } from '../marketplaces/utils/rate-limiter';
import {
  createExecutionContext,
  createOrderHttpClient,
  logStatusPushSummary,
  sendOrderFailureEmail,
  serializeError,
  getErrorMessage,
  getOrderProductDetails,
  type StatusPushResult,
  OrderStatus,
  ApiResponseStatus,
} from '../marketplaces/orders';
import type {
  UpdateSportdealOrderStatusInput,
  UpdateSportdealOrderStatusResult,
  BatchUpdateSportdealOrderStatusResult,
} from './sportdeal-schema';

const MARKETPLACE_NAME = 'Sportdeal';

/**
 * Confirm a Sportdeal order via their API.
 *
 * WHY: Sportdeal confirm uses GET method (not POST). This is their API design.
 * The endpoint: SPORTDEAL_ORDER_STATUS_UPDATE_API + orderId
 *
 * @param orderId - Sportdeal marketplace order ID
 * @param logger - Logger instance
 * @returns Success/failure with optional error message
 */
async function confirmSportdealOrder(
  orderId: string,
  httpClient: ReturnType<typeof createOrderHttpClient>,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; error?: string }> {
  const confirmApiBase = config.SPORTDEAL_ORDER_STATUS_UPDATE_API;

  if (!confirmApiBase) {
    const msg = 'SPORTDEAL_ORDER_STATUS_UPDATE_API not configured';
    logger.error(msg);
    return { success: false, error: msg };
  }

  const confirmUrl = `${confirmApiBase}${orderId}`;
  logger.info({ orderId, confirmUrl }, 'Confirming Sportdeal order');

  try {
    // WHY: Sportdeal confirm API uses GET, not POST
    const response = await httpClient.get<unknown>(confirmUrl);

    if (response.status === 200) {
      logger.info({ orderId, statusCode: response.status, duration: response.duration }, 'Sportdeal order confirmed');
      return { success: true };
    } else {
      const error = `Sportdeal confirm API returned HTTP ${response.status}`;
      logger.error({ orderId, statusCode: response.status, duration: response.duration }, error);

      await sendOrderFailureEmail(
        MARKETPLACE_NAME,
        `Order Confirm Failed - Order ${orderId}`,
        `Hi Team,<br><br>Failed to confirm Sportdeal order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>HTTP Status:</b> ${response.status}`,
        { orderId, confirmUrl, status: response.status }
      );

      return { success: false, error };
    }
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error), orderId }, 'Exception confirming Sportdeal order');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Confirm Exception - Order ${orderId}`,
      `Hi Team,<br><br>Exception confirming Sportdeal order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { orderId, error: msg }
    );

    return { success: false, error: msg };
  }
}

/**
 * Process a single product's status update.
 *
 * WHY: Deduplication uses a Map<orderId, boolean> because one Sportdeal order
 * can have multiple products. We only call the confirm API once per order,
 * then mark all remaining products for the same order as 'Shipped'.
 *
 * @param input - Product status update details
 * @param processedOrders - Map tracking which orders have been confirmed (for dedup)
 * @param logger - Logger instance
 */
async function updateSportdealOrderStatus(
  input: UpdateSportdealOrderStatusInput,
  processedOrders: Map<string, boolean>,
  httpClient: ReturnType<typeof createOrderHttpClient>,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<UpdateSportdealOrderStatusResult> {
  const { mopId, orderId, statusToUpdate } = input;

  logger.info({ mopId, orderId, statusToUpdate }, 'Processing product status update');

  try {
    // Dedup: if this order was already confirmed, just mark this product
    if (processedOrders.has(orderId)) {
      logger.debug({ mopId, orderId }, 'Order already confirmed, marking product');

      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: BigInt(mopId) },
        data: {
          mopOrderStatusOfOrder: OrderStatus.SHIPPED,
          mopApiResponse: ApiResponseStatus.SUCCESS,
        },
      });

      return { success: true, mopId, status: OrderStatus.SHIPPED };
    }

    if (statusToUpdate === OrderStatus.CONFIRMED) {
      const result = await confirmSportdealOrder(orderId, httpClient, logger);

      if (result.success) {
        // Mark ALL products for this order as shipped (matching legacy PHP behavior)
        await prisma.mopMarketplaceOrderProduct.updateMany({
          where: { mopOrderId: orderId },
          data: {
            mopOrderStatusOfOrder: OrderStatus.SHIPPED,
            mopApiResponse: ApiResponseStatus.SUCCESS,
          },
        });

        processedOrders.set(orderId, true);
        logger.info({ mopId, orderId }, 'Order confirmed, all products marked as Shipped');

        return { success: true, mopId, status: OrderStatus.SHIPPED };
      } else {
        logger.error({ mopId, orderId, error: result.error }, 'Order confirm failed');
        return { success: false, mopId, status: statusToUpdate, error: result.error };
      }
    } else {
      // Non-Confirmed status: no API call, mark for manual intervention
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: BigInt(mopId) },
        data: {
          mopOrderStatusOfOrder: OrderStatus.CANCELLED,
          mopApiResponse: ApiResponseStatus.MANUAL_UPDATE,
        },
      });

      logger.info({ mopId, orderId, statusToUpdate }, 'Marked for manual update (no API call)');

      return { success: true, mopId, status: OrderStatus.CANCELLED };
    }
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error), mopId, orderId }, 'Exception updating product status');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Status Update Exception',
      `Hi Team,<br><br>Exception updating Sportdeal order status.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { mopId, orderId, error: msg }
    );

    return { success: false, mopId, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending Sportdeal status updates.
 *
 * Pipeline: Stage 5 (Status Push)
 * Cron: `pnpm cli update-sportdeal-orders-status`
 *
 * @returns Batch result with counts and per-product details
 */
export async function updateSportdealOrderStatusesToSportdeal(): Promise<BatchUpdateSportdealOrderStatusResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('sportdeal-status-update-service');

  logger.info('Starting batch Sportdeal status push');

  try {
    const storeId = config.SPORTDEAL_STORE_ID;
    if (!storeId) {
      logger.warn('SPORTDEAL_STORE_ID not configured, skipping');
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    const pendingProducts = await getOrderProductDetails([storeId], logger);
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending status updates');

    if (pendingProducts.length === 0) {
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    // Rate limiter replaces hardcoded setTimeout(200)
    const rateLimiter = new RateLimiter({
      strategy: 'fixed',
      requestsPerMinute: 120,
      delayMs: 500,
    });

    // Create HttpClient once for the entire batch (not per-order)
    const apiKey = config.SPORTDEAL_API_KEY;
    if (!apiKey) {
      logger.error('SPORTDEAL_API_KEY not configured, cannot push status updates');
      return { success: false, processed: 0, succeeded: 0, failed: 0, results: [], error: 'SPORTDEAL_API_KEY not configured' };
    }

    const httpClient = createOrderHttpClient({
      baseUrl: '',
      auth: { type: 'token-header', token: apiKey, tokenPrefix: '' },
      retry: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 5000, jitter: true },
      marketplace: MARKETPLACE_NAME,
    });

    const results: Array<UpdateSportdealOrderStatusResult & { orderId: string }> = [];
    let succeeded = 0;
    let failed = 0;
    const processedOrders = new Map<string, boolean>();

    for (const product of pendingProducts) {
      const statusToUpdate = product.mopOrderStatusToUpdate || '';
      if (!statusToUpdate) {
        logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
        continue;
      }

      // Rate limit between API calls
      await rateLimiter.acquire();

      const input: UpdateSportdealOrderStatusInput = {
        mopId: Number(product.mopId),
        orderId: product.mopOrderId || '',
        statusToUpdate,
      };

      const result = await updateSportdealOrderStatus(input, processedOrders, httpClient, logger);
      results.push({ ...result, orderId: input.orderId });

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    const statusResult: StatusPushResult = {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results: results.map(r => ({
        mopId: r.mopId,
        orderId: r.orderId,
        status: r.status,
        success: r.success,
        error: r.error,
      })),
      duration: Date.now() - startTime,
    };

    logStatusPushSummary(logger, statusResult);

    return {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results,
    };
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error) }, 'Batch status push failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Batch Status Update Failed',
      `Hi Team,<br><br>Batch Sportdeal status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg }
    );

    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      error: msg,
    };
  }
}
