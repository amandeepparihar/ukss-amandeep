/**
 * Allegro Status Update Service
 *
 * Pushes order status updates back to the Allegro API.
 *
 * Pipeline: Stage 6 (Status Push)
 * Cron: `pnpm cli update-allegro-orders-status`
 *
 * Flow:
 *   1. Query mop_marketplace_order_products for pending Allegro status updates
 *   2. For each product:
 *      - 'Confirmed' / 'SENT' → POST shipment + PUT fulfillment SENT
 *      - 'Cancelled' / 'CANCELED' → PUT fulfillment CANCELLED
 *      - Any other valid Allegro fulfillment status (PROCESSING, READY_FOR_PICKUP, etc.)
 *        → PUT fulfillment with that status
 *      - Unknown status → mark for manual intervention
 *   3. Deduplication: one API call per order ID (not per product)
 *
 * Allegro two-step status update:
 *   Step 1: POST /order/checkout-forms/{id}/shipments — add tracking info
 *   Step 2: PUT /order/checkout-forms/{id}/fulfillment — set status to SENT
 *
 * WHY: Content-Type must be application/vnd.allegro.public.v1+json
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
import { getValidAllegroAccessToken } from '../../lib/allegro/allegro-order-data.utils';
import {
  ALLEGRO_CONTENT_TYPE,
  ALLEGRO_FULFILLMENT_STATUS_MAP,
  type AllegroAddShipmentRequest,
  type AllegroFulfillmentUpdateRequest,
  type AllegroFulfillmentStatus,
  type AllegroCarriersResponse,
} from './allegro-api.types';
import type {
  UpdateAllegroOrderStatusInput,
  UpdateAllegroOrderStatusResult,
  BatchUpdateAllegroOrderStatusResult,
} from './allegro-schema';

const MARKETPLACE_NAME = 'Allegro';

/**
 * Fetch the list of valid carrier IDs from Allegro's API.
 *
 * GET /order/carriers returns all carriers Allegro recognises.
 * We build a lowercase→actual-ID lookup map so we can match our DB values
 * (which may be any casing) to the exact ID Allegro expects.
 *
 * @returns Map of lowercase carrier ID → Allegro's actual carrier ID
 */
async function fetchAllegroCarrierMap(
  httpClient: ReturnType<typeof createOrderHttpClient>,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<Map<string, string>> {
  const apiBaseUrl = config.ALLEGRO_API_BASE_URL || 'https://api.allegro.pl';
  const url = `${apiBaseUrl}/order/carriers`;

  try {
    const response = await httpClient.get<AllegroCarriersResponse>(url, {
      headers: {
        'Accept': ALLEGRO_CONTENT_TYPE,
      },
    });

    const carrierMap = new Map<string, string>();
    for (const carrier of response.data.carriers) {
      carrierMap.set(carrier.id.toLowerCase(), carrier.id);
    }

    logger.info({ carrierCount: carrierMap.size }, 'Fetched Allegro carrier list');
    return carrierMap;
  } catch (error) {
    logger.warn({ error: serializeError(error) }, 'Failed to fetch Allegro carriers, will use OTHER as fallback');
    return new Map();
  }
}

/**
 * Resolve a UKSS shipping carrier value to a valid Allegro carrier ID.
 *
 * Compares by lowercasing both sides so 'inpost', 'InPost', 'INPOST' all match.
 * Falls back to 'OTHER' if no match found.
 */
function resolveCarrierId(
  ukssCarrier: string | null,
  allegroCarrierMap: Map<string, string>
): { carrierId: string; carrierName?: string } {
  if (!ukssCarrier) {
    return { carrierId: 'OTHER', carrierName: 'Standard Shipping' };
  }

  const matched = allegroCarrierMap.get(ukssCarrier.toLowerCase());
  if (matched) {
    return { carrierId: matched };
  }

  // No match — use OTHER and pass the original carrier name so it still shows on Allegro
  return { carrierId: 'OTHER', carrierName: ukssCarrier };
}

/**
 * Update an Allegro order's fulfillment status.
 *
 * Handles all Allegro fulfillment statuses via a single function:
 *   - SENT: optionally adds shipment tracking (POST /shipments) before updating fulfillment
 *   - All others (PROCESSING, READY_FOR_PICKUP, CANCELLED, etc.): direct PUT /fulfillment
 *
 * @param orderId - Allegro checkout form ID
 * @param status - Target Allegro fulfillment status
 * @param shipment - Optional shipment tracking info (only used when status is SENT)
 * @param httpClient - Configured HTTP client
 * @param logger - Logger instance
 */
async function updateAllegroFulfillment(
  orderId: string,
  status: AllegroFulfillmentStatus,
  shipment: { trackingCode: string | null; shippingCarrier: string | null } | null,
  httpClient: ReturnType<typeof createOrderHttpClient>,
  allegroCarrierMap: Map<string, string>,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; error?: string }> {
  const apiBaseUrl = config.ALLEGRO_API_BASE_URL;

  if (!apiBaseUrl) {
    return { success: false, error: 'ALLEGRO_API_BASE_URL not configured' };
  }

  try {
    // Step 1: Add shipment tracking when shipping (SENT) and tracking is available
    if (status === 'SENT' && shipment?.trackingCode) {
      const shipmentUrl = `${apiBaseUrl}/order/checkout-forms/${orderId}/shipments`;
      // Resolve UKSS carrier to a valid Allegro carrier ID by matching against
      // the live carrier list from GET /order/carriers (case-insensitive).
      const resolved = resolveCarrierId(shipment.shippingCarrier, allegroCarrierMap);
      const shipmentBody: AllegroAddShipmentRequest = {
        carrierId: resolved.carrierId,
        waybill: shipment.trackingCode,
      };

      if (resolved.carrierName) {
        shipmentBody.carrierName = resolved.carrierName;
      }

      logger.info({ orderId, shipmentUrl, carrierId: shipmentBody.carrierId }, 'Adding shipment tracking to Allegro order');

      await httpClient.post(shipmentUrl, shipmentBody, {
        headers: {
          'Content-Type': ALLEGRO_CONTENT_TYPE,
          'Accept': ALLEGRO_CONTENT_TYPE,
        },
      });

      logger.info({ orderId }, 'Shipment tracking added successfully');
    }

    // Step 2: Update fulfillment status
    const fulfillmentUrl = `${apiBaseUrl}/order/checkout-forms/${orderId}/fulfillment`;
    const fulfillmentBody: AllegroFulfillmentUpdateRequest = { status };

    // SENT needs shipmentSummary to indicate all items are shipped
    if (status === 'SENT') {
      fulfillmentBody.shipmentSummary = { lineItemsSent: 'ALL' };
    }

    logger.info({ orderId, fulfillmentUrl, status }, 'Updating Allegro order fulfillment status');

    await httpClient.put(fulfillmentUrl, fulfillmentBody, {
      headers: {
        'Content-Type': ALLEGRO_CONTENT_TYPE,
        'Accept': ALLEGRO_CONTENT_TYPE,
      },
    });

    logger.info({ orderId, status }, 'Allegro order fulfillment status updated');
    return { success: true };

  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ orderId, status, error: serializeError(error) }, 'Failed to update Allegro order fulfillment status');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Status Update Failed - Order ${orderId}`,
      `Hi Team,<br><br>Failed to update fulfillment status for Allegro order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Status:</b> ${escapeHtml(status)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { orderId, status, error: msg }
    );

    return { success: false, error: msg };
  }
}

