/**
 * Seller Dynamics Status Update Service — Stage 5
 *
 * Pushes UKSS order status changes back to the Seller Dynamics API.
 *
 * Cron: every 15 minutes
 *
 * Behavior:
 *   - SHIPPED → call UpdateOrdersWithTracking with Courier=Other,
 *     OtherCourier from mop_ukss_shipping_carrier, tracking from mop_ukss_tracking_code.
 *   - Cancel/Reject → send email to Simon for manual handling on SD dashboard.
 *     No automated REFUNDED push. Sets mop_api_response = 'Need to update manually'.
 *   - One API call per pending MOP row (same as OnBuy — no order-level dedup).
 */

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createSellerDynamicsClient } from '../../lib/marketplaces/seller-dynamics/client';
import {
  createExecutionContext,
  logStatusPushSummary,
  sendOrderFailureEmail,
  sendOrderCancellationRequest,
  serializeError,
  getErrorMessage,
  getOrderProductDetails,
  type StatusPushResult,
  OrderStatus,
  ApiResponseStatus,
} from '../marketplaces/orders';
import type {
  BatchUpdateSdOrderStatusResult,
  UpdateSdOrderStatusResult,
  SdOrderUpdateItem,
} from './sd-order-types';

const MARKETPLACE_NAME = 'Seller Dynamics';
const SD_STORE_ID = config.SELLER_DYNAMICS_STORE_ID;
const RECORD_VERSION_PLACEHOLDER = 'AAAAAAAAAAA=';

