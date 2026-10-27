/**
 * Sportdeal Order Service — Gold Standard Implementation
 *
 * Fetches orders from the Sportdeal marketplace API and inserts them into
 * the marketplace order (MOP) tables for processing by the shared pipeline.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 * Cron: `pnpm cli fetch-sportdeal-orders` — runs every 30 minutes
 *
 * Architecture:
 *   - Uses shared HttpClient for automatic retry, rate limiting, and duration logging
 *   - Uses shared order infrastructure from modules/marketplaces/orders/
 *   - Produces TransformedOrderMap consumed by insertMarketPlaceOrderDetails()
 *
 * Known API constraints:
 *   - Sportdeal uses a two-step fetch: list endpoint (order IDs) + detail per order
 *   - The API returns order_items as a JSON string (not parsed array) inconsistently
 *   - Empty arrays [] appear where null values are expected (API quirk)
 */

import { config } from '../../config';
import { getCountryNameFromIsoCode } from '../../lib/helpers/common-utils';
import { escapeHtml } from '../../lib/utils/string-utils';
import {
  createExecutionContext,
  createOrderHttpClient,
  logFetchSummary,
  sendOrderFailureEmail,
  createFailedFetchResult,
  serializeError,
  getErrorMessage,
  insertMarketPlaceOrderDetails,
  getOrderStatus,
  getLastFetchedOrderDate,
  getStoreInfo,
  getCurrencyDetails,
  getProductVariationDataFromSKU,
  type FetchOrdersResult,
  type TransformedOrderMap,
  OrderStatus,
  AUDIT_USER,
  getCreatedByLabel,
  DEFAULT_INITIAL_STATUS_MAPPING_ID,
} from '../marketplaces/orders';
import { HttpClient } from '../marketplaces/utils/http-client';
import { createLogger } from '../../lib/logger';
import {
  getSportdealOrderStatus,
  parseSportdealOrderItems,
} from '../../lib/sportdeal/sportdeal-order-data.utils';
import type {
  SportdealOrderListResponse,
  SportdealOrderDetailResponse,
  SportdealOrderItem,
} from './sportdeal-api.types';

const MARKETPLACE_NAME = 'Sportdeal';
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);

/** Separate logger for raw API response data (for debugging/audit) */
const feedLogger = createLogger('sportdeal-order-feed');

/**
 * Create an HttpClient configured for Sportdeal API calls.
 *
 * WHY: Sportdeal uses full URLs from config (not a base URL + path pattern),
 * so baseUrl is empty. The client handles auth, retry, and rate limiting.
 */
function createSportdealHttpClient(): HttpClient {
  const apiKey = config.SPORTDEAL_API_KEY;
  if (!apiKey) {
    throw new Error('SPORTDEAL_API_KEY is not configured');
  }

  return createOrderHttpClient({
    baseUrl: '',
    auth: {
      type: 'token-header',
      token: apiKey,
      tokenPrefix: '',
    },
    rateLimit: {
      strategy: 'fixed',
      requestsPerMinute: 120,
      delayMs: 500,
    },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      jitter: true,
    },
    marketplace: MARKETPLACE_NAME,
  });
}

/**
 * Fetch orders from Sportdeal API and insert into marketplace order tables.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 *
 * Flow:
 *   1. Get date range from last fetched order
 *   2. Call Sportdeal orders list endpoint
 *   3. For each order, fetch full details (N+1 pattern — see WHY below)
 *   4. Transform each order to MOP format
 *   5. Insert via insertMarketPlaceOrderDetails()
 *
 * WHY: Sportdeal API doesn't support batch detail fetch.
 * The list endpoint returns only order IDs and summary fields (id, created_at, delivery_cost).
 * Full order data (customer, address, products) requires a separate GET per order.
 *
 * @returns FetchOrdersResult with counts of found, inserted, skipped, failed orders
 */
