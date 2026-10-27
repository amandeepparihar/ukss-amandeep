/**
 * OnBuy Status Update Service — Stage 6
 *
 * Pushes UKSS order status changes (Shipped / Cancelled) back to the OnBuy API.
 *
 * Cron: every 15 minutes
 *
 * Behavior (legacy parity, order_status_managment_controller.php case '125', lines 660-757):
 *   - One PUT per pending MOP row (NO order-level dedup; legacy line 1209 commented out)
 *   - status `'dispatched'` → PUT ONBUY_DISPATCH_API_URL
 *   - status `'cancelled'` → PUT ONBUY_CANCEL_API_URL
 *   - any other status     → log warning + skip (improvement over legacy silent fall-through
 *     which would send `null` JSON)
 *   - Cancel reason hardcoded: code "5", text "out_of_stock"
 *   - On HTTP 200: write back mop_order_status_of_order = "Shipped"/"Cancelled",
 *     mop_api_response = "Success"
 *   - On non-200: leave mop_api_response = "Waiting", send dev email
 */

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createOnBuyClient } from '../../lib/marketplaces/onbuy/client';
import {
  createExecutionContext,
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
  BatchUpdateOnbuyOrderStatusResult,
  UpdateOnbuyOrderStatusResult,
} from './onbuy-schema';

const MARKETPLACE_NAME = 'OnBuy';
const ONBUY_STORE_ID = config.ONBUY_STORE_ID;
const ONBUY_SITE_ID_NUMERIC = 2000;
const CANCEL_REASON_CODE = '5';
const CANCEL_REASON_TEXT = 'out_of_stock';

interface PendingProduct {
  mopId: bigint;
  mopOrderId: string | null;
  mopProductSku: string | null;
  // WHY bigint: Prisma maps mop_product_quantity (BigInt? in schema.mysql.prisma) to JS bigint.
  // JSON.stringify cannot serialize bigint, so callers must coerce via Number() before
  // putting it in any request body or log payload.
  mopProductQuantity: bigint | null;
  mopOrderStatusToUpdate: string | null;
  mopUkssTrackingCode: string | null;
  mopUkssShippingCarrier: string | null;
}

/**
 * Push OnBuy dispatch status (mop_order_status_to_update = 'dispatched').
 *
 * Legacy: order_status_managment_controller.php lines 675-694.
 */
async function pushDispatchToOnbuy(
  product: PendingProduct,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; status: number; body: string }> {
  const url = config.ONBUY_DISPATCH_API_URL;
  if (!url) {
    throw new Error('ONBUY_DISPATCH_API_URL is not configured');
  }

  const requestBody = {
    site_id: ONBUY_SITE_ID_NUMERIC,
    orders: [
      {
        order_id: product.mopOrderId,
        products: [
          {
            sku: product.mopProductSku,
            // WHY Number(): Prisma returns mopProductQuantity as bigint (column is BigInt?
            // in schema.mysql.prisma), and JSON.stringify cannot serialize bigint values.
            // OnBuy's dispatch API accepts a plain integer here.
            quantity: Number(product.mopProductQuantity ?? 0),
            tracking: {
              supplier_name: product.mopUkssShippingCarrier,
              number: product.mopUkssTrackingCode,
            },
          },
        ],
      },
    ],
  };

  logger.info({ mopId: product.mopId.toString(), orderId: product.mopOrderId }, 'PUT OnBuy dispatch');

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      // WHY bare token (no "Bearer "): OnBuy expects raw token. Legacy line 729.
      Authorization: accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  return { success: response.status === 200, status: response.status, body };
}

/**
 * Push OnBuy cancel status (mop_order_status_to_update = 'cancelled').
 *
 * Legacy: order_status_managment_controller.php lines 696-708.
 */
async function pushCancelToOnbuy(
  product: PendingProduct,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; status: number; body: string }> {
  const url = config.ONBUY_CANCEL_API_URL;
  if (!url) {
    throw new Error('ONBUY_CANCEL_API_URL is not configured');
  }

  const requestBody = {
    site_id: ONBUY_SITE_ID_NUMERIC,
    orders: [
      {
        order_id: product.mopOrderId,
        cancel_order_reason: CANCEL_REASON_CODE,
        cancel_order_additional_info: CANCEL_REASON_TEXT,
      },
    ],
  };

  logger.info({ mopId: product.mopId.toString(), orderId: product.mopOrderId }, 'PUT OnBuy cancel');

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  return { success: response.status === 200, status: response.status, body };
}

/**
 * Process a single pending MOP row.
 *
 * No order-level dedup: legacy fires one API call per row (legacy line 1209 commented out;
 * see ONBUY_ORDER_INTEGRATION_PLAN.md §4 for confirmation).
 */
