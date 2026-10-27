/**
 * Shopify Orders Service
 *
 * Fetches orders from Shopify stores and processes them
 * Converted from PHP fetch_shopify_orders() function
 */
import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { createOrdersInUKSS } from '../../lib/marketplace-orders/marketplace-orders-utils';
import { ShopifySDK } from '../../lib/shopify-sdk';
import type { FulfillmentOrder, CreateFulfillmentRequest } from '../../lib/shopify-sdk';
import { getThreeDaysAgoDate } from '../../lib/helpers/common-utils';
import { nanoid } from 'nanoid';
import type {
  FetchOrdersResult,
  TokenCredentials,
  UpdateOrderStatusInput,
  UpdateOrderStatusResult,
  BatchUpdateOrderStatusResult,
} from './shopify.schema';
import { emailService } from '../../lib/email';
import { getOrderProductDetails } from '../../lib/marketplace-orders/marketplace-orders-products-util';

import { config } from '../../config';

const defaultLogger = createLogger('shopify-orders');

export type FetchType = 'All' | 'Partial';

/**
 * Get token credentials for a store
 * 
 * This function queries the StoreManagement table.
 * 
 * @param storeId - Store ID (can be numeric ID)
 * @param logger - Optional logger instance (for dependency injection with executionId context)
 * @returns Token credentials object or 'fail' if not found
 */
export async function getTokenCredentials(
  storeId: number,
  logger?: Logger
): Promise<TokenCredentials | 'fail'> {
  const log = logger || defaultLogger;

  try {

    const storeCredentials = await prisma.storeManagement.findFirst({
      where: {
        storeId: storeId,
      },
      select: {
        storeName: true,
        smAppApiKey: true,
        smAppSharedsecret: true,
        smAppAccessToken: true,
        storeOrderIntegrationApiHostname: true,
      },
    });

    if (storeCredentials) {
      log.info({ storeId, storeName: storeCredentials.storeName }, 'Store credentials found in StoreManagement');

      // Handle null/empty values
      const shopUrl = storeCredentials.storeOrderIntegrationApiHostname || '';

      if (!shopUrl) {
        log.error({ storeId }, 'Store has no order integration API hostname configured');
        return 'fail';
      }

      return {
        ShopUrl: shopUrl,
        ApiKey: storeCredentials.smAppApiKey || '',
        SharedSecret: storeCredentials.smAppSharedsecret || '',
        AccessToken: storeCredentials.smAppAccessToken || '',
        StoreName: storeCredentials.storeName,
      };
    }
    return 'fail';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error, storeId, message }, 'Failed to get token credentials');

    return 'fail';
  }
}

/**
 * Get store-specific created_at_min date
 * 
 * Options:
 * 1. Store in ShopifyStore.createdAtMin field
 * 2. Store in environment variables
 */
function getStoreCreatedAtMin(storeId: string): string | null {
  // Map of store IDs to created_at_min dates
  const storeConfig: Record<string, string> = {
    '118': config.RACECRATE_CREATED_AT_MIN || '2023-05-09T00:00:43Z',
    '124': config.UKRS_CREATED_AT_MIN || '2023-06-10T07:25:43Z',
    '126': config.SOCCERCLASSICO_CREATED_AT_MIN || '2023-03-09T05:15:43Z',
    '134': config.JERSEYDOR_CREATED_AT_MIN || '2024-04-01T05:15:43Z',
    '129': config.CLASSICFOOTBALLKIT_CREATED_AT_MIN || '2023-11-17T00:00:00Z',
    '99' : config.TEAMZO_CREATED_AT_MIN || '2023-11-21T00:00:00Z',
    '117': config.TERRACE_GEAR_AT_MIN || '2024-01-01T05:15:43Z',
    '135': config.ONSIDE_THREADS_AT_MIN || '2024-10-21T00:00:00Z',
    '136': config.THE_OFFSIDE_LINE_AT_MIN || '2024-11-07T00:00:00Z',
    '141': config.THE_RUGBY_HQ_AT_MIN || '2025-07-09T00:00:00Z',
    '142': config.MYSTERYSHIRTCLUB_CREATED_AT_MIN || '2025-07-30T00:00:00Z',
    '145': config.MYSTERYSHIRTCLUBOFFICIAL_CREATED_AT_MIN || '2025-11-05T00:00:00Z',
    '146': config.TOFFS_UK_CREATED_AT_MIN || '2026-01-09T00:00:00Z',
    '153': config.LOKKAROOM_CREATED_AT_MIN || '2026-06-01T00:00:00Z',
    '154': config.ABSOLUTE_RUGBY_CREATED_AT_MIN || '2026-06-10T00:00:00Z',
  };

  return storeConfig[storeId] || null;
}

