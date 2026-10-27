/**
 * Walmart Order Service — Stage 1 + Stage 2
 *
 * Fetches orders from the Walmart Marketplace API and inserts them into the
 * marketplace order (MO/MOP) tables for processing by the shared pipeline.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert) → Stage 3 (shared)
 * Cron: every 15 minutes (host-side cron, not in this repo)
 *
 * Architecture:
 *   - Auth via WalmartClient.fetchAccessToken() (cached, OAuth2 client_credentials with Basic header)
 *   - Single-step fetch: GET /v3/orders?status=Created returns full orders in result.list.elements.order[]
 *   - Reuses shared order helpers from modules/marketplaces/orders/
 *
 * JS Admin task: #165070. Legacy parity source: marketplace_orders_controller.php:1530-1881.
 * Field mapping locked in documentation/WALMART_ORDER_INTEGRATION_PLAN.md §6.
 */

import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createLogger } from '../../lib/logger';
import { createWalmartClient } from '../../lib/marketplaces/walmart/client';
import {
  parseWalmartQuantity,
  sumWalmartOrderTotals,
  walmartTimestampToDate,
  walmartLineUnitPrice,
  walmartLineUnitVat,
  walmartLineStatus,
} from '../../lib/walmart/walmart-order-data.utils';
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
import type { WalmartOrder, WalmartOrdersListEnvelope } from './walmart-api.types';

const MARKETPLACE_NAME = 'Walmart';
const WALMART_STORE_ID = config.WALMART_STORE_ID;
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);

/**
 * Hardcoded values that match legacy parity (marketplace_orders_controller.php:1740-1828).
 * Walmart only sells in the US for UKSS, so these are fixed.
 */
const WALMART_INITIAL_ORDER_STATUS = 'Created'; // line 1740
const WALMART_SHIPPING_METHOD = 'Standard Shipping'; // line 1743
const WALMART_SHIPPING_COUNTRY = 'United States'; // line 1821
const WALMART_SHIPPING_TOTAL = 0; // line 1828

/** Separate logger for raw API response data (PII). Filtered out at info level in production. */
const feedLogger = createLogger('walmart-order-feed');

/**
 * Fetch orders from Walmart Marketplace and insert into marketplace order tables.
 *
 * Flow:
 *   1. Resolve store row up-front so we fail fast on misconfiguration.
 *   2. Fetch a fresh access token (cached internally).
 *   3. GET {WALMART_API_URL}/v3/orders?status=Created with WM_SEC.ACCESS_TOKEN headers.
 *   4. For each order: dedup → transform → expand quantities → collect.
 *   5. insertMarketPlaceOrderDetails() to persist via the shared Stage 3 entry.
 */
