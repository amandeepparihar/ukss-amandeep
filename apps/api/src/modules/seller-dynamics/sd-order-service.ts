/**
 * Seller Dynamics Order Service — Stage 1 + Stage 2
 *
 * Fetches orders from the Seller Dynamics SOAP API (GetCustomerOrdersExtended)
 * and inserts them into the marketplace order (MO/MOP/MOSH) tables.
 *
 * Pipeline: Stage 1 (Fetch) → Stage 2 (MOP Insert)
 * Cron: every 15 minutes
 *
 * SD-specific behavior:
 *   - SOAP API returns a FLAT list (one row per GoodsPurchased line item).
 *     Multiple rows share the same MarketPlaceOrderID — grouped before transform.
 *   - Client-side filter: only process line items flagged UKSS / UKSS-POD / UKSS-CUST.
 *     Flags are per LINE ITEM, not per order — a single order can mix them.
 *   - Customisation (name/number) arrives in the line item's Notes field and is
 *     persisted to mop_extra_info, which Stage 2 turns into the "Other Name & Number"
 *     order product attribute. Requires the SD store id in PERSONALIZE_ORDERS_SITE.
 *     ONLY UKSS-CUST carries mandatory Name/Number in production; a UKSS-CUST line
 *     missing it emails the dev team plus SELLER_DYNAMICS_CANCEL_REJECT_EMAILS (same
 *     list as SD cancel/reject alerts). UKSS-POD is a fulfilment flag, not a
 *     personalisation flag, and is never expected to carry Notes.
 *   - Pagination: max 50 rows/page, loop until < 50 returned.
 *   - Date range: eBay pattern — getLastFetchedOrderDate() with 10-day fallback.
 *   - Rate limits: ≤25 calls/5min, ≥10s between same-method calls.
 */

import { config } from '../../config';
import { getCountryNameFromIsoCode } from '../../lib/helpers/common-utils';
import { escapeHtml } from '../../lib/utils/string-utils';
import { createLogger } from '../../lib/logger';
import { createSellerDynamicsClient } from '../../lib/marketplaces/seller-dynamics/client';
import {
  createExecutionContext,
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
  type TransformedOrder,
  type TransformedOrderMap,
  OrderStatus,
  AUDIT_USER,
  getCreatedByLabel,
  DEFAULT_INITIAL_STATUS_MAPPING_ID,
} from '../marketplaces/orders';
import {
  buildSdExtraInfo,
  hasMissingMandatoryCustomisation,
  isAcceptedSdFlag,
  SD_ACCEPTED_FLAGS,
} from './sd-customisation.utils';
import type { SdCustomerOrderExtended, SdGroupedOrder } from './sd-order-types';

