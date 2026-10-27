/**
 * eBay Status Update Service — Stage 6 Implementation
 *
 * Pushes order status updates (Shipped with tracking) back to eBay Trading API.
 *
 * Pipeline: Stage 6 (Status Push)
 * Cron: `pnpm cli update-ebay-orders-status` (manual execution only)
 *
 * Flow:
 *   1. Query mop_marketplace_order_products for pending eBay status updates
 *   2. For each product:
 *      - 'Confirmed' → POST CompleteSale API with tracking info → mark as 'Shipped'
 *      - Other status → No API call → mark as 'Cancelled' + 'Need to update manually'
 *   3. One CompleteSale API call per product/transaction (eBay tracks shipment per line item)
 *
 * WHY Stage 6 is manually controlled:
 * - Status updates are irreversible on eBay (once marked shipped, can't undo)
 * - Requires careful testing before automation
 * - User must explicitly run CLI command to push statuses
 *
 * CompleteSale API Requirements:
 * - ItemID: From Transaction/Item/ItemID
 * - TransactionID: From OrderLineItemID
 * - Tracking Number: From UKSS order/product
 * - Shipping Carrier: From UKSS shipping method
 */

import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { RateLimiter } from '../marketplaces/utils/rate-limiter';
import {
  createExecutionContext,
  logStatusPushSummary,
  sendOrderFailureEmail,
  serializeError,
  getErrorMessage,
  getOrderProductDetails,
  getEbayUkStoreInfo,
  type StatusPushResult,
  OrderStatus,
  ApiResponseStatus,
} from '../marketplaces/orders';
import { getEbayAccessToken, getEbayTradingApiEndpoint, isEbaySandboxEnvironment } from '../../lib/ebay/ebay-oauth';
import { buildCompleteSaleRequest } from '../../lib/ebay/ebay-xml-builder';
import { parseEbayXmlResponse, isErrorResponse, getErrorMessage as getEbayErrorMessage } from '../../lib/ebay/ebay-order-data.utils';
import type { EbayCompleteSaleResponse } from './ebay-api.types';

const MARKETPLACE_NAME = 'eBay';

/**
 * Mark eBay order as shipped via CompleteSale API.
 *
 * WHY: eBay CompleteSale uses POST with XML body (not GET like Sportdeal).
 * Requires ItemID, TransactionID, tracking number, and carrier.
 *
 * @param orderId - eBay marketplace order ID
 * @param productId - Product ID (contains ItemID + TransactionID)
 * @param trackingNumber - Tracking number from UKSS
 * @param shippingCarrier - Carrier name (e.g., "Royal Mail")
 * @param logger - Logger instance
 * @returns Success/failure with optional error message
 */
async function markEbayOrderShipped(
  orderId: string,
  productId: string,
  trackingNumber: string,
  shippingCarrier: string,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; error?: string }> {
  // WHY: Use dynamic endpoint based on EBAY_TEST_ENVIRONMENT (sandbox vs live)
  const apiUrl = getEbayTradingApiEndpoint();
  const siteId = config.EBAY_API_SITEID;
  const isSandbox = isEbaySandboxEnvironment();

  logger.debug({ apiUrl, siteId, isSandbox }, 'Using eBay Trading API endpoint');

  // Extract ItemID and TransactionID from productId
  // WHY: productId format is typically "ItemID-TransactionID" (e.g., "123456789-0")
  const [itemId, transactionId] = productId.split('-');

  if (!itemId || !transactionId) {
    const msg = `Invalid productId format: ${productId} (expected "ItemID-TransactionID")`;
    logger.error({ orderId, productId }, msg);
    return { success: false, error: msg };
  }

  logger.info({ orderId, itemId, transactionId, trackingNumber, shippingCarrier }, 'Marking eBay order as shipped');

  try {
    // Build CompleteSale XML request
    const xmlRequest = buildCompleteSaleRequest({
      itemId,
      transactionId,
      trackingNumber,
      shippingCarrier,
    });

    // Call eBay Trading API
    const response = await axios.post<string>(
      apiUrl,
      xmlRequest,
      {
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-SITEID': String(siteId),
          'X-EBAY-API-COMPATIBILITY-LEVEL': String(config.EBAY_API_COMPATIBILITY_LEVEL),
          'X-EBAY-API-CALL-NAME': 'CompleteSale',
          'X-EBAY-API-IAF-TOKEN': accessToken,
        },
        timeout: 60000, // 60 second timeout
      }
    );

    // Parse XML response
    const parsedResponse = parseEbayXmlResponse<EbayCompleteSaleResponse>(response.data);

    // Check for API errors
    if (parsedResponse.CompleteSaleResponse?.Ack === 'Failure') {
      const errorMsg = parsedResponse.CompleteSaleResponse?.Errors?.LongMessage
        || parsedResponse.CompleteSaleResponse?.Errors?.ShortMessage
        || 'Unknown error';
      logger.error({ orderId, error: errorMsg }, 'eBay CompleteSale API returned error');

      await sendOrderFailureEmail(
        MARKETPLACE_NAME,
        `Order Ship Failed - Order ${orderId}`,
        `Hi Team,<br><br>Failed to mark eBay order as shipped.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(errorMsg)}`,
        { orderId, itemId, transactionId, error: errorMsg }
      );

      return { success: false, error: errorMsg };
    }

    logger.info({ orderId, itemId, transactionId }, 'eBay order marked as shipped successfully');
    return { success: true };

  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error), orderId }, 'Exception marking eBay order as shipped');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order Ship Exception - Order ${orderId}`,
      `Hi Team,<br><br>Exception marking eBay order as shipped.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { orderId, error: msg }
    );

    return { success: false, error: msg };
  }
}

