/**
 * eBay Order Service — Stage 1+2 Implementation
 *
 * Fetches orders from the eBay Trading API and inserts them into
 * the marketplace order (MOP) tables for processing by the shared pipeline.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 * Cron: `pnpm cli fetch-ebay-orders` — runs every 30 minutes
 *
 * Architecture:
 *   - Uses OAuth 2.0 for authentication (refresh token → access token)
 *   - Single-step fetch pattern (GetOrders returns full order data)
 *   - XML-based API (not JSON) with POST requests
 *   - Uses shared order infrastructure from modules/marketplaces/orders/
 *   - Produces TransformedOrderMap consumed by insertMarketPlaceOrderDetails()
 *
 * Known API constraints:
 *   - Max 100 orders per API call (pagination via HasMoreOrders flag)
 *   - Email addresses often masked as "Invalid Request" (use BuyerUserID)
 *   - Variation/SKU takes priority over Item/SKU
 *   - UK prices include 20% VAT (calculate backwards if TaxAmount = 0)
 *   - Currency extracted from currencyID attribute on money fields
 */

import axios from 'axios';
import { config } from '../../config';
import { getCountryNameFromIsoCode } from '../../lib/helpers/common-utils';
import { escapeHtml } from '../../lib/utils/string-utils';
import {
  createExecutionContext,
  logFetchSummary,
  sendOrderFailureEmail,
  createFailedFetchResult,
  serializeError,
  getErrorMessage,
  insertMarketPlaceOrderDetails,
  getOrderStatusWithGlobalExternalId,
  getLastFetchedOrderDate,
  getEbayUkStoreInfo,
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
import { getEbayAccessToken, getEbayTradingApiEndpoint, isEbaySandboxEnvironment } from '../../lib/ebay/ebay-oauth';
import { buildGetOrdersRequest } from '../../lib/ebay/ebay-xml-builder';
import {
  parseGetOrdersResponse,
  extractOrdersArray,
  extractTransactionsArray,
  getTransactionSku,
  extractCurrency,
  extractMoneyValue,
  getEbayOrderStatus,
  calculateVatPerUnit,
  getBuyerEmail,
  hasMoreOrders,
  isErrorResponse,
  getErrorMessage as getEbayErrorMessage,
} from '../../lib/ebay/ebay-order-data.utils';
import type {
  EbayGetOrdersResponse,
  EbayOrder,
  EbayTransaction,
} from './ebay-api.types';

const MARKETPLACE_NAME = 'eBay';
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);

/** Separate logger for raw API response data (for debugging/audit) */
const feedLogger = createLogger('ebay-order-feed');

/**
 * Fetch orders from eBay API and insert into marketplace order tables.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 *
 * Flow:
 *   1. Get OAuth access token using refresh token
 *   2. Get date range from last fetched order
 *   3. Build GetOrders XML request with date range
 *   4. Call eBay Trading API (POST XML)
 *   5. Parse XML response to JavaScript objects
 *   6. Handle pagination if HasMoreOrders = true
 *   7. Check for duplicates before processing
 *   8. Transform each order to MOP format
 *   9. Insert via insertMarketPlaceOrderDetails()
 *
 * @returns FetchOrdersResult with counts of found, inserted, skipped, failed orders
 */
