/**
 * Walmart Status Update Service — Stage 6
 *
 * Pushes UKSS order status changes (Confirmed / Shipped / Cancelled) back to the Walmart
 * Marketplace API.
 *
 * Cron: every 15 minutes (host-side cron, not in this repo)
 *
 * Behavior (legacy parity, order_status_managment_controller.php case '140', lines 1247-1492):
 *   - One POST per pending MOP row (NO order-level dedup; legacy fires per-row)
 *   - status `'acknowledged'` → POST /v3/orders/{id}/acknowledge (empty body) → 'Confirmed'
 *   - status `'cancelled'`    → POST /v3/orders/{id}/cancel    (orderCancellation JSON) → 'Cancelled'
 *   - status `'shipped'`      → POST /v3/orders/{id}/shipping  (orderShipment JSON)     → 'Shipped'
 *   - any other status        → log warning + skip (improvement over legacy silent fall-through)
 *
 *   PM #164896 (customer cancellation override):
 *     When `mop.customer_cancellation_request='1'`:
 *       - cancel reason becomes 'CUSTOMER_REQUESTED_SELLER_TO_CANCEL'
 *       - ship payload sets `intentToCancelOverride: true`
 *       - on successful ship, override-shipped email sent to WALMART_CANCELLATION_OVERRIDE_EMAIL
 *
 *   - On HTTP 200: write back mop_order_status_of_order = 'Confirmed' / 'Shipped' / 'Cancelled',
 *     mop_api_response = 'Success'
 *   - On non-200: leave mop_api_response = 'Waiting', send dev email
 */

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createWalmartClient, type WalmartClient } from '../../lib/marketplaces/walmart/client';
import {
  WALMART_CANCELLATION_REASON,
  WALMART_UOM_CANCEL,
  WALMART_UOM_SHIP,
  WALMART_CARRIER_MAP,
} from './walmart-api.types';
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
  BatchUpdateWalmartOrderStatusResult,
  UpdateWalmartOrderStatusResult,
} from './walmart-schema';

const MARKETPLACE_NAME = 'Walmart';
const WALMART_STORE_ID = config.WALMART_STORE_ID;

interface PendingProduct {
  mopId: bigint;
  mopOrderId: string | null;
  mopProductId: string | null; // Walmart's lineNumber
  mopProductSku: string | null;
  /** Prisma maps mop_product_quantity (BigInt? in schema) to JS bigint. JSON-stringify cannot
   *  serialize bigint; coerce via Number() before putting in any request body. */
  mopProductQuantity: bigint | null;
  mopOrderStatusToUpdate: string | null;
  mopUkssOrdersProductsId: number | null; // sellerOrderId on shipment payload
  mopUkssTrackingCode: string | null;
  mopUkssShippingCarrier: string | null;
  customerCancellationRequest: string; // PM #164896 — '0' or '1'
  cancellationRequestDate: Date | null; // PM #164896
}

interface ApiCallResult {
  success: boolean;
  status: number;
  body: string;
}

/**
 * Map UKSS internal carrier slug to Walmart canonical name; pass through unmapped values.
 * Returns null only when input is null/undefined — matches legacy where `$tracking_company`
 * stays untouched and `json_encode` preserves null. Empty-string passes through as "".
 */
function mapCarrier(carrierSlug: string | null | undefined): string | null {
  if (carrierSlug == null) return null;
  if (carrierSlug === '') return '';
  const lower = carrierSlug.toLowerCase();
  return WALMART_CARRIER_MAP[lower] ?? carrierSlug;
}

/** Resolve cancellation reason + override flag from PM #164896 customer-cancellation column. */
function resolveCancellationContext(customerCancellationRequest: string): {
  cancellationReason: string;
  intentToCancelOverride: boolean;
} {
  if (customerCancellationRequest === '1') {
    return {
      cancellationReason: WALMART_CANCELLATION_REASON.CUSTOMER_REQUESTED_SELLER_TO_CANCEL,
      intentToCancelOverride: true,
    };
  }
  return {
    cancellationReason: WALMART_CANCELLATION_REASON.SELLER_CANCEL_OUT_OF_STOCK,
    intentToCancelOverride: false,
  };
}