/**
 * Process a single product's status update.
 *
 * WHY: Each product/transaction gets its own CompleteSale API call because
 * eBay's CompleteSale with ItemID+TransactionID operates at the transaction
 * level, not the order level. Skipping API calls for subsequent products
 * in the same order would leave them unshipped on eBay ("Partially Shipped").
 *
 * @param mopId - Product ID (mop_id)
 * @param orderId - eBay order ID
 * @param productId - Product ID (ItemID-TransactionID)
 * @param statusToUpdate - Target status ("Confirmed", etc.)
 * @param trackingNumber - Tracking number from UKSS
 * @param shippingCarrier - Carrier name
 * @param accessToken - eBay OAuth access token
 * @param logger - Logger instance
 */
async function updateEbayOrderStatus(
  mopId: number,
  orderId: string,
  productId: string,
  statusToUpdate: string,
  trackingNumber: string | null,
  shippingCarrier: string | null,
  accessToken: string,
  logger: ReturnType<typeof createExecutionContext>['logger']
): Promise<{ success: boolean; mopId: number; status: string; error?: string }> {
  logger.info({ mopId, orderId, statusToUpdate }, 'Processing product status update');

  try {
    if (statusToUpdate === OrderStatus.CONFIRMED) {
      // Validate tracking info
      if (!trackingNumber || !shippingCarrier) {
        const msg = 'Missing tracking number or shipping carrier';
        logger.error({ mopId, orderId, trackingNumber, shippingCarrier }, msg);
        return { success: false, mopId, status: statusToUpdate, error: msg };
      }

      const result = await markEbayOrderShipped(
        orderId,
        productId,
        trackingNumber,
        shippingCarrier,
        accessToken,
        logger
      );

      if (result.success) {
        // Mark this specific product as shipped
        await prisma.mopMarketplaceOrderProduct.update({
          where: { mopId: BigInt(mopId) },
          data: {
            mopOrderStatusOfOrder: OrderStatus.SHIPPED,
            mopApiResponse: ApiResponseStatus.SUCCESS,
          },
        });

        logger.info({ mopId, orderId, productId }, 'Product marked as Shipped on eBay');

        return { success: true, mopId, status: OrderStatus.SHIPPED };
      } else {
        logger.error({ mopId, orderId, error: result.error }, 'Order ship failed');
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
      `Hi Team,<br><br>Exception updating eBay order status.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
      { mopId, orderId, error: msg }
    );

    return { success: false, mopId, status: statusToUpdate, error: msg };
  }
}

/**
 * Batch-process all pending eBay status updates.
 *
 * Pipeline: Stage 6 (Status Push)
 * Cron: `pnpm cli update-ebay-orders-status` (manual execution only)
 *
 * @returns Batch result with counts and per-product details
 */
export async function updateEbayOrderStatusesToEbay(): Promise<StatusPushResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('ebay-status-update-service');

  logger.info('Starting batch eBay status push');

  try {
    // WHY: Get eBay store from database using EBAY_STORE_ID from config
    const storeDetails = await getEbayUkStoreInfo(logger);
    if (!storeDetails) {
      const msg = `eBay store with ID ${config.EBAY_STORE_ID} not found in store_management table. Please verify EBAY_STORE_ID in .env`;
      logger.error(msg);
      return {
        success: false,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        duration: Date.now() - startTime,
        error: msg,
      };
    }

    const storeId = storeDetails.store_id;
    const isSandbox = isEbaySandboxEnvironment();
    logger.info({ storeId, storeName: storeDetails.store_name, isSandbox }, 'eBay UK store loaded from database');

    const pendingProducts = await getOrderProductDetails([storeId], logger);
    logger.info({ pendingCount: pendingProducts.length }, 'Found pending status updates');

    if (pendingProducts.length === 0) {
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        duration: Date.now() - startTime,
      };
    }

    // Get OAuth access token
    logger.info('Obtaining eBay OAuth access token');
    const accessToken = await getEbayAccessToken();

    // Rate limiter (eBay allows 5000 calls/day, ~3.5 calls/min sustained)
    const rateLimiter = new RateLimiter({
      strategy: 'fixed',
      requestsPerMinute: 60, // Conservative rate
      delayMs: 1000,
    });

    const results: Array<{ success: boolean; mopId: number; orderId: string; status: string; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const product of pendingProducts) {
      const statusToUpdate = product.mopOrderStatusToUpdate || '';
      if (!statusToUpdate) {
        logger.warn({ mopId: product.mopId.toString() }, 'Empty status, skipping');
        continue;
      }

      // Rate limit between API calls
      await rateLimiter.acquire();

      const result = await updateEbayOrderStatus(
        Number(product.mopId),
        product.mopOrderId || '',
        product.mopProductId || '',
        statusToUpdate,
        product.mopUkssTrackingCode,
        product.mopUkssShippingCarrier,
        accessToken,
        logger
      );

      results.push({ ...result, orderId: product.mopOrderId || '' });

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
      results,
      duration: Date.now() - startTime,
    };

    logStatusPushSummary(logger, statusResult);

    return statusResult;
  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error) }, 'Batch status push failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Batch Status Update Failed',
      `Hi Team,<br><br>Batch eBay status update failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg }
    );

    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      duration: Date.now() - startTime,
      error: msg,
    };
  }
}