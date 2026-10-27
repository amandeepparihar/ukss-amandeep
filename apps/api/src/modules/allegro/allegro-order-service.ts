/**
 * Allegro Order Service
 *
 * Fetches orders from the Allegro marketplace API and inserts them into
 * the marketplace order (MOP) tables for processing by the shared pipeline.
 *
 * Pipeline: Stage 1 (Fetch) + Stage 2 (MOP Insert)
 * Cron: `pnpm cli fetch-allegro-orders` — runs every 30 minutes
 *
 * Architecture:
 *   - Uses OAuth2 with refresh token (tokens stored in store_management table)
 *   - Single-step fetch — checkout-forms endpoint returns full order details
 *   - Offset-based pagination (limit=100, ceiling: offset+limit <= 10,000)
 *   - VAT is included in product prices, calculated per item using tax.rate
 *   - Content-Type must be application/vnd.allegro.public.v1+json
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
import { createLogger } from '../../lib/logger';
import {
  getValidAllegroAccessToken,
  getAllegroOrderStatus,
  extractSkuFromLineItem,
  calculateVatFromInclusivePrice,
} from '../../lib/allegro/allegro-order-data.utils';
import type {
  AllegroCheckoutFormsResponse,
  AllegroCheckoutForm,
  AllegroLineItem,
} from './allegro-api.types';
import { ALLEGRO_CONTENT_TYPE } from './allegro-api.types';

const MARKETPLACE_NAME = 'Allegro';
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);

/** Separate logger for raw API response data (for debugging/audit) */
const feedLogger = createLogger('allegro-order-feed');

/** Maximum orders per page from Allegro API */
const PAGE_LIMIT = 100;

/**
 * Fetch orders from Allegro API and insert into marketplace order tables.
 *
 * Pipeline: Stage 1 (Fetch) + Stage 2 (MOP Insert)
 *
 * Flow:
 *   1. Get valid OAuth access token (refresh if expired)
 *   2. Determine date range from last fetched order
 *   3. Fetch all pages of READY_FOR_PROCESSING + NEW orders
 *   4. Transform each order to MOP format
 *   5. Insert via insertMarketPlaceOrderDetails()
 *
 * @param orderId - Optional specific order ID to fetch (Allegro checkout form ID)
 * @returns FetchOrdersResult with counts of found, inserted, skipped, failed orders
 */