/**
 * Acknowledge order line. Legacy: order_status_managment_controller.php:1286-1292.
 * POST /v3/orders/{purchaseOrderId}/acknowledge with empty body.
 */
async function pushAcknowledgeToWalmart(
  product: PendingProduct,
  client: WalmartClient,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<ApiCallResult> {
  const url = `${client.getBaseUrl()}/v3/orders/${product.mopOrderId}/acknowledge`;
  const correlationId = client.generateCorrelationId('WALMART_ACK');

  logger.info(
    { mopId: product.mopId.toString(), orderId: product.mopOrderId, correlationId },
    'POST Walmart acknowledge'
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...client.buildApiHeaders(accessToken, correlationId),
      'Content-Type': 'application/json',
    },
    // Walmart requires no body for acknowledge — legacy sends ''.
    body: '',
  });

  const body = await response.text();
  return { success: response.status === 200, status: response.status, body };
}

/**
 * Cancel order line. Legacy: order_status_managment_controller.php:1295-1318.
 * POST /v3/orders/{purchaseOrderId}/cancel with `orderCancellation` JSON.
 */
async function pushCancelToWalmart(
  product: PendingProduct,
  client: WalmartClient,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<ApiCallResult> {
  const url = `${client.getBaseUrl()}/v3/orders/${product.mopOrderId}/cancel`;
  const correlationId = client.generateCorrelationId('WALMART_CANCEL');
  const { cancellationReason } = resolveCancellationContext(product.customerCancellationRequest);

  const requestBody = {
    orderCancellation: {
      orderLines: {
        orderLine: [
          {
            lineNumber: product.mopProductId,
            orderLineStatuses: {
              orderLineStatus: [
                {
                  status: 'Cancelled',
                  cancellationReason,
                  statusQuantity: {
                    // Legacy uses 'EA' on cancel (line 1308) — different from ship's 'EACH'.
                    unitOfMeasurement: WALMART_UOM_CANCEL,
                    // Legacy serializes amount as a string ("1"). Preserve null-passthrough
                    // when quantity is missing — PHP json_encode emits JSON null, not "0".
                    amount:
                      product.mopProductQuantity == null
                        ? null
                        : String(Number(product.mopProductQuantity)),
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  logger.info(
    {
      mopId: product.mopId.toString(),
      orderId: product.mopOrderId,
      cancellationReason,
      correlationId,
    },
    'POST Walmart cancel'
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...client.buildApiHeaders(accessToken, correlationId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  return { success: response.status === 200, status: response.status, body };
}

/**
 * Ship order line. Legacy: order_status_managment_controller.php:1320-1353.
 * POST /v3/orders/{purchaseOrderId}/shipping with `orderShipment` JSON. Includes
 * `intentToCancelOverride` (PM #164896) when customer cancellation was overridden.
 */
async function pushShipToWalmart(
  product: PendingProduct,
  client: WalmartClient,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<ApiCallResult> {
  const url = `${client.getBaseUrl()}/v3/orders/${product.mopOrderId}/shipping`;
  const correlationId = client.generateCorrelationId('WALMART_SHIP');
  const { intentToCancelOverride } = resolveCancellationContext(product.customerCancellationRequest);

  const carrierName = mapCarrier(product.mopUkssShippingCarrier);

  const requestBody = {
    orderShipment: {
      orderLines: {
        orderLine: [
          {
            lineNumber: product.mopProductId,
            // PM #164896 — true when the customer-cancellation flag was set on this row.
            intentToCancelOverride,
            // Legacy uses ukss_order_product_id here, serialized as a string. Line 1329.
            // Preserve null when missing — matches PHP `json_encode(null)` → JSON null,
            // not the literal string "null" that `String(null)` would produce.
            sellerOrderId:
              product.mopUkssOrdersProductsId == null
                ? null
                : String(product.mopUkssOrdersProductsId),
            orderLineStatuses: {
              orderLineStatus: [
                {
                  status: 'Shipped',
                  statusQuantity: {
                    // Legacy uses 'EACH' on ship (line 1334) — different from cancel's 'EA'.
                    unitOfMeasurement: WALMART_UOM_SHIP,
                    // Legacy serializes amount as a string ("1"). Preserve null-passthrough
                    // when quantity is missing — PHP json_encode emits JSON null, not "0".
                    amount:
                      product.mopProductQuantity == null
                        ? null
                        : String(Number(product.mopProductQuantity)),
                  },
                  trackingInfo: {
                    // Walmart wants Unix milliseconds. Legacy: strtotime() * 1000 (line 1338).
                    shipDateTime: Date.now(),
                    carrierName: { carrier: carrierName },
                    methodCode: 'Standard',
                    trackingNumber: product.mopUkssTrackingCode,
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  logger.info(
    {
      mopId: product.mopId.toString(),
      orderId: product.mopOrderId,
      intentToCancelOverride,
      carrier: carrierName,
      correlationId,
    },
    'POST Walmart ship'
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...client.buildApiHeaders(accessToken, correlationId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  return { success: response.status === 200, status: response.status, body };
}

/**
 * PM #164896 — send the override-shipped notification email to client + ops list.
 *
 * Triggered when an order is force-shipped despite a customer cancellation request.
 *
 * Uses the shared `sendOrderCancellationRequest()` helper (the neutral "Action Required"
 * template, same one Seller Dynamics/Debenhams use for manual-action notifications) instead of
 * raw HTML, so the styling stays consistent. The override recipients
 * (`WALMART_CANCELLATION_OVERRIDE_EMAIL`) are passed as `additionalRecipients`; the helper also
 * always copies the dev team.
 */
async function sendOverrideShippedEmail(
  product: PendingProduct,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<void> {
  const additionalRecipients = config.WALMART_CANCELLATION_OVERRIDE_EMAIL.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const orderStatusUpdateTime = new Date().toISOString();
  const cancellationCapturedTime = product.cancellationRequestDate
    ? product.cancellationRequestDate.toISOString()
    : 'N/A';

  const message = `This is to inform you that the following Walmart order was <b>forcefully marked as Shipped</b> despite an existing cancellation request from the customer. The cancellation override was sent to Walmart and the order has been shipped successfully.<br><br>
<b>Walmart Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br>
<b>Line Item ID:</b> ${escapeHtml(product.mopProductId || '')}<br>
<b>UKSS Order Product ID:</b> ${escapeHtml(String(product.mopUkssOrdersProductsId ?? ''))}<br>
<b>Order Status Update Time:</b> ${escapeHtml(orderStatusUpdateTime)}<br>
<b>Cancellation Request Captured Time:</b> ${escapeHtml(cancellationCapturedTime)}`;

  try {
    await sendOrderCancellationRequest(
      MARKETPLACE_NAME,
      `Order Shipped Despite Cancellation Request - Order ID: ${product.mopOrderId ?? ''}`,
      message,
      {
        mopId: product.mopId.toString(),
        orderId: product.mopOrderId,
        lineItemId: product.mopProductId,
        ukssOrderProductId: product.mopUkssOrdersProductsId,
        orderStatusUpdateTime,
        cancellationCapturedTime,
      },
      additionalRecipients
    );
    logger.info(
      { mopId: product.mopId.toString(), orderId: product.mopOrderId, additionalRecipients },
      'Override-shipped notification email sent'
    );
  } catch (error) {
    logger.error(
      { error: serializeError(error), mopId: product.mopId.toString() },
      'Failed to send override-shipped notification email'
    );
  }
}

/**
 * Process a single pending MOP row.
 *
 * No order-level dedup: legacy fires one API call per row.
 */
async function processPendingProduct(
  product: PendingProduct,
  client: WalmartClient,
  accessToken: string,
  executionId: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<UpdateWalmartOrderStatusResult> {
  const statusToUpdate = (product.mopOrderStatusToUpdate || '').toLowerCase();
  const mopIdNumber = Number(product.mopId);

  if (!statusToUpdate) {
    logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
    return { success: false, mopId: mopIdNumber, status: '', error: 'Empty status' };
  }

  try {
    let apiResult: ApiCallResult;
    let updatedStatus: string;

    if (statusToUpdate === 'acknowledged') {
      apiResult = await pushAcknowledgeToWalmart(product, client, accessToken, logger);
      updatedStatus = OrderStatus.CONFIRMED;
    } else if (statusToUpdate === 'cancelled') {
      apiResult = await pushCancelToWalmart(product, client, accessToken, logger);
      updatedStatus = OrderStatus.CANCELLED;
    } else if (statusToUpdate === 'shipped') {
      apiResult = await pushShipToWalmart(product, client, accessToken, logger);
      updatedStatus = OrderStatus.SHIPPED;
    } else {
      // Legacy silently falls through and would send a request with no body. We log + skip
      // instead so the dev sees the unmapped status in cron output and can fix the muosm mapping.
      logger.warn(
        { mopId: product.mopId.toString(), orderId: product.mopOrderId, statusToUpdate },
        'Unmapped status for Walmart push; skipping'
      );
      return {
        success: false,
        mopId: mopIdNumber,
        status: statusToUpdate,
        error: `Unmapped status '${statusToUpdate}' (only 'acknowledged' / 'cancelled' / 'shipped' supported for Walmart)`,
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
        'Walmart status pushed successfully'
      );

      // PM #164896 — fire override-shipped email when ship succeeded with cancellation override.
      if (statusToUpdate === 'shipped' && product.customerCancellationRequest === '1') {
        await sendOverrideShippedEmail(product, logger);
      }

      return { success: true, mopId: mopIdNumber, status: updatedStatus };
    }

    logger.error(
      {
        mopId: product.mopId.toString(),
        orderId: product.mopOrderId,
        status: apiResult.status,
        body: apiResult.body,
      },
      'Walmart status push failed'
    );

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Failed - Order ${product.mopOrderId}`,
      `Hi Team,<br><br>Walmart order status update failed.<br><b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br><b>Status to push:</b> ${escapeHtml(statusToUpdate)}<br><b>HTTP Status:</b> ${apiResult.status}<br><b>Response:</b> ${escapeHtml(apiResult.body.slice(0, 1000))}`,
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
      'Exception pushing Walmart status'
    );

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Exception - Order ${product.mopOrderId}`,
      `Hi Team,<br><br>Exception pushing Walmart status.<br><b>Order ID:</b> ${escapeHtml(product.mopOrderId || '')}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, mopId: product.mopId.toString(), orderId: product.mopOrderId, error: msg }
    );

    return { success: false, mopId: mopIdNumber, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending Walmart status updates.
 */
export async function updateWalmartOrderStatusesToWalmart(): Promise<BatchUpdateWalmartOrderStatusResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('walmart-status-update-service');

  logger.info('Starting Walmart status push');

  try {
    const pendingProducts = (await getOrderProductDetails([WALMART_STORE_ID], logger)) as PendingProduct[];
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending Walmart status updates');

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

    const walmartClient = createWalmartClient();
    const accessToken = await walmartClient.fetchAccessToken(executionId);

    const results: Array<UpdateWalmartOrderStatusResult & { orderId: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const product of pendingProducts) {
      const result = await processPendingProduct(product, walmartClient, accessToken, executionId, logger);
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
    logger.error({ error: serializeError(error) }, 'Batch Walmart status push failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Batch Status Update Failed',
      `Hi Team,<br><br>Batch Walmart status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