/**
 * Process a single product's status update.
 *
 * WHY: Deduplication uses a Map<orderId, resolvedStatus> because one Allegro order
 * can have multiple products. We only call the API once per order,
 * then mark all remaining products for the same order with the same resolved status.
 */
async function updateAllegroOrderStatus(
  input: UpdateAllegroOrderStatusInput,
  processedOrders: Map<string, string>,
  httpClient: ReturnType<typeof createOrderHttpClient>,
  allegroCarrierMap: Map<string, string>,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<UpdateAllegroOrderStatusResult> {
  const { mopId, orderId, statusToUpdate } = input;

  logger.info({ mopId, orderId, statusToUpdate }, 'Processing product status update');

  try {
    // Dedup: if this order was already processed, just mark this product
    const alreadyResolvedStatus = processedOrders.get(orderId);
    if (alreadyResolvedStatus) {
      logger.debug({ mopId, orderId, status: alreadyResolvedStatus }, 'Order already processed, marking product');

      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: BigInt(mopId) },
        data: {
          mopOrderStatusOfOrder: alreadyResolvedStatus,
          mopApiResponse: ApiResponseStatus.SUCCESS,
        },
      });

      return { success: true, mopId, status: alreadyResolvedStatus };
    }

    // Resolve the Allegro fulfillment status from the pipeline status value.
    // WHY: The status sync service writes muosm_mo_status which may be
    // Allegro-native (e.g. 'SENT', 'PROCESSING') or shared pipeline values
    // (e.g. 'Confirmed', 'Cancelled'). We normalise both to Allegro statuses.
    const upperStatus = statusToUpdate.toUpperCase();
    let allegroStatus: AllegroFulfillmentStatus | null = null;

    if (statusToUpdate === OrderStatus.CONFIRMED || upperStatus === 'SENT') {
      allegroStatus = 'SENT';
    } else if (statusToUpdate === OrderStatus.CANCELLED || upperStatus === 'CANCELED' || upperStatus === 'CANCELLED') {
      allegroStatus = 'CANCELLED';
    } else if (upperStatus in ALLEGRO_FULFILLMENT_STATUS_MAP) {
      allegroStatus = upperStatus as AllegroFulfillmentStatus;
    }

    if (!allegroStatus) {
      // Truly unknown status: no matching Allegro fulfillment status — mark for manual intervention
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: BigInt(mopId) },
        data: {
          mopOrderStatusOfOrder: statusToUpdate,
          mopApiResponse: ApiResponseStatus.MANUAL_UPDATE,
        },
      });

      logger.info({ mopId, orderId, statusToUpdate }, 'Marked for manual update (unknown Allegro status)');
      return { success: true, mopId, status: statusToUpdate };
    }

    // For SENT, fetch shipment tracking info to include in the API call
    let shipment: { trackingCode: string | null; shippingCarrier: string | null } | null = null;
    if (allegroStatus === 'SENT') {
      const mopRecord = await prisma.mopMarketplaceOrderProduct.findUnique({
        where: { mopId: BigInt(mopId) },
        select: {
          mopUkssTrackingCode: true,
          mopUkssShippingCarrier: true,
        },
      });
      shipment = {
        trackingCode: mopRecord?.mopUkssTrackingCode || null,
        shippingCarrier: mopRecord?.mopUkssShippingCarrier || null,
      };
    }

    const result = await updateAllegroFulfillment(orderId, allegroStatus, shipment, httpClient, allegroCarrierMap, logger);

    if (result.success) {
      // Determine the status to store in MOP after a successful API call.
      // SENT and CANCELLED map to pipeline-level final statuses (Shipped/Cancelled).
      const resolvedMopStatus = allegroStatus === 'SENT'
        ? OrderStatus.SHIPPED
        : allegroStatus === 'CANCELLED'
          ? OrderStatus.CANCELLED
          : statusToUpdate;

      await prisma.mopMarketplaceOrderProduct.updateMany({
        where: { mopOrderId: orderId },
        data: {
          mopOrderStatusOfOrder: resolvedMopStatus,
          mopApiResponse: ApiResponseStatus.SUCCESS,
        },
      });

      processedOrders.set(orderId, resolvedMopStatus);
      logger.info({ mopId, orderId, allegroStatus, resolvedMopStatus }, 'Order status updated on Allegro');

      return { success: true, mopId, status: resolvedMopStatus };
    } else {
      logger.error({ mopId, orderId, allegroStatus, error: result.error }, 'Order status update failed');
      return { success: false, mopId, status: statusToUpdate, error: result.error };
    }
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error), mopId, orderId }, 'Exception updating product status');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Status Update Exception',
      `Hi Team,<br><br>Exception updating Allegro order status.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { mopId, orderId, error: msg }
    );

    return { success: false, mopId, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending Allegro status updates.
 *
 * Pipeline: Stage 6 (Status Push)
 * Cron: `pnpm cli update-allegro-orders-status`
 *
 * @returns Batch result with counts and per-product details
 */
export async function updateAllegroOrderStatusesToAllegro(): Promise<BatchUpdateAllegroOrderStatusResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('allegro-status-update-service');

  logger.info('Starting batch Allegro status push');

  try {
    const storeId = config.ALLEGRO_STORE_ID;
    if (!storeId) {
      logger.warn('ALLEGRO_STORE_ID not configured, skipping');
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    const pendingProducts = await getOrderProductDetails([storeId], logger);
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending status updates');

    if (pendingProducts.length === 0) {
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    // Get valid OAuth access token
    const accessToken = await getValidAllegroAccessToken(storeId);

    // Rate limiter
    const rateLimiter = new RateLimiter({
      strategy: 'fixed',
      requestsPerMinute: 100,
      delayMs: 600,
    });

    // Create HttpClient with Bearer token auth
    const httpClient = createOrderHttpClient({
      baseUrl: config.ALLEGRO_API_BASE_URL || 'https://api.allegro.pl',
      auth: {
        type: 'token-header',
        token: accessToken,
        tokenPrefix: 'Bearer',
      },
      retry: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 5000, jitter: true },
      marketplace: MARKETPLACE_NAME,
    });

    // Fetch valid carrier IDs from Allegro once per batch run
    const allegroCarrierMap = await fetchAllegroCarrierMap(httpClient, logger);

    const results: Array<UpdateAllegroOrderStatusResult & { orderId: string }> = [];
    let succeeded = 0;
    let failed = 0;
    const processedOrders = new Map<string, string>();

    for (const product of pendingProducts) {
      const statusToUpdate = product.mopOrderStatusToUpdate || '';
      if (!statusToUpdate) {
        logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
        continue;
      }

      // Rate limit between API calls
      await rateLimiter.acquire();

      const input: UpdateAllegroOrderStatusInput = {
        mopId: Number(product.mopId),
        orderId: product.mopOrderId || '',
        statusToUpdate,
      };

      const result = await updateAllegroOrderStatus(input, processedOrders, httpClient, allegroCarrierMap, logger);
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
      `Hi Team,<br><br>Batch Allegro status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
