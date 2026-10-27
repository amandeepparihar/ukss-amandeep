/**
 * OnBuy Order Service — Stage 1 + Stage 2
 *
 * Fetches orders from the OnBuy marketplace API and inserts them into the
 * marketplace order (MO/MOP) tables for processing by the shared pipeline.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 * Cron: every 15 minutes
 *
 * Architecture:
 *   - Auth via OnBuyClient.fetchAccessToken() (cached, two-step request-token flow)
 *   - Single-step fetch: full orders are returned by GET ONBUY_ORDERS_API_URL
 *   - Reuses shared order helpers from modules/marketplaces/orders/
 *
 * Legacy parity source: marketplace_orders_controller.php lines 1188-1509 (PMS 158188).
 */

import { config } from '../../config';
import { getCountryNameFromIsoCode } from '../../lib/helpers/common-utils';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createLogger } from '../../lib/logger';
import { createOnBuyClient } from '../../lib/marketplaces/onbuy/client';
import { extractOnBuyOrders, parsePrice, parseQuantity } from '../../lib/onbuy/onbuy-order-data.utils';
import {
  createExecutionContext,
  logFetchSummary,
  sendOrderFailureEmail,
  createFailedFetchResult,
  serializeError,
  getErrorMessage,
  insertMarketPlaceOrderDetails,
  getOrderStatus,
  getStoreInfo,
  getCurrencyDetails,
  getProductVariationDataFromSKU,
  type FetchOrdersResult,
  type TransformedOrder,
  type TransformedOrderMap,
  OrderStatus,
  AUDIT_USER,
  getCreatedByLabel,
  DEFAULT_INITIAL_STATUS_MAPPING_ID,
} from '../marketplaces/orders';
import type { OnBuyOrder, OnBuyOrdersListEnvelope } from './onbuy-api.types';

const MARKETPLACE_NAME = 'OnBuy';
const ONBUY_STORE_ID = config.ONBUY_STORE_ID;
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);

/** Separate logger for raw API response data (PII). Filtered out at info level in production. */
const feedLogger = createLogger('onbuy-order-feed');

/**
 * Fetch orders from OnBuy and insert into marketplace order tables.
 *
 * Flow:
 *   1. Resolve store + currency once (avoid per-order DB hits).
 *   2. Fetch a fresh access token (cached internally for ~60s buffer).
 *   3. GET ONBUY_ORDERS_API_URL with bare token in Authorization header.
 *   4. For each order: dedup → transform → expand quantities → collect.
 *   5. insertMarketPlaceOrderDetails() to persist via the shared Stage 3 entry.
 */