export async function fetchSportdealOrders(): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('sportdeal-order-service');

  logger.info('Starting Sportdeal order fetch');

  try {
    // Validate required configuration
    const storeId = config.SPORTDEAL_STORE_ID;
    const ordersApiUrl = config.SPORTDEAL_ORDERS_API_URL;
    const orderDetailApiUrl = config.SPORTDEAL_ORDER_PRODUCT_API_URL;

    if (!storeId || !ordersApiUrl || !orderDetailApiUrl) {
      const msg = 'Missing required config: SPORTDEAL_STORE_ID, SPORTDEAL_ORDERS_API_URL, or SPORTDEAL_ORDER_PRODUCT_API_URL';
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    // Get store details from database by store ID (not from config name fallback)
    const storeDetails = await getStoreInfo(storeId, logger);
    if (!storeDetails) {
      const msg = `Store with ID ${storeId} not found in store_management table`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }
    const storeName = storeDetails.store_name;

    // Get currency details
    const currencyCode = config.SPORTDEAL_CURRENCY || 'EUR';
    const currencyDetails = await getCurrencyDetails(currencyCode, logger);
    const conversionRate = currencyDetails?.conversionRate || 1;

    // Determine date range for fetching
    const dateRange = await getLastFetchedOrderDate(storeId, logger);
    const fromTime = dateRange.startDate.toISOString();
    const toTime = dateRange.endDate.toISOString();
    logger.info({ fromTime, toTime, storeId }, 'Fetch date range determined');

    // Build orders list URL
    let listUrl = ordersApiUrl;
    if (ordersApiUrl.includes('%s')) {
      listUrl = ordersApiUrl.replace('%s', fromTime).replace('%s', toTime);
    }

    // Create HTTP client
    const httpClient = createSportdealHttpClient();

    // Stage 1a: Fetch orders list
    logger.info({ url: listUrl }, 'Fetching orders list from Sportdeal API');
    const listResponse = await httpClient.get<SportdealOrderListResponse>(listUrl);
    const orderItems = listResponse.data?.items || [];

    // WHY: debug level — raw API responses contain customer PII (email, phone, address).
    // Only enable in development/debugging. Production log level filters this out.
    feedLogger.debug({ orders: listResponse.data }, 'Sportdeal orders list data');

    if (orderItems.length === 0) {
      logger.info('No orders found from Sportdeal API');
      const result: FetchOrdersResult = {
        success: true,
        message: 'No orders found',
        ordersFound: 0,
        ordersInserted: 0,
        ordersSkipped: 0,
        ordersFailed: 0,
        errors: [],
        duration: Date.now() - startTime,
      };
      logFetchSummary(logger, result);
      return result;
    }

    logger.info({ orderCount: orderItems.length }, 'Orders found, fetching details');

    // Stage 1b: Fetch detail for each order (N+1 pattern)
    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const item of orderItems) {
      const orderId = String(item.id);

      try {
        // Check for duplicates before making the detail API call
        const exists = await getOrderStatus(orderId, storeDetails.store_id, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        // Fetch full order detail
        const detailUrl = `${orderDetailApiUrl}${item.id}`;
        const detailResponse = await httpClient.get<SportdealOrderDetailResponse>(detailUrl);
        const orderDetail = detailResponse.data;

        // WHY: debug level — contains customer PII. See comment above.
        feedLogger.debug({ orders: orderDetail }, 'Sportdeal order detail data');

        // Merge list-level fields into detail
        orderDetail.created_at = item.created_at;
        orderDetail.order_delivery_cost = item.delivery_cost;

        // Transform to MOP format
        const transformed = await transformSportdealOrder(
          orderDetail, { storeName, storeId: storeDetails.store_id, currencyCode, conversionRate, logger }
        );

        if (transformed) {
          transformedOrders[orderId] = transformed;
        } else {
          ordersFailed++;
          errors.push({ orderId, error: 'No valid products after transformation' });
        }
      } catch (error) {
        ordersFailed++;
        const msg = getErrorMessage(error);
        errors.push({ orderId, error: msg });
        logger.error({ orderId, error: serializeError(error) }, 'Failed to process order');

        await sendOrderFailureEmail(
          MARKETPLACE_NAME,
          `Order Detail Fetch Failed - Order ${orderId}`,
          `Hi Team,<br><br>Failed to fetch/process order details from Sportdeal API.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
          { executionId, orderId, error: msg }
        );
      }
    }

    // Stage 2: Insert into MOP tables
    let ordersInserted = 0;
    if (Object.keys(transformedOrders).length > 0) {
      logger.info({ orderCount: Object.keys(transformedOrders).length }, 'Inserting orders into database');
      const insertStatus = await insertMarketPlaceOrderDetails(transformedOrders, logger);

      if (insertStatus === 'Inserted Successfully') {
        ordersInserted = Object.keys(transformedOrders).length;
        logger.info({ insertedCount: ordersInserted }, 'Orders inserted successfully');
      } else if (insertStatus === 'Partially Inserted') {
        // Some orders succeeded, some failed — insertMarketPlaceOrderDetails
        // sends email notifications for individual failures internally.
        // We can't determine exact count here, so log as warning.
        logger.warn({ insertStatus, totalAttempted: Object.keys(transformedOrders).length }, 'Some orders failed to insert');
        ordersInserted = Object.keys(transformedOrders).length; // Upper bound — some may have failed
        ordersFailed += 1; // Signal that partial failure occurred
      } else {
        logger.error({ insertStatus }, 'Order insertion failed');
        ordersFailed += Object.keys(transformedOrders).length;
      }
    }

    const result: FetchOrdersResult = {
      success: true,
      message: `Processed ${orderItems.length} orders`,
      ordersFound: orderItems.length,
      ordersInserted,
      ordersSkipped,
      ordersFailed,
      errors,
      duration: Date.now() - startTime,
    };

    logFetchSummary(logger, result);
    return result;

  } catch (error) {
    const msg = getErrorMessage(error);
    logger.error({ error: serializeError(error) }, 'Sportdeal order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>Sportdeal order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg }
    );

    const result = createFailedFetchResult(msg, Date.now() - startTime);
    logFetchSummary(logger, result);
    return result;
  }
}

/** Context shared across all order transformations within a single fetch run. */
interface TransformContext {
  storeName: string;
  storeId: number;
  currencyCode: string;
  conversionRate: number;
  logger: ReturnType<typeof createExecutionContext>['logger'];
}

/**
 * Transform a single Sportdeal order detail into MOP-ready format.
 *
 * @param order - Full order detail from Sportdeal API
 * @param ctx - Shared context (store, currency, logger) for the current fetch run
 * @returns TransformedOrder or null if no valid products
 */
async function transformSportdealOrder(
  order: SportdealOrderDetailResponse,
  ctx: TransformContext
) {
  const { storeName, storeId, currencyCode, conversionRate, logger } = ctx;
  const orderId = String(order.id);
  const now = new Date();

  // Parse order creation date
  // WHY: Sportdeal returns empty array [] instead of null for missing dates
  const orderDate = order.created_at && !Array.isArray(order.created_at)
    ? new Date(order.created_at)
    : null;

  // Parse expected arrival date for ship-by date
  const shipByDate = order.original_expected_arrival_date && !Array.isArray(order.original_expected_arrival_date)
    ? new Date(order.original_expected_arrival_date)
    : null;

  const orderStatus = getSportdealOrderStatus(order.order_status);
  const customerName = `${(order.first_name || '').trim()} ${(order.last_name || '').trim()}`.trim();

  // Get country name from ISO code (e.g., "NL" → "Netherlands")
  const countryName = await getCountryNameFromIsoCode(order.shipping_countryid || '', logger)
    || order.shipping_countryid || '';

  // Parse products
  const items = parseSportdealOrderItems(order.order_items);
  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];

  // WHY: The Sportdeal API provides VAT at order level only, not per product.
  // We distribute it proportionally by each product's price contribution.
  // The old code (bug H2) duplicated the full order VAT to every product,
  // inflating total VAT for multi-item orders.
  const orderVat = parseFloat(String(order.vat || '0'));
  const orderCommission = parseFloat(String(order.commission || '0'));
  const supplierCostPrice = parseFloat(String(order.final_cost_price || '0'));
  let totalProductValue = 0;

  // Store Sportdeal financial breakdown in mopExtraInfo for audit/reference
  const sportdealFinancials = JSON.stringify({
    supplierCostPrice,
    commission: orderCommission,
    vat: orderVat,
    customerDeliveryCost: parseFloat(String(order.delivery_customer ?? 0)),
  });

  // First pass: calculate total product value for VAT distribution
  for (const item of items) {
    const qty = item.quantity ?? 0;
    if (qty <= 0) continue;
    const itemCost = item.cost_price != null ? parseFloat(String(item.cost_price)) : parseFloat(item.price || '0');
    totalProductValue += itemCost * qty;
  }

  // Second pass: create product records
  for (const item of items) {
    // WHY: Use nullish coalescing, not logical OR.
    // `quantity || 1` turns 0 into 1 (bug Q5). `quantity ?? 0` preserves 0.
    const qty = item.quantity ?? 0;
    if (qty <= 0) {
      logger.debug({ orderId, sku: item.supplier_sku, quantity: item.quantity }, 'Skipping product with zero quantity');
      continue;
    }

    const sku = item.supplier_sku;
    const productDetails = await getProductVariationDataFromSKU(sku, logger);

    if (!productDetails || !productDetails.npvProductsId) {
      logger.error({ orderId, sku }, 'SKU not found in new_products_variations');
      if (!missingSKUs.find(m => m.sku === sku)) {
        missingSKUs.push({ sku, productName: item.name || '' });
      }
      continue;
    }

    // WHY: cost_price is the actual item cost (commission excluded).
    // price is commission-inclusive and should not be used as UKSS's cost.
    // parseFloat(String(...)) guards against the API returning cost_price as a string
    // (Sportdeal has a history of inconsistent types — see parseSportdealOrderItems).
    const unitPrice = item.cost_price != null ? parseFloat(String(item.cost_price)) : parseFloat(item.price || '0');
    const lineTotal = unitPrice * qty;

    // Distribute VAT proportionally by price ratio
    const vatShare = totalProductValue > 0
      ? (orderVat * lineTotal) / totalProductValue
      : 0;
    const vatPerUnit = vatShare / qty;

    // Create one record per unit (Stage 3 expects quantity=1 per record)
    for (let i = 0; i < qty; i++) {
      products.push({
        mopStoreName: storeName,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        mopProductId: null,
        mopProductSku: sku,
        mopProductStatus: null,
        mopProductName: item.name || null,
        mopProductUpcEan: item.ean || null,
        mopProductPrice: unitPrice,
        mopProductVatAmount: vatPerUnit,
        mopProductVatIncluded: '1',
        mopProductQuantity: 1,
        mopProductAttributeName: null,
        mopUkssProductSku: productDetails.npvSku || sku,
        mopUkssProductId: String(productDetails.npvProductsId),
        mopExtraInfo: sportdealFinancials,
        mopUkssProductConfirmationStatus: null,
        mopUkssProductShippingStatus: null,
        mopUkssProductCancelReason: null,
        mopUkssProductReturnReason: null,
        mopUkssTrackingCode: null,
        mopUkssShippingCarrier: null,
        mopCreatedBy: CREATED_BY,
        mopModifiedBy: CREATED_BY,
        mopDateAdded: now,
        mopDateModified: now,
      });
    }
  }

  // Email notification for missing SKUs
  if (missingSKUs.length > 0) {
    logger.warn({ orderId, missingSKUs }, 'Order has products with missing SKUs');
    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order ${orderId} - Missing SKUs`,
      `Hi Team,<br><br>Sportdeal Order <b>${escapeHtml(orderId)}</b> has products with missing SKUs:<br><ul>${missingSKUs.map(m => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>`,
      { orderId, missingSKUs }
    );
  }

  // Warn if no valid products but still create the order
  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation - will still create order header');
  }

  const shippingMethod = config.SPORTDEAL_SHIPPING_METHOD || 'Sportdeal Standard';
  const shippingTotal = parseFloat(String(order.order_delivery_cost ?? order.delivery_cost ?? 0));
  const orderTotal = supplierCostPrice + shippingTotal;

  return {
    MoMarketplaceOrder: {
      moStoreName: storeName,
      moStoreId: storeId,
      moOrderId: orderId,
      moOrderPlaceDate: orderDate,
      moOrderUpdateDate: orderDate,
      moOrderShipByDate: shipByDate,
      moOrderStatus: orderStatus || null,
      moOrderCustomerId: order.customer_order_id || null,
      moOrderCustomerEmail: order.customer_email || null,
      moOrderShippingMethod: shippingMethod,
      moOrderShippingLine1: (order.shipping_house_number || '').trim() || null,
      moOrderShippingLine2: (order.shipping_street || '').trim() || null,
      moOrderShippingLine3: null,
      moOrderCustomerName: customerName || null,
      moCustomerPhone: order.customer_phone || null,
      moOrderShippingCity: (order.shipping_city || '').trim() || null,
      moOrderShippingState: (order.shipping_region || '').trim() || null,
      moOrderShippingCountry: countryName,
      moOrderShippingZipcode: (order.shipping_zipcode || '').trim() || null,
      moUkssConversionRate: conversionRate,
      moOrderCurrency: currencyCode,
      moOrderSubtotal: supplierCostPrice,
      moShippingTotal: shippingTotal,
      moOrderTotal: orderTotal,
      moUkssOrderId: null,
      moCreatedBy: CREATED_BY,
      moModifiedBy: CREATED_BY,
      moDateAdded: now,
      moDateModified: now,
    },
    MopMarketplaceOrderProduct: products,
    MoshMarketplaceOrderStatusHistory: {
      moshMoOrderId: orderId,
      moshMoId: BigInt(0),
      moshMoOrderStatus: OrderStatus.PENDING,
      moshMuosmId: DEFAULT_INITIAL_STATUS_MAPPING_ID,
      moshCreatedBy: CREATED_BY,
      moshModifiedBy: CREATED_BY,
      moshDateAdded: now,
      moshDateModified: now,
    },
  };
}