export async function fetchWalmartOrders(): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('walmart-order-service');

  logger.info('Starting Walmart order fetch');

  try {
    // Defensive check: ensure store row exists before we try inserting orders against it.
    const storeDetails = await getStoreInfo(WALMART_STORE_ID, logger);
    if (!storeDetails) {
      const msg = `Store with ID ${WALMART_STORE_ID} not found in store_management table`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const walmartClient = createWalmartClient();
    const accessToken = await walmartClient.fetchAccessToken(executionId);

    const ordersUrl = `${walmartClient.getBaseUrl()}/v3/orders?status=Created`;
    const correlationId = walmartClient.generateCorrelationId('WALMART_ORDERS');

    logger.info({ url: ordersUrl, correlationId }, 'Fetching orders from Walmart API');

    const response = await fetch(ordersUrl, {
      method: 'GET',
      headers: walmartClient.buildApiHeaders(accessToken, correlationId),
    });

    if (!response.ok) {
      const body = await response.text();
      const msg = `Walmart orders API returned HTTP ${response.status}`;
      logger.error({ status: response.status, body, correlationId }, msg);

      await sendOrderFailureEmail(
        MARKETPLACE_NAME,
        'Order Fetch Failed',
        `Hi Team,<br><br>Walmart orders API failed.<br><b>Status:</b> ${response.status}<br><b>URL:</b> ${escapeHtml(ordersUrl)}<br><b>Response:</b> ${escapeHtml(body.slice(0, 1000))}`,
        { executionId, status: response.status, correlationId }
      );

      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const envelope = (await response.json()) as WalmartOrdersListEnvelope;
    feedLogger.debug({ envelope }, 'Walmart orders raw response');

    // WHY 3-level nesting: Walmart wraps orders as { list: { elements: { order: [...] } } }.
    // `list` may be entirely absent on empty responses — handle that cleanly.
    const walmartOrders = envelope.list?.elements?.order ?? [];

    if (walmartOrders.length === 0) {
      logger.info('No orders found from Walmart API');
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

    logger.info({ orderCount: walmartOrders.length }, 'Orders received, processing');

    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const order of walmartOrders) {
      const orderId = order.purchaseOrderId;
      try {
        // PM #163348: dedup by both order_id AND store_id.
        const exists = await getOrderStatus(orderId, WALMART_STORE_ID, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        const transformed = await transformWalmartOrder(order, {
          storeId: WALMART_STORE_ID,
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
          `Hi Team,<br><br>Failed to process Walmart order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
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
      message: `Processed ${walmartOrders.length} orders`,
      ordersFound: walmartOrders.length,
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
    logger.error({ error: serializeError(error) }, 'Walmart order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>Walmart order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
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
 * Transform a single Walmart order into the TransformedOrder shape consumed by
 * insertMarketPlaceOrderDetails().
 *
 * Field mapping is locked to legacy parity — see WALMART_ORDER_INTEGRATION_PLAN.md §6.
 */
async function transformWalmartOrder(
  order: WalmartOrder,
  ctx: TransformContext
): Promise<TransformedOrder> {
  const { storeId, executionId, logger } = ctx;
  const orderId = order.purchaseOrderId;
  const now = new Date();

  const orderPlaceDate = walmartTimestampToDate(order.orderDate) ?? now;
  // Legacy uses NOW() for mo_order_update_date (line 1737).
  const orderUpdateDate = now;
  const orderShipByDate = walmartTimestampToDate(order.shippingInfo?.estimatedDeliveryDate) ?? null;

  const totals = sumWalmartOrderTotals(order);
  const currencyCode = totals.currency || 'USD';
  const currencyDetails = await getCurrencyDetails(currencyCode, logger);
  const conversionRate = currencyDetails?.conversionRate ?? 1;

  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];

  for (const line of order.orderLines.orderLine) {
    const qty = parseWalmartQuantity(line.orderLineQuantity?.amount);
    if (qty <= 0) {
      logger.debug(
        { orderId, lineNumber: line.lineNumber, sku: line.item?.sku, quantity: line.orderLineQuantity?.amount },
        'Skipping line with zero/invalid quantity'
      );
      continue;
    }

    const unitPrice = walmartLineUnitPrice(line);
    const unitVat = walmartLineUnitVat(line);
    const lineStatus = walmartLineStatus(line);
    const sku = line.item?.sku ?? '';

    const productDetails = await getProductVariationDataFromSKU(sku, logger);

    // Mirror OnBuy behaviour: column is NOT NULL in the live DB; legacy PHP simply doesn't set
    // the array key in the not-found branch, which MySQL maps to the empty-string default.
    let mopUkssProductId = '';
    if (productDetails?.npvProductsId) {
      mopUkssProductId = String(productDetails.npvProductsId);
    } else {
      logger.error({ orderId, sku }, 'SKU not found in new_products_variations');
      if (sku && !missingSKUs.find((m) => m.sku === sku)) {
        missingSKUs.push({ sku, productName: line.item?.productName || '' });
      }
      // WHY continue (not skip whole order): legacy parity (lines 1789-1798).
    }

    // WHY one row per unit: legacy parity (line 1767). Stage 3 expects mopProductQuantity=1.
    for (let i = 0; i < qty; i++) {
      products.push({
        mopStoreName: MARKETPLACE_NAME,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        // mop_product_id stores the per-line index (Walmart `lineNumber`). Line 1772.
        mopProductId: line.lineNumber,
        mopProductSku: sku,
        // mop_product_status stores the line's reported status (e.g. "Created"). Line 1774.
        mopProductStatus: lineStatus,
        mopProductName: line.item?.productName || null,
        mopProductUpcEan: null,
        // chargeAmount.amount is per-unit (NOT a duplicated line total like OnBuy's total_price).
        // Each unit row carrying it is the natural per-unit semantics. Line 1777.
        mopProductPrice: unitPrice,
        mopProductVatAmount: unitVat,
        // Legacy stores '0' here (NOT '1' like OnBuy). Line 1781.
        mopProductVatIncluded: '0',
        mopProductQuantity: 1,
        mopProductAttributeName: null,
        mopUkssProductSku: sku,
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
      `Hi Team,<br><br>Walmart Order <b>${escapeHtml(orderId)}</b> contains SKUs not found in new_products_variations:<br><ul>${missingSKUs
        .map((m) => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`)
        .join('')}</ul>`,
      { executionId, orderId, missingSKUs }
    );
  }

  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation - will still create order header');
  }

  const orderTotal = totals.subtotal + totals.tax;

  // WHY `as unknown as TransformedOrder`: same reason as OnBuy — `mopProductVatAmount` is nullable
  // in the live DB but typed as `number` in the shared `MopProductData`. Legacy writes the raw
  // tax amount (which can be null when Walmart returns null). The cast preserves parity without
  // weakening the contract for marketplaces that always write a number.
  const result = {
    MoMarketplaceOrder: {
      moStoreName: MARKETPLACE_NAME,
      moStoreId: storeId,
      moOrderId: orderId,
      moOrderPlaceDate: orderPlaceDate,
      moOrderUpdateDate: orderUpdateDate,
      moOrderShipByDate: orderShipByDate,
      // WHY hardcoded 'Created': legacy parity (line 1740).
      moOrderStatus: WALMART_INITIAL_ORDER_STATUS,
      moOrderCustomerId: null,
      moOrderCustomerEmail: order.customerEmailId || null,
      moCustomerPhone: order.shippingInfo?.phone ?? null,
      moOrderCustomerName: order.shippingInfo?.postalAddress?.name || null,
      // WHY hardcoded 'Standard Shipping': legacy parity (line 1743). Walmart doesn't expose method name.
      moOrderShippingMethod: WALMART_SHIPPING_METHOD,
      moOrderShippingLine1: order.shippingInfo?.postalAddress?.address1 || null,
      moOrderShippingLine2: order.shippingInfo?.postalAddress?.address2 ?? null,
      moOrderShippingLine3: null,
      moOrderShippingCity: order.shippingInfo?.postalAddress?.city || null,
      moOrderShippingState: order.shippingInfo?.postalAddress?.state ?? null,
      // WHY hardcoded 'United States': legacy parity (line 1821). Walmart-UKSS only ships to US.
      moOrderShippingCountry: WALMART_SHIPPING_COUNTRY,
      moOrderShippingZipcode: order.shippingInfo?.postalAddress?.postalCode || null,
      moOrderCurrency: currencyCode,
      moUkssConversionRate: conversionRate,
      moOrderSubtotal: totals.subtotal,
      // WHY 0: legacy parity (line 1828). Walmart shipping is buyer-paid; subtotal+tax = total.
      moShippingTotal: WALMART_SHIPPING_TOTAL,
      moOrderTotal: orderTotal,
      moUkssOrderId: null,
      moCreatedBy: AUDIT_USER,
      moModifiedBy: AUDIT_USER,
      moDateAdded: now,
      moDateModified: now,
    },
    MopMarketplaceOrderProduct: products,
    // WHY OrderStatus.PENDING + DEFAULT_INITIAL_STATUS_MAPPING_ID (BigInt(1)) instead of legacy's
    // hardcoded 'Created'/211: JS Admin pattern (matches OnBuy/Sportdeal). Stage 5 corrects to the
    // real muosm row via dynamic mapping resolution.
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