const MARKETPLACE_NAME = 'Seller Dynamics';
const SD_STORE_ID = config.SELLER_DYNAMICS_STORE_ID;
const CREATED_BY = getCreatedByLabel(MARKETPLACE_NAME);
// Extra recipients for missing mandatory-customisation alerts (UKSS-CUST with no
// Name/Number). Reuses the same distribution list as SD's cancel/reject emails
// (sd-status-update.service.ts) rather than a dedicated env var — same people need
// to act on both. Empty until SELLER_DYNAMICS_CANCEL_REJECT_EMAILS is configured;
// until then this alert (like cancel/reject) only reaches the dev-team default.
const CUSTOMISATION_MISSING_EMAILS = (config.SELLER_DYNAMICS_CANCEL_REJECT_EMAILS || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const SD_PAGE_SIZE = 50;
const DEFAULT_LOOKBACK_DAYS = 10;
const INTER_PAGE_DELAY_MS = 11_000;
// SD filters fromDate/toDate against its own (UK) local time, but we send UTC ISO. On BST
// (UTC+1) a UTC "now" toDate lands ~1h behind UK-local now, which excludes orders created in
// the last hour. A forward buffer on toDate prevents very-recent orders from being dropped.
const TO_DATE_BUFFER_MS = 24 * 60 * 60 * 1000;

const feedLogger = createLogger('sd-order-feed');

/**
 * Parse an SD date field into a valid Date, or null.
 *
 * SD sends absent dates as xsi:nil (parsed as objects) — and the value may also be an
 * empty string or a malformed date. Only a non-empty string that parses to a real date
 * is accepted; anything else returns null so we never feed an Invalid Date to the DB.
 */
function toValidDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Group flat SD line items by MarketPlaceOrderID.
 */
function groupOrdersByMarketPlaceOrderId(
  items: SdCustomerOrderExtended[],
): SdGroupedOrder[] {
  const map = new Map<string, SdGroupedOrder>();

  for (const item of items) {
    const orderId = String(item.MarketPlaceOrderID ?? '');
    if (!orderId) continue;

    let group = map.get(orderId);
    if (!group) {
      group = {
        orderId,
        purchaseId: String(item.PurchaseID ?? ''),
        lineItems: [],
      };
      map.set(orderId, group);
    }
    group.lineItems.push(item);
  }

  return Array.from(map.values());
}

/**
 * Fetch orders from Seller Dynamics and insert into marketplace order tables.
 */
export async function fetchSdOrders(): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  const { executionId, logger } = createExecutionContext('sd-order-service');

  logger.info('Starting Seller Dynamics order fetch');

  try {
    if (!SD_STORE_ID) {
      const msg = 'SELLER_DYNAMICS_STORE_ID is not configured';
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    if (!config.SELLER_DYNAMICS_ENCRYPTED_LOGIN || !config.SELLER_DYNAMICS_RETAILER_ID) {
      const msg = 'SELLER_DYNAMICS_ENCRYPTED_LOGIN or SELLER_DYNAMICS_RETAILER_ID is not configured';
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    const storeDetails = await getStoreInfo(SD_STORE_ID, logger);
    if (!storeDetails) {
      const msg = `Store with ID ${SD_STORE_ID} not found in store_management table`;
      logger.error(msg);
      return createFailedFetchResult(msg, Date.now() - startTime);
    }

    // Date range: eBay pattern with 10-day fallback
    const dateRange = await getLastFetchedOrderDate(SD_STORE_ID, logger);
    const fromDate = dateRange.startDate || new Date(
      Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    // Buffer toDate forward so SD's local-time comparison never excludes just-created orders.
    const toDate = new Date((dateRange.endDate?.getTime() ?? Date.now()) + TO_DATE_BUFFER_MS);
    const fromTime = fromDate.toISOString();
    const toTime = toDate.toISOString();
    logger.info({ fromTime, toTime, storeId: SD_STORE_ID, isFirstRun: !dateRange.startDate }, 'Fetch date range determined');

    // Paginate through all pages
    const client = createSellerDynamicsClient();
    const allItems: SdCustomerOrderExtended[] = [];
    let pageNumber = 1;
    let hasMore = true;

    while (hasMore) {
      logger.info({ pageNumber }, 'Fetching orders page from SD API');

      const pageResult = await client.getCustomerOrdersExtended(
        'PENDING',
        fromTime,
        toTime,
        pageNumber,
      );

      if (!pageResult.success) {
        const msg = `SD API error on page ${pageNumber}: ${pageResult.error}`;
        logger.error({ pageNumber, error: pageResult.error }, msg);

        await sendOrderFailureEmail(
          MARKETPLACE_NAME,
          'Order Fetch Failed',
          `Hi Team,<br><br>Seller Dynamics orders API failed on page ${pageNumber}.<br><b>Error:</b> ${escapeHtml(pageResult.error || 'Unknown')}`,
          { executionId, pageNumber, error: pageResult.error },
        );

        // If first page fails, return error. If later page fails, process what we have.
        if (allItems.length === 0) {
          return createFailedFetchResult(msg, Date.now() - startTime);
        }
        break;
      }

      feedLogger.debug({ page: pageNumber, orders: pageResult.orders }, 'SD orders raw page response');
      allItems.push(...pageResult.orders);

      hasMore = pageResult.orders.length >= SD_PAGE_SIZE;
      if (hasMore) {
        pageNumber++;
        await new Promise((resolve) => setTimeout(resolve, INTER_PAGE_DELAY_MS));
      }
    }

    if (allItems.length === 0) {
      logger.info('No orders found from SD API');
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

    // Filter by Flag — accepts UKSS, UKSS-POD and UKSS-CUST
    const ukssItems = allItems.filter((item) => isAcceptedSdFlag(item.Flag));
    const filteredOutCount = allItems.length - ukssItems.length;
    if (filteredOutCount > 0) {
      // Log the rejected flag values — this is our only visibility into what SD sends.
      const rejectedFlags = [
        ...new Set(allItems.filter((item) => !isAcceptedSdFlag(item.Flag)).map((item) => String(item.Flag ?? ''))),
      ];
      logger.info(
        { totalItems: allItems.length, acceptedItems: ukssItems.length, filteredOut: filteredOutCount, rejectedFlags },
        'Filtered items with unrecognised flags',
      );
    }

    if (ukssItems.length === 0) {
      logger.info('No UKSS-flagged orders found');
      const result: FetchOrdersResult = {
        success: true,
        message: `Found ${allItems.length} items but none flagged ${SD_ACCEPTED_FLAGS.join('/')}`,
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

    // Group flat items into orders by MarketPlaceOrderID
    const groupedOrders = groupOrdersByMarketPlaceOrderId(ukssItems);
    logger.info({ orderCount: groupedOrders.length, lineItemCount: ukssItems.length }, 'Orders grouped, processing');

    let ordersSkipped = 0;
    let ordersFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];
    const transformedOrders: TransformedOrderMap = {};

    for (const group of groupedOrders) {
      const orderId = group.orderId;
      try {
        const exists = await getOrderStatus(orderId, SD_STORE_ID, logger);
        if (exists === 1) {
          logger.debug({ orderId }, 'Order already exists, skipping');
          ordersSkipped++;
          continue;
        }

        const transformed = await transformSdOrder(group, {
          storeId: SD_STORE_ID,
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
        logger.error({ orderId, error: serializeError(error) }, 'Failed to process SD order');

        await sendOrderFailureEmail(
          MARKETPLACE_NAME,
          `Order Processing Failed - Order ${orderId}`,
          `Hi Team,<br><br>Failed to process Seller Dynamics order.<br><b>Order ID:</b> ${escapeHtml(orderId)}<br><b>Error:</b> ${escapeHtml(msg)}`,
          { executionId, orderId, error: msg },
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
      message: `Processed ${groupedOrders.length} orders (${ukssItems.length} line items, ${filteredOutCount} non-UKSS filtered)`,
      ordersFound: groupedOrders.length,
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
    logger.error({ error: serializeError(error) }, 'SD order fetch failed');

    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      'Order Fetch Failed',
      `Hi Team,<br><br>Seller Dynamics order fetch failed.<br><b>Error:</b> ${escapeHtml(msg)}`,
      { executionId, error: msg },
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
 * Transform a grouped SD order into the TransformedOrder shape consumed by
 * insertMarketPlaceOrderDetails().
 *
 * SD returns a flat list; this function receives pre-grouped line items.
 */
async function transformSdOrder(
  group: SdGroupedOrder,
  ctx: TransformContext,
): Promise<TransformedOrder> {
  const { storeId, executionId, logger } = ctx;
  const orderId = group.orderId;
  const now = new Date();

  // Take order-level fields from the first line item (repeated across all items in the group)
  const firstItem = group.lineItems[0];

  const orderPlaceDate = toValidDate(firstItem.PurchaseDate);
  const orderShipDate = toValidDate(firstItem.ItemShipDate);

  const currencyCode = firstItem.CurrencyCode || 'GBP';
  const currencyDetails = await getCurrencyDetails(currencyCode, logger);
  const conversionRate = currencyDetails?.conversionRate ?? 1;

  const countryName = await getCountryNameFromIsoCode(
    firstItem.ShippingAddressCountry || '',
    logger,
  ) || firstItem.ShippingAddressCountry || '';

  const products: Array<Record<string, unknown>> = [];
  const missingSKUs: Array<{ sku: string; productName: string }> = [];
  const missingCustomisation: Array<{ sku: string; productName: string }> = [];

  let orderSubtotal = 0;

  for (const item of group.lineItems) {
    const qty = Number(item.Quantity ?? 1);
    if (qty <= 0) {
      logger.debug({ orderId, sku: item.SKU, quantity: item.Quantity }, 'Skipping item with zero/invalid quantity');
      continue;
    }

    const pricePaid = parseFloat(String(item.PricePaid ?? '0'));
    const taxPaid = Number(item.TaxPaid ?? 0);
    orderSubtotal += pricePaid;

    const productDetails = await getProductVariationDataFromSKU(item.SKU, logger);

    let mopUkssProductId = '';
    if (productDetails?.npvProductsId) {
      mopUkssProductId = String(productDetails.npvProductsId);
    } else {
      logger.error({ orderId, sku: item.SKU }, 'SKU not found in new_products_variations');
      if (!missingSKUs.find((m) => m.sku === item.SKU)) {
        missingSKUs.push({ sku: item.SKU, productName: item.ItemTitle || '' });
      }
    }

    // SD sends ONE customisation per line item even when Quantity > 1 (verified against
    // the test account: qty-2 lines carry a single "Name: …/Number: …" value), so every
    // unit row below gets the same payload.
    const extraInfo = buildSdExtraInfo(item);

    // UKSS-CUST is the only flag that carries mandatory Name/Number in production.
    // Shipping a customised order with no printed name/number is customer-facing, so
    // this alerts Ryan/Simon directly rather than waiting on Stage 2's generic
    // "personalized order data missing" check.
    if (hasMissingMandatoryCustomisation(item) && !missingCustomisation.find((m) => m.sku === item.SKU)) {
      missingCustomisation.push({ sku: item.SKU, productName: item.ItemTitle || '' });
    }

    for (let i = 0; i < qty; i++) {
      products.push({
        mopStoreName: MARKETPLACE_NAME,
        mopOrderId: orderId,
        mopMoId: BigInt(0),
        mopProductId: String(item.GoodsPurchasedID ?? '') || null,
        mopProductSku: item.SKU || null,
        mopProductStatus: null,
        mopProductName: item.ItemTitle || null,
        mopProductUpcEan: item.EANBarCode || null,
        mopProductPrice: pricePaid,
        mopProductVatAmount: taxPaid,
        mopProductVatIncluded: '1',
        mopProductQuantity: 1,
        mopProductAttributeName: null,
        mopUkssProductSku: item.SKU || '',
        mopUkssProductId: mopUkssProductId,
        mopExtraInfo: extraInfo,
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
      `Hi Team,<br><br>Seller Dynamics Order <b>${escapeHtml(orderId)}</b> contains SKUs not found in new_products_variations:<br><ul>${missingSKUs.map((m) => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>`,
      { executionId, orderId, missingSKUs },
    );
  }

  if (missingCustomisation.length > 0) {
    logger.warn({ orderId, missingCustomisation }, 'UKSS-CUST order missing mandatory Name/Number');
    await sendOrderFailureEmail(
      MARKETPLACE_NAME,
      `Order ${orderId} - Missing Customisation Name/Number`,
      `Hi Team,<br><br>Seller Dynamics Order <b>${escapeHtml(orderId)}</b> is flagged UKSS-CUST (customised) ` +
      `but the Notes field did not contain both a Name and a Number for:<br><ul>${missingCustomisation.map((m) => `<li>SKU: ${escapeHtml(m.sku)} (${escapeHtml(m.productName)})</li>`).join('')}</ul>` +
      `Please confirm the customisation details with Seller Dynamics / the customer before this order ships.`,
      { executionId, orderId, missingCustomisation },
      CUSTOMISATION_MISSING_EMAILS,
    );
  }

  if (products.length === 0) {
    logger.warn({ orderId }, 'Order has no valid products after transformation - will still create order header');
  }

  const shippingTotal = parseFloat(String(firstItem.OrderPostagePaid ?? '0'));
  const orderTotal = orderSubtotal + shippingTotal;

  const normalizedStatus = normalizeOrderStatus(firstItem.Status);

  const result = {
    MoMarketplaceOrder: {
      moStoreName: MARKETPLACE_NAME,
      moStoreId: storeId,
      moOrderId: orderId,
      moExternalOrderId: group.purchaseId || null,
      moAmazonOrderId: null,
      moOrderPlaceDate: orderPlaceDate,
      moOrderUpdateDate: now,
      moOrderShipByDate: orderShipDate,
      moOrderStatus: normalizedStatus,
      moOrderCustomerId: firstItem.CustomerMarketplaceIdentifier || null,
      moOrderCustomerEmail: firstItem.CustomerEmail || null,
      moCustomerPhone: firstItem.CustomerPhone ?? null,
      moOrderCustomerName: firstItem.CustomerName || null,
      moOrderShippingMethod: firstItem.ShippingMethodRequested || firstItem.PostageMethodName || null,
      moOrderShippingLine1: firstItem.ShippingAddress1 || null,
      moOrderShippingLine2: firstItem.ShippingAddress2 ?? null,
      moOrderShippingLine3: firstItem.ShippingAddress3 ?? null,
      moOrderShippingCity: firstItem.ShippingAddressTown || null,
      moOrderShippingState: firstItem.ShippingAddressRegion ?? null,
      moOrderShippingCountry: countryName,
      moOrderShippingZipcode: firstItem.ShippingAddressPostZIPCode || null,
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

/**
 * Normalize SD's OrderStatusID / Status string to the shared OrderStatus value.
 * SD statuses: New, In Stock, Pending PO, On Order, Reorder, Dispatched, Printed,
 * Refunded, Refunding, Dispatching.
 */
function normalizeOrderStatus(status: string | undefined | null): string {
  if (!status) return OrderStatus.PENDING;

  const s = status.toLowerCase().trim();
  if (s === 'dispatched' || s === 'dispatching') return OrderStatus.SHIPPED;
  if (s === 'refunded' || s === 'refunding') return OrderStatus.CANCELLED;
  return OrderStatus.PENDING;
}