export async function fetchEbayOrders(): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('ebay-order-service');

  logger.info('Starting eBay order fetch');

  try {
    // WHY: Get eBay store from database using EBAY_STORE_ID from config
    const storeDetails = await getEbayUkStoreInfo(logger);
    if (!storeDetails) {
      const msg = `eBay store with ID ${config.EBAY_STORE_ID} not found in store_management table. Please verify EBAY_STORE_ID in .env`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const storeId = storeDetails.store_id;
    const storeName = storeDetails.store_name;

    // WHY: Use dynamic endpoint based on EBAY_TEST_ENVIRONMENT (sandbox vs live)
    const apiUrl = getEbayTradingApiEndpoint();
    const siteId = config.EBAY_API_SITEID;
    const isSandbox = isEbaySandboxEnvironment();

    logger.info({ storeId, storeName, apiUrl, siteId, isSandbox }, 'eBay configuration loaded');

    // Get OAuth access token
    logger.info('Obtaining eBay OAuth access token');
    const accessToken = await getEbayAccessToken();

    // Determine date range for fetching
    const dateRange = await getLastFetchedOrderDate(storeId, logger);

    // If no previous orders, use default lookback period
    const startDate = dateRange.startDate || new Date(
      Date.now() - (config.EBAY_DEFAULT_LOOKBACK_DAYS || 7) * 24 * 60 * 60 * 1000
    );
    const endDate = dateRange.endDate || new Date();

    const fromTime = startDate.toISOString();
    const toTime = endDate.toISOString();
    logger.info({ fromTime, toTime, storeId, isFirstRun: !dateRange.startDate }, 'Fetch date range determined');

    // Fetch orders with pagination
    const allOrders: EbayOrder[] = [];
    let pageNumber = 1;
    let hasMore = true;
    const ordersPerPage = config.EBAY_ORDERS_LIMIT || 10;

    while (hasMore) {
      logger.info({ pageNumber, ordersPerPage }, 'Fetching orders page from eBay API');

      // Build GetOrders XML request
      const xmlRequest = buildGetOrdersRequest({
        fromDate: fromTime,
        toDate: toTime,
        pageNumber,
        ordersPerPage,
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
            'X-EBAY-API-CALL-NAME': 'GetOrders',
            'X-EBAY-API-IAF-TOKEN': accessToken,
          },
          timeout: 60000, // 60 second timeout
        }
      );

      // Parse XML response
      const parsedResponse = parseGetOrdersResponse(response.data);

      // WHY: debug level — raw API responses contain customer PII (email, phone, address).
      // Only enable in development/debugging. Production log level filters this out.
      feedLogger.debug({ response: parsedResponse }, 'eBay GetOrders response');

      // Check for API errors
      if (isErrorResponse(parsedResponse)) {
        const errorMsg = getEbayErrorMessage(parsedResponse);
        logger.error({ error: errorMsg }, 'eBay API returned error');
        throw new Error(`eBay API error: ${errorMsg}`);
      }

      // Extract orders from response
      const ordersInPage = extractOrdersArray(parsedResponse);
      allOrders.push(...ordersInPage);

      logger.info({ ordersInPage: ordersInPage.length, totalSoFar: allOrders.length }, 'Orders fetched from page');

      // Check pagination
      hasMore = hasMoreOrders(parsedResponse);
      if (hasMore) {
        pageNumber++;
        logger.info({ nextPage: pageNumber }, 'More orders available, fetching next page');
      } else {
        logger.info('No more pages to fetch');
      }
    }

    if (allOrders.length === 0) {
      logger.info('No orders found from eBay API');
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

    logger.info({ orderCount: allOrders.length }, 'Orders found, transforming to MOP format');

    // Stage 2: Transform orders to MOP format
    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const order of allOrders) {
      const orderId = String(order.OrderID || '');

      try {
        // Check for duplicates before processing
        const exists = await getOrderStatusWithGlobalExternalId(orderId, storeId, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        // Check payment status - only process orders with successful payment
        const paymentStatus = order.CheckoutStatus?.eBayPaymentStatus;
        logger.debug({
          orderId,
          paymentStatus,
          orderStatus: order.OrderStatus,
          checkoutStatus: order.CheckoutStatus
        }, 'Checking payment status');

        if (paymentStatus !== 'NoPaymentFailure') {
          logger.info({
            orderId,
            paymentStatus,
            orderStatus: order.OrderStatus
          }, 'Order payment not cleared, skipping until payment succeeds');
          ordersSkipped++;
          continue;
        }

        // Get currency from order total
        const currencyCode = extractCurrency(order.Total);
        const currencyDetails = await getCurrencyDetails(currencyCode, logger);
        const conversionRate = currencyDetails?.conversionRate || 1;

        // Transform to MOP format
        const transformed = await transformEbayOrder(
          order,
          { storeName, storeId, currencyCode, conversionRate, logger }
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
          `Hi Team,<br><br>Failed to process eBay order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
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
        // Conservative: don't claim full insertion on partial result
        // Actual count is unknown without detailed response parsing
        logger.warn({ insertStatus, totalAttempted: Object.keys(transformedOrders).length }, 'Some orders failed to insert');
        ordersInserted = 0;
        ordersFailed += Object.keys(transformedOrders).length;
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
    logger.error({ error: serializeError(error) }, 'eBay order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>eBay order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
 * Transform a single eBay order into MOP-ready format.
 *
 * @param order - Full order detail from eBay API
 * @param ctx - Shared context (store, currency, logger) for the current fetch run
 * @returns TransformedOrder or null if no valid products
 */
async function transformEbayOrder(
  order: EbayOrder,
  ctx: TransformContext
) {
  const { storeName, storeId, currencyCode, conversionRate, logger } = ctx;
  const orderId = String(order.OrderID || '');
  const now = new Date();

  // Parse order dates
  const orderDate = order.CreatedTime ? new Date(order.CreatedTime) : null;
  const orderUpdateDate = order.CheckoutStatus?.LastModifiedTime
    ? new Date(order.CheckoutStatus.LastModifiedTime)
    : orderDate;

  // Get order status
  const orderStatus = getEbayOrderStatus(order.OrderStatus);
  const customerName = order.ShippingAddress?.Name || '';
  const customerEmail = getBuyerEmail(order);

  // Get country name from ISO code (e.g., "GB" → "United Kingdom")
  const countryCode = order.ShippingAddress?.Country || '';
  const countryName = await getCountryNameFromIsoCode(countryCode, logger)
    || order.ShippingAddress?.CountryName || countryCode;

  // Extract transactions (product line items)
  const transactions = extractTransactionsArray(order);
  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];

  // Process each transaction (product line)
  for (const txn of transactions) {
    const sku = getTransactionSku(txn);

    if (!sku) {
      logger.warn({ orderId, transaction: txn.OrderLineItemID }, 'Transaction has no SKU, skipping');
      continue;
    }

    // Lookup UKSS product ID from SKU
    const productDetails = await getProductVariationDataFromSKU(sku, logger);

    if (!productDetails || !productDetails.npvProductsId) {
      logger.error({ orderId, sku }, 'SKU not found in new_products_variations');
      if (!missingSKUs.find(m => m.sku === sku)) {
        missingSKUs.push({ sku, productName: txn.Item?.Title || '' });
      }
      continue;
    }

    // Extract pricing (VAT included in UK eBay prices)
    const unitPrice = extractMoneyValue(txn.TransactionPrice);
    const quantity = txn.QuantityPurchased ?? 0;

    // Validate quantity (pattern compliance: use ?? not || to handle 0 correctly)
    if (quantity <= 0) {
      logger.warn({ orderId, transaction: txn.OrderLineItemID }, 'Transaction has zero quantity, skipping');
      continue;
    }

    // WHY: TotalTaxAmount is for the entire transaction line (all units combined)
    // We need to divide by quantity to get VAT per unit
    const totalTaxAmount = extractMoneyValue(txn.Taxes?.TotalTaxAmount);
    const taxAmountPerUnit = totalTaxAmount > 0 ? totalTaxAmount / quantity : 0;
    const vatPerUnit = calculateVatPerUnit(unitPrice, taxAmountPerUnit);

    // WHY: Create one record per unit (Stage 3 expects quantity=1 per record)
    // Similar to Sportdeal multi-quantity handling pattern
    for (let i = 0; i < quantity; i++) {
      products.push({
        mopStoreName: storeName,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        mopProductId: txn.OrderLineItemID || null,
        mopProductSku: sku,
        mopProductStatus: null,
        mopProductName: txn.Item?.Title || null,
        mopProductUpcEan: null,
        mopProductPrice: unitPrice,
        mopProductVatAmount: vatPerUnit,
        mopProductVatIncluded: '1', // UK eBay prices include VAT
        mopProductQuantity: 1,
        mopProductAttributeName: txn.Variation?.VariationTitle || null,
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
      `Hi Team,<br><br>eBay Order <b>${escapeHtml(orderId)}</b> has products with missing SKUs:<br><ul>${missingSKUs.map(m => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>`,
      { orderId, missingSKUs }
    );
  }

  // Skip order if no valid products
  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation, skipping');
    return null;
  }

  // Calculate order totals
  const shippingMethod = order.ShippingServiceSelected?.ShippingService
    || order.ShippingDetails?.ShippingServiceOptions?.ShippingService
    || config.EBAY_SHIPPING_METHOD || 'eBay Standard';
  const shippingTotal = extractMoneyValue(order.ShippingServiceSelected?.ShippingServiceCost)
    || extractMoneyValue(order.ShippingDetails?.ShippingServiceOptions?.ShippingServiceCost)
    || 0;
  const orderSubtotal = extractMoneyValue(order.Subtotal) || 0;
  const orderTotal = extractMoneyValue(order.Total) || extractMoneyValue(order.AmountPaid) || 0;

  return {
    MoMarketplaceOrder: {
      moStoreName: storeName,
      moStoreId: storeId,
      moOrderId: orderId,
      moOrderPlaceDate: orderDate,
      moOrderUpdateDate: orderUpdateDate,
      moOrderShipByDate: null, // eBay doesn't provide ship-by date
      moOrderStatus: orderStatus || null,
      moOrderCustomerId: order.BuyerUserID || null,
      moOrderCustomerEmail: customerEmail,
      moOrderShippingMethod: shippingMethod,
      moOrderShippingLine1: (order.ShippingAddress?.Street1 || '').trim() || null,
      moOrderShippingLine2: (order.ShippingAddress?.Street2 || '').trim() || null,
      moOrderShippingLine3: null,
      moOrderCustomerName: customerName || null,
      moCustomerPhone: order.ShippingAddress?.Phone || null,
      moOrderShippingCity: (order.ShippingAddress?.CityName || '').trim() || null,
      moOrderShippingState: (order.ShippingAddress?.StateOrProvince || '').trim() || null,
      moOrderShippingCountry: countryName,
      moOrderShippingZipcode: (order.ShippingAddress?.PostalCode || '').trim() || null,
      moUkssConversionRate: conversionRate,
      moOrderCurrency: currencyCode,
      moOrderSubtotal: orderSubtotal,
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