async function processPendingProduct(
  product: PendingProduct,
  accessToken: string,
  executionId: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<UpdateOnbuyOrderStatusResult> {
  const statusToUpdate = (product.mopOrderStatusToUpdate || '').toLowerCase();
  const mopIdNumber = Number(product.mopId);

  if (!statusToUpdate) {
    logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
    return { success: false, mopId: mopIdNumber, status: '', error: 'Empty status' };
  }

  try {
    let apiResult: { success: boolean; status: number; body: string };
    let updatedStatus: string;

    if (statusToUpdate === 'dispatched') {
      apiResult = await pushDispatchToOnbuy(product, accessToken, logger);
      updatedStatus = OrderStatus.SHIPPED;
    } else if (statusToUpdate === 'cancelled') {
      apiResult = await pushCancelToOnbuy(product, accessToken, logger);
      updatedStatus = OrderStatus.CANCELLED;
    } else {
      // WHY skip + log: legacy silently falls through and would send a request with no
      // body, sending "null" JSON to OnBuy. We log + skip instead so the dev sees the
      // unmapped status in cron output and can fix the muosm mapping.
      logger.warn(
        { mopId: product.mopId.toString(), orderId: product.mopOrderId, statusToUpdate },
        'Unmapped status for OnBuy push; skipping'
      );
      return {
        success: false,
        mopId: mopIdNumber,
        status: statusToUpdate,
        error: `Unmapped status '${statusToUpdate}' (only 'dispatched' / 'cancelled' supported for OnBuy)`,
      };
    }

    if (apiResult.success) {
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: product.mopId },
        data: {
          mopOrderStatusOfOrder: updatedStatus,
          mopApiResponse: ApiResponseStatus.SUCCESS,
        },
      });
      logger.info(
        { mopId: product.mopId.toString(), orderId: product.mopOrderId, updatedStatus },
        'OnBuy status pushed successfully'
      );
      return { success: true, mopId: mopIdNumber, status: updatedStatus };
    }

    logger.error(
      { mopId: product.mopId.toString(), orderId: product.mopOrderId, status: apiResult.status, body: apiResult.body },
      'OnBuy status push failed'
    );

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Failed - Order ${product.mopOrderId}`,
      `Hi Team,<br><br>OnBuy order status update failed.<br><b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br><b>Status to push:</b> ${escapeHtml(statusToUpdate)}<br><b>HTTP Status:</b> ${apiResult.status}<br><b>Response:</b> ${escapeHtml(apiResult.body.slice(0, 1000))}`,
      {
        executionId,
        mopId: product.mopId.toString(),
        orderId: product.mopOrderId,
        statusToUpdate,
        httpStatus: apiResult.status,
      }
    );

    return {
      success: false,
      mopId: mopIdNumber,
      status: statusToUpdate,
      error: `HTTP ${apiResult.status}`,
    };
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error(
      { error: serializeError(error), mopId: product.mopId.toString(), orderId: product.mopOrderId },
      'Exception pushing OnBuy status'
    );

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Exception - Order ${product.mopOrderId}`,
      `Hi Team,<br><br>Exception pushing OnBuy status.<br><b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, mopId: product.mopId.toString(), orderId: product.mopOrderId, error: msg }
    );

    return { success: false, mopId: mopIdNumber, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending OnBuy status updates.
 */
export async function updateOnbuyOrderStatusesToOnbuy(): Promise<BatchUpdateOnbuyOrderStatusResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('onbuy-status-update-service');

  logger.info('Starting OnBuy status push');

  try {
    const pendingProducts = (await getOrderProductDetails([ONBUY_STORE_ID], logger)) as PendingProduct[];
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending OnBuy status updates');

    if (pendingProducts.length === 0) {
      const result: StatusPushResult = {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        duration: Date.now() - startTime,
      };
      logStatusPushSummary(logger, result);
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    const onbuyClient = createOnBuyClient('onbuy');
    const accessToken = await onbuyClient.fetchAccessToken(executionId);

    const results: Array<UpdateOnbuyOrderStatusResult & { orderId: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const product of pendingProducts) {
      const result = await processPendingProduct(product, accessToken, executionId, logger);
      results.push({ ...result, orderId: product.mopOrderId || '' });

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    const summary: StatusPushResult = {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results: results.map((r) => ({
        mopId: r.mopId,
        orderId: r.orderId,
        status: r.status,
        success: r.success,
        error: r.error,
      })),
      duration: Date.now() - startTime,
    };
    logStatusPushSummary(logger, summary);

    return {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results,
    };
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error) }, 'Batch OnBuy status push failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Batch Status Update Failed',
      `Hi Team,<br><br>Batch OnBuy status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