/**
 * Get last fetched order ID for a store
 * 
 * TODO: Implement based on your order storage structure
 * Options:
 * 1. Query ShopifyOrder table: SELECT MAX(shopifyOrderId) WHERE storeId = ?
 * 2. Store in ShopifyStore.lastFetchedOrderId field
 * 3. Query external system (UKSS)
 * 
 * @param storeId - Store ID
 * @param logger - Optional logger instance (for dependency injection with executionId context)
 * @returns Last fetched order ID or null
 */
async function getLastFetchedOrderId(
  storeId: string,
  logger?: Logger
): Promise<string | null> {
  const log = logger || createLogger('shopify-orders');

  try {

    let numericStoreId = Number(storeId);
    const latestOrder = await prisma.moMarketplaceOrder.findFirst({
      where: {
        moStoreId: numericStoreId,
      },
      select: {
        moOrderId: true,
      },
      orderBy: {
        moOrderId: 'desc',
      },
    });
    return latestOrder?.moOrderId || null;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', storeId }, 'Failed to get last fetched order ID');
    return null;
  }
}

/**
 * Fetch Shopify orders for a store
 *
 * Equivalent to PHP: fetch_shopify_orders($store_id, $fetch_type)
 *
 * @param storeId - Store ID (UUID)
 * @param fetchType - 'All' to fetch all orders, 'Partial' to fetch since last ID
 * @param orderId - Optional: fetch a single Shopify order by ID instead of listing by filters
 * @returns Result with order counts and status
 */