// Extra recipients for cancel/reject notifications only (e.g. Simon). Comma-separated env var.
const CANCEL_REJECT_EMAILS = (config.SELLER_DYNAMICS_CANCEL_REJECT_EMAILS || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

interface PendingProduct {
  mopId: bigint;
  mopOrderId: string | null;
  mopProductId: string | null;
  mopProductSku: string | null;
  mopProductQuantity: bigint | null;
  mopOrderStatusToUpdate: string | null;
  mopUkssTrackingCode: string | null;
  mopUkssShippingCarrier: string | null;
}

/**
 * Push SHIPPED status to SD for a single MOP row.
 */
async function pushShippedToSd(
  product: PendingProduct,
  logger: ReturnType<typeof createExecutionContext>['logger'],
): Promise<{ success: boolean; error?: string }> {
  const goodsPurchasedId = product.mopProductId;
  if (!goodsPurchasedId) {
    return { success: false, error: 'Missing GoodsPurchasedId (mop_product_id)' };
  }

  const client = createSellerDynamicsClient();

  const item: SdOrderUpdateItem = {
    GoodsPurchasedId: goodsPurchasedId,
    Courier: 'Other',
    OtherCourier: product.mopUkssShippingCarrier || '',
    ShippingMethod: product.mopUkssShippingCarrier || '',
    TrackingNumber: product.mopUkssTrackingCode || '',
    RecordVersion: RECORD_VERSION_PLACEHOLDER,
  };

  logger.info(
    { mopId: product.mopId.toString(), orderId: product.mopOrderId, goodsPurchasedId },
    'Pushing SHIPPED to SD',
  );

  return client.updateOrdersWithTracking([item], 'SHIPPED');
}

/**
 * Handle cancel/reject by emailing Simon for manual intervention.
 */
async function handleCancelReject(
  product: PendingProduct,
  executionId: string,
  logger: ReturnType<typeof createExecutionContext>['logger'],
): Promise<void> {
  logger.info(
    { mopId: product.mopId.toString(), orderId: product.mopOrderId, status: product.mopOrderStatusToUpdate },
    'Cancel/reject order — sending email for manual handling',
  );

  await sendOrderCancellationRequest(
    MARKETPLACE_NAME,
    `Order Requires Manual Action - Order ${product.mopOrderId}`,
    `Hi Simon,<br><br>A Seller Dynamics order requires manual action on the SD dashboard.<br><br>` +
    `<b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br>` +
    `<b>SKU:</b> ${escapeHtml(product.mopProductSku || '')}<br>` +
    `<b>Status to update:</b> ${escapeHtml(product.mopOrderStatusToUpdate || '')}<br>` +
    `<b>GoodsPurchasedId:</b> ${escapeHtml(product.mopProductId || '')}<br><br>` +
    `Please update the order status on the Seller Dynamics dashboard manually.`,
    {
      executionId,
      mopId: product.mopId.toString(),
      orderId: product.mopOrderId,
      statusToUpdate: product.mopOrderStatusToUpdate,
    },
    CANCEL_REJECT_EMAILS,
  );

  await prisma.mopMarketplaceOrderProduct.update({
    where: { mopId: product.mopId },
    data: {
      // Mark the order terminal so Stage 4 (order-status-sync) cannot re-select
      // this row and reset mop_api_response back to 'Waiting'. Without this the
      // rejected/cancelled box keeps re-triggering the manual-action email every
      // cron tick (PMS #166251). 'Cancelled' is the terminal value Stage 4
      // excludes ('Shipped'/'Cancelled'/'Return'); 'Rejected' is NOT excluded,
      // so cancel and reject both settle on CANCELLED — matching the eBay and
      // Sportdeal cancel paths.
      mopOrderStatusOfOrder: OrderStatus.CANCELLED,
      mopApiResponse: ApiResponseStatus.MANUAL_UPDATE,
    },
  });
}

/**
 * Process a single pending MOP row.
 */
async function processPendingProduct(
  product: PendingProduct,
  executionId: string,
  logger: ReturnType<typeof createExecutionContext>['logger'],
): Promise<UpdateSdOrderStatusResult> {
  const statusToUpdate = (product.mopOrderStatusToUpdate || '').toLowerCase();
  const mopIdNumber = Number(product.mopId);

  if (!statusToUpdate) {
    logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
    return { success: false, mopId: mopIdNumber, status: '', error: 'Empty status' };
  }

  try {
    if (statusToUpdate === 'dispatched' || statusToUpdate === 'shipped') {
      const apiResult = await pushShippedToSd(product, logger);

      if (apiResult.success) {
        await prisma.mopMarketplaceOrderProduct.update({
          where: { mopId: product.mopId },
          data: {
            mopOrderStatusOfOrder: OrderStatus.SHIPPED,
            mopApiResponse: ApiResponseStatus.SUCCESS,
          },
        });
        logger.info(
          { mopId: product.mopId.toString(), orderId: product.mopOrderId },
          'SD status pushed successfully',
        );
        return { success: true, mopId: mopIdNumber, status: OrderStatus.SHIPPED };
      }

      logger.error(
        { mopId: product.mopId.toString(), orderId: product.mopOrderId, error: apiResult.error },
        'SD status push failed',
      );

      await sendOrderFailureEmail(
        MARKETPLACE_NAME,
        `Order Status Update Failed - Order ${product.mopOrderId}`,
        `Hi Team,<br><br>Seller Dynamics order status update failed.<br>` +
        `<b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br>` +
        `<b>Status to push:</b> ${escapeHtml(statusToUpdate)}<br>` +
        `<b>Error:</b> ${escapeHtml(apiResult.error || 'Unknown')}`,
        {
          executionId,
          mopId: product.mopId.toString(),
          orderId: product.mopOrderId,
          statusToUpdate,
          error: apiResult.error,
        },
      );

      return {
        success: false,
        mopId: mopIdNumber,
        status: statusToUpdate,
        error: apiResult.error,
      };
    }

    if (statusToUpdate === 'cancelled' || statusToUpdate === 'rejected') {
      await handleCancelReject(product, executionId, logger);
      return { success: true, mopId: mopIdNumber, status: statusToUpdate };
    }

    logger.warn(
      { mopId: product.mopId.toString(), orderId: product.mopOrderId, statusToUpdate },
      'Unmapped status for SD push; skipping',
    );
    return {
      success: false,
      mopId: mopIdNumber,
      status: statusToUpdate,
      error: `Unmapped status '${statusToUpdate}' (only 'dispatched'/'shipped'/'cancelled'/'rejected' supported)`,
    };
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error(
      { error: serializeError(error), mopId: product.mopId.toString(), orderId: product.mopOrderId },
      'Exception pushing SD status',
    );

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Exception - Order ${product.mopOrderId}`,
      `Hi Team,<br><br>Exception pushing Seller Dynamics status.<br>` +
      `<b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br>` +
      `<b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, mopId: product.mopId.toString(), orderId: product.mopOrderId, error: msg },
    );

    return { success: false, mopId: mopIdNumber, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending SD status updates.
 */
export async function updateSdOrderStatuses(): Promise<BatchUpdateSdOrderStatusResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('sd-status-update-service');

  logger.info('Starting Seller Dynamics status push');

  try {
    if (!SD_STORE_ID) {
      const msg = 'SELLER_DYNAMICS_STORE_ID is not configured';
      logger.error(msg);
      return { success: false, processed: 0, succeeded: 0, failed: 0, results: [], error: msg };
    }

    const pendingProducts = (await getOrderProductDetails([SD_STORE_ID], logger)) as PendingProduct[];
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending SD status updates');

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

    const results: Array<UpdateSdOrderStatusResult & { orderId: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const product of pendingProducts) {
      const result = await processPendingProduct(product, executionId, logger);
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
    logger.error({ error: serializeError(error) }, 'Batch SD status push failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Batch Status Update Failed',
      `Hi Team,<br><br>Batch Seller Dynamics status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg },
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