export async function fetchAllegroOrders(orderId?: string): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('allegro-order-service');

  logger.info('Starting Allegro order fetch');

  try {
    // Validate required configuration
    const storeId = config.ALLEGRO_STORE_ID;
    const apiBaseUrl = config.ALLEGRO_API_BASE_URL;

    if (!storeId || !apiBaseUrl) {
      const msg = 'Missing required config: ALLEGRO_STORE_ID or ALLEGRO_API_BASE_URL';
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    // Get store details from database
    const storeDetails = await getStoreInfo(storeId, logger);
    if (!storeDetails) {
      const msg = `Store with ID ${storeId} not found in store_management table`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }
    const storeName = storeDetails.store_name;

    // Get currency details
    const currencyCode = config.ALLEGRO_CURRENCY || 'PLN';
    const currencyDetails = await getCurrencyDetails(currencyCode, logger);
    const conversionRate = currencyDetails?.conversionRate || 1;

    // Get valid OAuth access token (auto-refreshes if expired)
    const accessToken = await getValidAllegroAccessToken(storeId);

    // Create HTTP client with Bearer token auth
    const httpClient = createOrderHttpClient({
      baseUrl: apiBaseUrl,
      auth: {
        type: 'token-header',
        token: accessToken,
        tokenPrefix: 'Bearer',
      },
      rateLimit: {
        strategy: 'fixed',
        requestsPerMinute: 100,
        delayMs: 600,
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitter: true,
      },
      marketplace: MARKETPLACE_NAME,
    });

    // Stage 1: Fetch orders
    const allOrders: AllegroCheckoutForm[] = [];

    if (orderId) {
      // Single order fetch by ID: GET /order/checkout-forms/{id}
      logger.info({ orderId }, 'Fetching single order from Allegro API');

      const response = await httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${orderId}`,
        { headers: { 'Accept': ALLEGRO_CONTENT_TYPE } }
      );

      feedLogger.debug({ order: response.data }, 'Allegro single order data');
      allOrders.push(response.data);
    } else {
      // Batch fetch: determine date range
      const dateRange = await getLastFetchedOrderDate(storeId, logger);
      // WHY: On first run, no existing orders in DB → startDate is undefined.
      // Omit updatedAt.gte filter to fetch all READY_FOR_PROCESSING orders.
      const fromTime = dateRange.startDate?.toISOString();
      logger.info({ fromTime: fromTime || 'ALL', storeId }, 'Fetch date range determined');

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let url = `/order/checkout-forms?status=READY_FOR_PROCESSING&fulfillment.status=NEW&limit=${PAGE_LIMIT}&offset=${offset}`;
        if (fromTime) {
          url += `&updatedAt.gte=${encodeURIComponent(fromTime)}`;
        }

        logger.info({ url, offset }, 'Fetching orders page from Allegro API');

        const response = await httpClient.get<AllegroCheckoutFormsResponse>(url, {
          headers: { 'Accept': ALLEGRO_CONTENT_TYPE },
        });

        const pageData = response.data;

        // WHY: debug level — raw API responses contain customer PII (email, phone, address).
        feedLogger.debug({ orders: pageData }, 'Allegro orders page data');

        if (pageData.checkoutForms && pageData.checkoutForms.length > 0) {
          allOrders.push(...pageData.checkoutForms);
        }

        // Check if there are more pages
        offset += PAGE_LIMIT;
        // WHY: Allegro pagination ceiling — offset + limit cannot exceed 10,000
        hasMore = pageData.checkoutForms.length === PAGE_LIMIT && offset + PAGE_LIMIT <= 10000;
      }
    }

    if (allOrders.length === 0) {
      logger.info('No orders found from Allegro API');
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

    logger.info({ orderCount: allOrders.length }, 'Orders found, transforming');

    // Transform orders
    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const order of allOrders) {
      const orderId = order.id;

      try {
        // Check for duplicates before processing
        const exists = await getOrderStatus(orderId, storeDetails.store_id, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        // Transform to MOP format
        const transformed = await transformAllegroOrder(
          order,
          { storeName, storeId: storeDetails.store_id, currencyCode, conversionRate, logger }
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
          `Order Processing Failed - Order ${orderId}`,
          `Hi Team,<br><br>Failed to process order from Allegro API.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
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
        logger.warn({ insertStatus, totalAttempted: Object.keys(transformedOrders).length }, 'Some orders failed to insert');
        ordersInserted = Object.keys(transformedOrders).length;
        ordersFailed += 1;
      } else {
        logger.error({ insertStatus }, 'Order insertion failed');
        ordersFailed += Object.keys(transformedOrders).length;
      }
    }

    const result: FetchOrdersResult = {
      success: true,
      message: `Processed ${allOrders.length} orders`,
      ordersFound: allOrders.length,
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
    logger.error({ error: serializeError(error) }, 'Allegro order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>Allegro order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
 * Transform a single Allegro checkout form into MOP-ready format.
 *
 * @param order - Full checkout form from Allegro API
 * @param ctx - Shared context (store, currency, logger) for the current fetch run
 * @returns TransformedOrder or null if no valid products
 */
async function transformAllegroOrder(
  order: AllegroCheckoutForm,
  ctx: TransformContext
) {
  const { storeName, storeId, currencyCode, conversionRate, logger } = ctx;
  const orderId = order.id;
  const now = new Date();

  // Parse dates
  const orderDate = order.lineItems[0]?.boughtAt
    ? new Date(order.lineItems[0].boughtAt)
    : new Date(order.updatedAt);

  const orderUpdateDate = new Date(order.updatedAt);

  // Ship-by date from delivery dispatch window
  const shipByDate = order.delivery.time?.dispatch?.to
    ? new Date(order.delivery.time.dispatch.to)
    : null;

  // Combined status string
  const orderStatus = getAllegroOrderStatus(order.status, order.fulfillment.status);

  // Customer name from delivery address (delivery address is the shipping destination)
  const customerName = `${(order.delivery.address.firstName || '').trim()} ${(order.delivery.address.lastName || '').trim()}`.trim();

  // Get country name from ISO code (e.g., "PL" -> "Poland")
  const countryName = await getCountryNameFromIsoCode(order.delivery.address.countryCode || '', logger)
    || order.delivery.address.countryCode || '';

  // Parse products
  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];

  // Calculate subtotal from line items
  let subtotal = 0;

  for (const item of order.lineItems) {
    const qty = item.quantity ?? 0;
    if (qty <= 0) {
      logger.debug({ orderId, offerId: item.offer.id, quantity: item.quantity }, 'Skipping line item with zero quantity');
      continue;
    }

    const sku = extractSkuFromLineItem(item);
    if (!sku) {
      logger.error({ orderId, offerId: item.offer.id }, 'Line item has no external ID (SKU)');
      missingSKUs.push({ sku: item.offer.id, productName: item.offer.name });
      continue;
    }

    const productDetails = await getProductVariationDataFromSKU(sku, logger);

    if (!productDetails || !productDetails.npvProductsId) {
      logger.error({ orderId, sku }, 'SKU not found in new_products_variations');
      if (!missingSKUs.find(m => m.sku === sku)) {
        missingSKUs.push({ sku, productName: item.offer.name });
      }
      continue;
    }

    const unitPrice = parseFloat(item.price.amount);
    const taxRate = parseFloat(item.tax.rate);
    const vatPerUnit = calculateVatFromInclusivePrice(unitPrice, taxRate);

    subtotal += unitPrice * qty;

    // Create one record per unit (Stage 3 expects quantity=1 per record)
    for (let i = 0; i < qty; i++) {
      products.push({
        mopStoreName: storeName,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        mopProductId: null,
        mopProductSku: sku,
        mopProductStatus: null,
        mopProductName: item.offer.name || null,
        mopProductUpcEan: null,
        mopProductPrice: unitPrice,
        mopProductVatAmount: vatPerUnit,
        mopProductVatIncluded: '1',
        mopProductQuantity: 1,
        mopProductAttributeName: null,
        mopUkssProductSku: productDetails.npvSku || sku,
        mopUkssProductId: String(productDetails.npvProductsId),
        mopExtraInfo: null,
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
      `Hi Team,<br><br>Allegro Order <b>${escapeHtml(orderId)}</b> has products with missing SKUs:<br><ul>${missingSKUs.map(m => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>`,
      { orderId, missingSKUs }
    );
  }

  // Warn if no valid products but still create the order
  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation - will still create order header');
  }

  const shippingMethod = config.ALLEGRO_SHIPPING_METHOD || order.delivery.method.name || 'Allegro Standard';
  const shippingTotal = parseFloat(order.delivery.cost.amount);
  const orderTotal = parseFloat(order.summary.totalToPay.amount);

  return {
    MoMarketplaceOrder: {
      moStoreName: storeName,
      moStoreId: storeId,
      moOrderId: orderId,
      moOrderPlaceDate: orderDate,
      moOrderUpdateDate: orderUpdateDate,
      moOrderShipByDate: shipByDate,
      moOrderStatus: orderStatus || null,
      moOrderCustomerId: order.buyer.id || null,
      moOrderCustomerEmail: order.buyer.email || null,
      moOrderShippingMethod: shippingMethod,
      moOrderShippingLine1: (order.delivery.address.street || '').trim() || null,
      moOrderShippingLine2: (order.delivery.address.companyName || '').trim() || null,
      moOrderShippingLine3: null,
      moOrderCustomerName: customerName || null,
      moCustomerPhone: order.delivery.address.phoneNumber || order.buyer.phoneNumber || null,
      moOrderShippingCity: (order.delivery.address.city || '').trim() || null,
      moOrderShippingState: null,
      moOrderShippingCountry: countryName,
      moOrderShippingZipcode: (order.delivery.address.zipCode || '').trim() || null,
      moUkssConversionRate: conversionRate,
      moOrderCurrency: currencyCode,
      moOrderSubtotal: subtotal,
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