export async function fetchOnbuyOrders(): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('onbuy-order-service');

  logger.info('Starting OnBuy order fetch');

  try {
    const ordersApiUrl = config.ONBUY_ORDERS_API_URL;
    if (!ordersApiUrl) {
      const msg = 'ONBUY_ORDERS_API_URL is not configured';
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    // Defensive check: ensure store row exists before we try inserting orders against it.
    const storeDetails = await getStoreInfo(ONBUY_STORE_ID, logger);
    if (!storeDetails) {
      const msg = `Store with ID ${ONBUY_STORE_ID} not found in store_management table`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const onbuyClient = createOnBuyClient('onbuy');
    const accessToken = await onbuyClient.fetchAccessToken(executionId);

    logger.info({ url: ordersApiUrl }, 'Fetching orders from OnBuy API');
    const response = await fetch(ordersApiUrl, {
      method: 'GET',
      headers: {
        // WHY bare token (no "Bearer "): OnBuy expects the raw token. See legacy line 1262.
        Authorization: accessToken,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const msg = `OnBuy orders API returned HTTP ${response.status}`;
      logger.error({ status: response.status, body }, msg);

      await sendOrderFailureEmail(
        MARKETPLACE_NAME,
        'Order Fetch Failed',
        `Hi Team,<br><br>OnBuy orders API failed.<br><b>Status:</b> ${response.status}<br><b>URL:</b> ${escapeHtml(ordersApiUrl)}<br><b>Response:</b> ${escapeHtml(body.slice(0, 1000))}`,
        { executionId, status: response.status }
      );

      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const envelope = (await response.json()) as OnBuyOrdersListEnvelope;
    feedLogger.debug({ envelope }, 'OnBuy orders raw response');

    const onbuyOrders = extractOnBuyOrders(envelope);
    if (onbuyOrders.length === 0) {
      logger.info('No orders found from OnBuy API');
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

    logger.info({ orderCount: onbuyOrders.length }, 'Orders received, processing');

    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const order of onbuyOrders) {
      const orderId = order.order_id;
      try {
        const exists = await getOrderStatus(orderId, ONBUY_STORE_ID, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        const transformed = await transformOnbuyOrder(order, {
          storeId: ONBUY_STORE_ID,
          executionId,
          logger,
        });

        if (transformed) {
          transformedOrders[orderId] = transformed;
        } else {
          ordersFailed++;
          errors.push({ orderId, error: 'Order had no products to insert' });
        }
      } catch (error) {
        ordersFailed++;
        const msg = getErrorMessage(error);
        errors.push({ orderId, error: msg });
        logger.error({ orderId, error: serializeError(error) }, 'Failed to process order');

        await sendOrderFailureEmail(
          MARKETPLACE_NAME,
          `Order Processing Failed - Order ${orderId}`,
          `Hi Team,<br><br>Failed to process OnBuy order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
          { executionId, orderId, error: msg }
        );
      }
    }

    let ordersInserted = 0;
    if (Object.keys(transformedOrders).length > 0) {
      logger.info({ orderCount: Object.keys(transformedOrders).length }, 'Inserting orders into MOP tables');
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
      message: `Processed ${onbuyOrders.length} orders`,
      ordersFound: onbuyOrders.length,
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
    logger.error({ error: serializeError(error) }, 'OnBuy order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>OnBuy order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg }
    );

    const result = createFailedFetchResult(msg, Date.now() - startTime);
    logFetchSummary(logger, result);
    return result;
  }
}

interface TransformContext {
  storeId: number;
  executionId: string;
  logger: ReturnType<typeof createExecutionContext>['logger'];
}

/**
 * Transform a single OnBuy order into the TransformedOrder shape consumed by
 * insertMarketPlaceOrderDetails().
 *
 * Field mapping is locked to legacy parity — see ONBUY_ORDER_INTEGRATION_PLAN.md §6.
 */
async function transformOnbuyOrder(order: OnBuyOrder, ctx: TransformContext): Promise<TransformedOrder> {
  const { storeId, executionId, logger } = ctx;
  const orderId = order.order_id;
  const now = new Date();

  const orderPlaceDate = order.date ? new Date(order.date) : null;
  const orderUpdateDate = order.updated_at ? new Date(order.updated_at) : null;

  const currencyCode = order.currency_code || 'GBP';
  const currencyDetails = await getCurrencyDetails(currencyCode, logger);
  const conversionRate = currencyDetails?.conversionRate ?? 1;

  // WHY country name: legacy stores the resolved country name (e.g. "United Kingdom"),
  // not the ISO-2 code. Despite the misleading PHP method name CountryNameToCountryISOCode2,
  // the legacy implementation maps ISO-2 → name. See country.php lines 7-21.
  const countryName = await getCountryNameFromIsoCode(order.delivery_address?.country_code || '', logger)
    || order.delivery_address?.country_code
    || '';

  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];

  for (const product of order.products || []) {
    const qty = parseQuantity(product.quantity);
    if (qty <= 0) {
      logger.debug({ orderId, sku: product.sku, quantity: product.quantity }, 'Skipping product with zero/invalid quantity');
      continue;
    }

    const unitPrice = parsePrice(product.total_price);
    const productDetails = await getProductVariationDataFromSKU(product.sku, logger);

    // WHY empty string (not null) when SKU missing:
    // mop_ukss_product_id is NOT NULL in the live DB (Prisma schema confirms `String`,
    // not `String?`). Legacy PHP simply doesn't set the array key in that branch,
    // so MySQL writes the column default (empty string). Mirror that behaviour explicitly.
    // The downstream UKSS converter (marketplace-orders.service.ts) treats falsy values
    // as null when populating orders_products.products_id, so manual reconciliation still works.
    let mopUkssProductId = '';
    if (productDetails?.npvProductsId) {
      mopUkssProductId = String(productDetails.npvProductsId);
    } else {
      logger.error({ orderId, sku: product.sku }, 'SKU not found in new_products_variations');
      if (!missingSKUs.find((m) => m.sku === product.sku)) {
        missingSKUs.push({ sku: product.sku, productName: product.name || '' });
      }
      // WHY continue (not skip whole order): legacy parity (lines 1430-1437).
    }

    // WHY one row per unit: legacy parity (lines 1410-1411). Stage 3 expects mopProductQuantity=1.
    for (let i = 0; i < qty; i++) {
      products.push({
        mopStoreName: MARKETPLACE_NAME,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        mopProductId: product.onbuy_internal_reference || null,
        mopProductSku: product.sku,
        mopProductStatus: null,
        mopProductName: product.name || null,
        mopProductUpcEan: null,
        // WHY total_price duplicated (not divided by qty): legacy parity (line 1420 + PMS 158584).
        mopProductPrice: unitPrice,
        mopProductVatAmount: null,
        mopProductVatIncluded: '1',
        mopProductQuantity: 1,
        mopProductAttributeName: product.product_options ?? null,
        mopUkssProductSku: product.sku,
        mopUkssProductId,
        mopExtraInfo: null,
        mopUkssProductConfirmationStatus: null,
        mopUkssProductShippingStatus: null,
        mopUkssProductCancelReason: null,
        mopUkssProductReturnReason: null,
        mopUkssTrackingCode: null,
        mopUkssShippingCarrier: null,
        mopCreatedBy: AUDIT_USER,
        mopModifiedBy: AUDIT_USER,
        mopDateAdded: now,
        mopDateModified: now,
      });
    }
  }

  if (missingSKUs.length > 0) {
    logger.warn({ orderId, missingSKUs }, 'Order has products with missing SKUs');
    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order ${orderId} - Missing SKUs`,
      `Hi Team,<br><br>OnBuy Order <b>${escapeHtml(orderId)}</b> contains SKUs not found in new_products_variations:<br><ul>${missingSKUs.map((m) => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>`,
      { executionId, orderId, missingSKUs }
    );
  }

  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation - will still create order header');
  }

  const orderSubtotal = parsePrice(order.price_subtotal);
  const shippingTotal = parsePrice(order.price_delivery);
  const orderTotal = parsePrice(order.price_total);

  // WHY `as unknown as TransformedOrder`:
  // The shared MopProductData type declares `mopProductVatAmount: number`, but the live
  // mop_marketplace_order_products.mop_product_vat_amount column is nullable
  // (Decimal? in Prisma) and legacy OnBuy writes NULL there. Asserting through unknown
  // keeps legacy parity without weakening the contract for marketplaces that DO write a number.
  const result = {
    MoMarketplaceOrder: {
      moStoreName: MARKETPLACE_NAME,
      moStoreId: storeId,
      moOrderId: orderId,
      moOrderPlaceDate: orderPlaceDate,
      moOrderUpdateDate: orderUpdateDate,
      moOrderShipByDate: null,
      // WHY raw API status (e.g. "Awaiting Dispatch"): legacy parity (line 1384).
      moOrderStatus: order.status || null,
      moOrderCustomerId: null,
      moOrderCustomerEmail: order.buyer?.email || null,
      moCustomerPhone: order.buyer?.phone ?? null,
      moOrderCustomerName: order.buyer?.name || null,
      moOrderShippingMethod: order.delivery_service || null,
      moOrderShippingLine1: order.delivery_address?.line_1 || null,
      moOrderShippingLine2: order.delivery_address?.line_2 ?? null,
      moOrderShippingLine3: order.delivery_address?.line_3 ?? null,
      moOrderShippingCity: order.delivery_address?.town || null,
      moOrderShippingState: order.delivery_address?.county ?? null,
      moOrderShippingCountry: countryName,
      moOrderShippingZipcode: order.delivery_address?.postcode || null,
      moOrderCurrency: currencyCode,
      moUkssConversionRate: conversionRate,
      moOrderSubtotal: orderSubtotal,
      moShippingTotal: shippingTotal,
      moOrderTotal: orderTotal,
      moUkssOrderId: null,
      moCreatedBy: AUDIT_USER,
      moModifiedBy: AUDIT_USER,
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
  return result as unknown as TransformedOrder;
}