export async function fetchShopifyOrders(
  storeId: string,
  fetchType: FetchType = 'Partial',
  orderId?: string
): Promise<FetchOrdersResult> {
  const startTime = Date.now();

  // Generate unique execution ID for this process run
  // This allows us to trace all logs belonging to this specific execution
  const executionId = nanoid(10);

  // Create child logger with executionId context
  // All logs from this execution will include the executionId
  const log = defaultLogger.child({ executionId });

  log.info({ storeId, fetchType, executionId }, 'Starting Shopify orders fetch');

  try {
    // 1. Get token credentials (pass child logger to include executionId in logs)
    const configWithToken = await getTokenCredentials(Number(storeId), log);

    if (configWithToken === 'fail') {
      throw new Error(`Failed to get token credentials for store: ${storeId}`);
    }

    log.info(
      { storeId, storeName: configWithToken.StoreName },
      'Token credentials loaded'
    );

    // 3. Initialize Shopify SDK with full configuration
    const shopifyConfig = {
      shopDomain: configWithToken.ShopUrl,
      apiKey: configWithToken.ApiKey,
      sharedSecret: configWithToken.SharedSecret,
      accessToken: configWithToken.AccessToken,
      storeName: configWithToken.StoreName,
      defaultApiVersion: config.SHOPIFY_API_VERSION || '2023-07',
      apiVersion: config.SHOPIFY_API_VERSION || '2023-07',
      microtimeOfLastApiCall: null,
      timeAllowedForEachApiCall: 0.5,
    };

    const shopify = new ShopifySDK(shopifyConfig);

    log.info({ storeId, shopDomain: configWithToken.ShopUrl }, 'Shopify SDK initialized');

    let orders: any[];

    if (orderId) {
      // Fetch a single order by ID - bypasses the list filters/date-window entirely
      log.info({ storeId, orderId }, 'Fetching single order by ID');

      const response = await shopify.Order(orderId).get();
      orders = response.data ? [response.data] : [];

      log.info(
        { storeId, orderId, found: orders.length > 0 },
        'Single order fetch completed'
      );
    } else {
      // 4. Get last fetched order ID (pass child logger to include executionId in logs)
      const lastInsertedOrderId = await getLastFetchedOrderId(storeId, log);
      log.info(
        { storeId, lastOrderId: lastInsertedOrderId },
        'Last fetched order ID retrieved'
      );

      // 5. Get store-specific created_at_min
      const storeCreatedAtMin = getStoreCreatedAtMin(storeId);
      const globalCreatedAtMin = await getThreeDaysAgoDate();

      // 6. Build query parameters
      let params: Record<string, any> = {
        status: 'open',
        financial_status: 'paid',
        fulfillment_status: 'unfulfilled',
      };

      if (fetchType === 'All') {
        // Fetch all orders from global date
        params.created_at_min = globalCreatedAtMin;
      } else if (lastInsertedOrderId) {
        // Fetch orders since last ID
        params.since_id = lastInsertedOrderId;
        if (storeCreatedAtMin) {
          params.created_at_min = storeCreatedAtMin;
        }
      } else {
        // First time fetch - use store-specific or global date
        params.created_at_min = storeCreatedAtMin;
      }

      log.info({ storeId, params }, 'Query parameters built');

      // 7. Fetch orders from Shopify
      const response = await shopify.Order().get(params);
      orders = Array.isArray(response.data) ? response.data : [];

      log.info(
        { storeId, orderCount: orders.length },
        'Orders fetched from Shopify'
      );
    }

    // 8. Process orders if any found
    let ordersProcessed = 0;
    let lastOrderId: string | undefined;

    if (orders.length > 0) {
      // Save order response to log (optional)
      log.debug(
        { storeId, orders: JSON.stringify(orders, null, 2) },
        'Order response data'
      );

      // Process and save orders (pass child logger so all logs include executionId and go to shopify-orders/log.txt)
      const result = await createOrdersInUKSS(orders, configWithToken.StoreName, log);
      if(result.failed > 0){
        throw new Error('Failed to create orders in UKSS');
      }
      ordersProcessed = result.processed;

      log.info(
        {
          storeId,
          storeName: configWithToken.StoreName,
          fetched: orders.length,
          processed: result.processed,
          failed: result.failed,
        },
        'Orders processed'
      );
    } else {
      log.info({ storeId }, 'No new orders found');
    }

    const duration = Date.now() - startTime;

    log.info(
      {
        storeId,
        fetchType,
        ordersFetched: orders.length,
        ordersProcessed,
        duration,
      },
      'Shopify orders fetch completed'
    );

    return {
      success: true,
      ordersFetched: orders.length,
      ordersProcessed,
      lastOrderId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', storeId, fetchType }, 'Failed to fetch Shopify orders');

    // Send error notification email
    await emailService.sendErrorNotification({
      subject: `Failed to fetch Shopify orders - Store: ${storeId}`,
      errorMessage: message,
      module: 'shopify-orders',
      context: {
        storeId,
        fetchType,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : String(error),
      },
      executionId,
      priority: 3,
      delay: 5000,
    });

    return {
      success: false,
      ordersFetched: 0,
      ordersProcessed: 0,
      error: message,
    };
  }
}

/**
 * Update order status on Shopify (Fulfilled or Cancelled)
 *
 * Equivalent to PHP: update_order_status_to_marketplaces() - Shopify section
 *
 * @param input - Order status update input
 * @param logger - Optional logger instance
 * @returns Update result
 */
export async function updateOrderStatusToShopify(
  input: UpdateOrderStatusInput,
  logger?: Logger
): Promise<UpdateOrderStatusResult> {
  const log = logger || defaultLogger;

  const {
    mopId,
    storeId,
    marketplaceOrderId,
    marketplaceOrderProductId,
    statusToUpdate,
    trackingNumber,
    trackingCompany,
    storeName,
  } = input;

  log.info(
    { mopId, storeId, marketplaceOrderId, statusToUpdate },
    'Starting Shopify order status update'
  );

  try {
    // 1. Get store credentials
    const configWithToken = await getTokenCredentials(storeId, log);

    if (configWithToken === 'fail') {
      const error = `Failed to get token credentials for store: ${storeId}`;
      log.error({ storeId }, error);

      // Send error email
      await emailService.sendErrorNotification({
        subject: `Failed to fetch store credentials - Store: ${storeId}`,
        errorMessage: error,
        module: 'shopify-order-status-update',
        context: { storeId, mopId, marketplaceOrderId },
        priority: 3,
        delay: 5000,
      });

      return {
        success: false,
        mopId,
        status: statusToUpdate,
        error,
      };
    }

    // 2. Initialize Shopify SDK
    const shopifyConfig = {
      shopDomain: configWithToken.ShopUrl,
      apiKey: configWithToken.ApiKey,
      sharedSecret: configWithToken.SharedSecret,
      accessToken: configWithToken.AccessToken,
      storeName: configWithToken.StoreName,
      defaultApiVersion: config.SHOPIFY_API_VERSION || '2023-07',
      apiVersion: config.SHOPIFY_API_VERSION || '2023-07',
      microtimeOfLastApiCall: null,
      timeAllowedForEachApiCall: 0.5,
    };

    const shopify = new ShopifySDK(shopifyConfig);
    const currentStoreName = storeName || configWithToken.StoreName;

    log.info(
      { storeId, storeName: currentStoreName, shopDomain: configWithToken.ShopUrl },
      'Shopify SDK initialized for status update'
    );

    // 3. Handle status update based on type
    if (statusToUpdate === 'Fulfilled') {
      return await handleFulfilledStatus(
        shopify,
        mopId,
        marketplaceOrderId,
        marketplaceOrderProductId,
        trackingNumber || '',
        trackingCompany || '',
        currentStoreName,
        log
      );
    } else if (statusToUpdate === 'Cancelled') {
      return await handleCancelledStatus(
        shopify,
        mopId,
        marketplaceOrderId,
        currentStoreName,
        log
      );
    }

    return {
      success: false,
      mopId,
      status: statusToUpdate,
      error: `Unknown status type: ${statusToUpdate}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(
      { error: error instanceof Error ? error.message : 'Unknown error', mopId, storeId, marketplaceOrderId, statusToUpdate },
      'Failed to update Shopify order status'
    );

    // Send error notification
    await emailService.sendErrorNotification({
      subject: `Shopify Order Status Update Failed - Store: ${storeName || storeId}`,
      errorMessage: message,
      module: 'shopify-order-status-update',
      context: {
        mopId,
        storeId,
        marketplaceOrderId,
        statusToUpdate,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
        possibleReasons: [
          'Order may be older than 60 days (Shopify API limitation)',
          'Invalid order ID or line item ID',
          'Store credentials may be invalid or expired',
          'Network/API connectivity issues',
        ],
      },
      priority: 3,
      delay: 5000,
    });

    return {
      success: false,
      mopId,
      status: statusToUpdate,
      error: message,
    };
  }
}

/**
 * Handle Fulfilled status - Create fulfillment with tracking
 */
async function handleFulfilledStatus(
  shopify: ShopifySDK,
  mopId: number,
  marketplaceOrderId: string,
  marketplaceOrderProductId: string,
  trackingNumber: string,
  trackingCompany: string,
  storeName: string,
  log: Logger
): Promise<UpdateOrderStatusResult> {
  try {
    // 1. Fetch fulfillment orders for the order
    log.info(
      { marketplaceOrderId },
      'Fetching fulfillment orders from Shopify'
    );

    const fulfillmentOrdersResponse = await shopify
      .Order(marketplaceOrderId)
      .FulfillmentOrder.get();

    const fulfillmentOrders: FulfillmentOrder[] = fulfillmentOrdersResponse.data || [];

    log.info(
      { marketplaceOrderId, fulfillmentOrdersCount: fulfillmentOrders.length },
      'Fulfillment orders fetched'
    );

    log.debug(
      { fulfillmentOrders: JSON.stringify(fulfillmentOrders) },
      'Fulfillment orders details'
    );

    // 2. Parse personalized order product IDs (comma-separated)
    const productIds = marketplaceOrderProductId.split(',').map((id) => id.trim());

    log.info(
      { productIds },
      'Parsed product IDs for matching'
    );

    // 3. Find matching line item in fulfillment orders
    let fulfillmentRequest: CreateFulfillmentRequest | null = null;

    for (const fulfillmentOrder of fulfillmentOrders) {
      if (!fulfillmentOrder.line_items) continue;

      for (const lineItem of fulfillmentOrder.line_items) {
        // Match against any of the product IDs (supports personalized orders)
        const lineItemId = String(lineItem.line_item_id);
        const isMatch = productIds.some((pid) => pid === lineItemId);

        if (isMatch) {
          log.info(
            {
              matchedLineItemId: lineItem.line_item_id,
              fulfillmentOrderId: lineItem.fulfillment_order_id,
              fulfillmentOrderLineItemId: lineItem.id,
              quantity: lineItem.quantity,
            },
            'Found matching line item'
          );

          // Prepare fulfillment request
          fulfillmentRequest = {
            line_items_by_fulfillment_order: [
              {
                fulfillment_order_id: lineItem.fulfillment_order_id,
                fulfillment_order_line_items: [
                  {
                    id: lineItem.id,
                    quantity: lineItem.quantity,
                  },
                ],
              },
            ],
            tracking_info: {
              number: trackingNumber,
              company: trackingCompany,
            },
            notify_customer: true,
          };

          break;
        }
      }

      if (fulfillmentRequest) break;
    }

    if (!fulfillmentRequest) {
      const error = `Line item not found in fulfillment orders for product IDs: ${productIds.join(', ')}`;
      log.error(
        { marketplaceOrderId, productIds },
        error
      );

      return {
        success: false,
        mopId,
        status: 'Fulfilled',
        error,
      };
    }

    // 4. Create fulfillment
    log.info(
      { fulfillmentRequest: JSON.stringify(fulfillmentRequest) },
      'Creating fulfillment on Shopify'
    );

    const fulfillmentResponse = await shopify.Fulfillment.post(fulfillmentRequest);

    log.info(
      { fulfillmentResponse: JSON.stringify(fulfillmentResponse.data) },
      'Fulfillment response received'
    );

    // 5. Check success
    const fulfillment = fulfillmentResponse.data;
    if (fulfillment && fulfillment.status === 'success') {
      // 6. Update database
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId },
        data: {
          mopOrderStatusOfOrder: 'Shipped',
          mopApiResponse: 'Success',
        },
      });

      log.info(
        { mopId, marketplaceOrderId, newStatus: 'Shipped' },
        'Order status updated successfully (Fulfilled -> Shipped)'
      );

      return {
        success: true,
        mopId,
        status: 'Shipped',
      };
    } else {
      const error = `Fulfillment creation returned unexpected status: ${JSON.stringify(fulfillment)}`;
      log.error({ mopId, fulfillment }, error);

      return {
        success: false,
        mopId,
        status: 'Fulfilled',
        error,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(
      { message, mopId, marketplaceOrderId },
      'Failed to create fulfillment on Shopify'
    );

    // Send error email
    await emailService.sendErrorNotification({
      subject: `Shopify Store ${storeName} Order status API Failed`,
      errorMessage: message,
      module: 'shopify-order-status-update',
      context: {
        mopId,
        marketplaceOrderId,
        storeName,
        operation: 'Fulfilled',
        possibleReasons: [
          'Order may be older than 60 days (Shopify API limitation)',
          'Line item ID mismatch',
          'Order already fulfilled',
        ],
      },
      priority: 3,
      delay: 5000,
    });

    throw error;
  }
}

/**
 * Handle Cancelled status - Cancel order on Shopify
 */
async function handleCancelledStatus(
  shopify: ShopifySDK,
  mopId: number,
  marketplaceOrderId: string,
  storeName: string,
  log: Logger
): Promise<UpdateOrderStatusResult> {
  try {
    // 1. Cancel order
    log.info(
      { marketplaceOrderId },
      'Cancelling order on Shopify'
    );

    const cancelResponse = await shopify.Order(marketplaceOrderId).cancel({ reason: 'inventory' });

    // 2. Verify cancellation by fetching order
    log.info(
      { marketplaceOrderId },
      'Verifying order cancellation'
    );

    const order = cancelResponse.data;

    log.info(
      { order: JSON.stringify(order) },
      'Order details after cancellation'
    );

    // 3. Check if cancelled
    if (order && order.cancel_reason !== null && order.cancel_reason !== undefined) {
      // 4. Update database
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId },
        data: {
          mopOrderStatusOfOrder: 'Cancelled',
          mopApiResponse: 'Success',
        },
      });

      log.info(
        { mopId, marketplaceOrderId, cancelReason: order.cancel_reason },
        'Order status updated successfully (Cancelled)'
      );

      return {
        success: true,
        mopId,
        status: 'Cancelled',
      };
    } else {
      const error = `Order cancellation verification failed: cancel_reason is null`;
      log.error({ mopId, order }, error);

      return {
        success: false,
        mopId,
        status: 'Cancelled',
        error,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(
      { error: error instanceof Error ? error.message : 'Unknown error', mopId, marketplaceOrderId },
      'Failed to cancel order on Shopify'
    );

    // Send error email
    await emailService.sendErrorNotification({
      subject: `Shopify Store ${storeName} Order status API Failed`,
      errorMessage: message,
      module: 'shopify-order-status-update',
      context: {
        mopId,
        marketplaceOrderId,
        storeName,
        operation: 'Cancelled',
        possibleReasons: [
          'Order may be older than 60 days (Shopify API limitation)',
          'Order already cancelled',
          'Order may have been fulfilled already',
        ],
      },
      priority: 3,
      delay: 5000,
    });

    throw error;
  }
}

/**
 * Batch update order statuses to Shopify
 *
 * Processes multiple order status updates for Shopify stores
 *
 * @param logger - Optional logger instance
 * @returns Batch update results
 */
export async function updateOrderStatusesToShopify(
  logger?: Logger
): Promise<BatchUpdateOrderStatusResult> {
  const executionId = nanoid(10);
  const log = (logger || defaultLogger).child({ executionId });

  log.info({ executionId }, 'Starting batch Shopify order status update');

  try {
    // 1. Get Shopify store IDs from config (comma-separated list)
    const shopifyStoreIds = config.SHOPIFY_STORE_IDS_FOR_ORDER_STATUS_UPDATE || '';
    const storeIdList = shopifyStoreIds
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (storeIdList.length === 0) {
      log.warn('No Shopify store IDs configured for order status update');
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    log.info({ storeIdList }, 'Shopify store IDs for order status update');

    // 2. Fetch order products with pending status updates
    const pendingProducts = await getOrderProductDetails(storeIdList, logger);

    log.info(
      { pendingCount: pendingProducts.length },
      'Found pending order products for status update'
    );

    if (pendingProducts.length === 0) {
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    // 3. Process each order product
    const results: UpdateOrderStatusResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // De-duplicate fulfillment/cancellation per Shopify line item.
    // qty>1 of the same product is stored as N identical mop rows that share one
    // line_item_id (see marketplace-orders-utils.ts "Handle quantity > 1"). A single
    // fulfillment call ships the line item's FULL quantity, so only the first row can
    // succeed on Shopify; the remaining rows hit an already-fulfilled/closed line item
    // and error (firing duplicate failure emails). Mirror the legacy array_unique step
    // (manage_multisite_order_integration_controller.php:1505): action each line item
    // once, then persist the same terminal status to the duplicate rows so they leave
    // the 'Waiting' queue without re-calling Shopify.
    const processedLineItems = new Map<string, UpdateOrderStatusResult>();

    for (const product of pendingProducts) {
      const storeId = product.moOrder.moStoreId || 0;
      const orderId = product.mopOrderId || '';
      const lineItemKey = `${storeId}::${orderId}::${product.mopProductId || ''}::${product.mopOrderStatusToUpdate}`;

      const prior = processedLineItems.get(lineItemKey);
      if (prior?.success) {
        // Same Shopify line item already actioned in this run — persist the terminal
        // status to this duplicate unit instead of re-calling (and re-failing on) Shopify.
        await prisma.mopMarketplaceOrderProduct.update({
          where: { mopId: product.mopId },
          data: {
            mopOrderStatusOfOrder: prior.status === 'Cancelled' ? 'Cancelled' : 'Shipped',
            mopApiResponse: 'Success',
          },
        });

        const dedupedResult: UpdateOrderStatusResult = {
          success: true,
          mopId: product.mopId,
          status: prior.status,
        };
        results.push(dedupedResult);
        succeeded++;

        log.info(
          { mopId: product.mopId, orderId, lineItemKey, status: prior.status },
          'Duplicate qty>1 line-item row marked from prior fulfillment (dedup, no Shopify call)'
        );

        continue;
      }

      const input: UpdateOrderStatusInput = {
        mopId: product.mopId,
        storeId,
        marketplaceOrderId: orderId,
        marketplaceOrderProductId: product.mopProductId || '',
        statusToUpdate: product.mopOrderStatusToUpdate as 'Fulfilled' | 'Cancelled',
        trackingNumber: product.mopUkssTrackingCode || undefined,
        trackingCompany: product.mopUkssShippingCarrier || undefined,
        storeName: product.moOrder.moStoreName || undefined,
      };

      const result = await updateOrderStatusToShopify(input, log);
      processedLineItems.set(lineItemKey, result);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Small delay between API calls to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    log.info(
      {
        processed: pendingProducts.length,
        succeeded,
        failed,
      },
      'Batch Shopify order status update completed'
    );

    return {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', message }, 'Batch Shopify order status update failed');
    await emailService.sendErrorNotification({
      subject: `Shopify Order Status Update Failed`,
      errorMessage: message,
      module: 'shopify-order-status-update',
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      error: message,
    };
  }
}

