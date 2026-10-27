/**
 * Debenhams Order Data Utilities
 *
 * Parses Debenhams (Mirakl) API order responses and prepares data
 * for insertion into marketplace tables.
 */

import { createLogger, type Logger } from '../logger';
import { getStoreDetails } from '../store-management/store-management-utils';
import { getOrderStatus, insertMarketPlaceOrderDetails } from '../marketplace-orders/marketplace-orders-utils';
import { getCurrencyDetails, getCountryNameFromIsoCode } from '../helpers/common-utils';
import { getProductVariationDataFromSKU } from '../new-product-variations/new-product-variations-utils';
import { buildExtraInfoJson } from '../orders/personalization.utils';
import { emailService } from '../email';
import { config } from '../../config';
import type {
  DebenhamsOrder,
  DebenhamsOrderLine,
  DebenhamsAdditionalField,
  DebenhamsPersonalization,
} from './debenhams.types';

const defaultLogger = createLogger('debenhams-order-data-utils');

/**
 * Parse a single personalization entry from Debenhams order line
 * Input format: "ITEM0 | text1:VAN DIJK 4"
 * Output: { name: "VAN DIJK", number: "4" }
 */
export function parsePersonalization(value: string | null | undefined): DebenhamsPersonalization {
  const result: DebenhamsPersonalization = { name: '', number: '' };

  if (!value || value.trim() === '') {
    return result;
  }

  try {
    // Remove "ITEM0 | text1:" prefix
    let cleaned = value;

    // Handle "ITEM0 | " prefix
    if (cleaned.includes('|')) {
      cleaned = cleaned.split('|').slice(1).join('|').trim();
    }

    // Handle "text1:" prefix
    if (cleaned.toLowerCase().startsWith('text1:')) {
      cleaned = cleaned.substring(6).trim();
    }

    // If empty after cleaning, return empty result
    if (!cleaned) {
      return result;
    }

    // Split by space - last word is number, rest is name
    const parts = cleaned.split(' ').filter(p => p.trim() !== '');

    if (parts.length === 0) {
      return result;
    }

    if (parts.length === 1) {
      // Only one part - could be name or number
      // Check if it's purely numeric
      if (/^\d+$/.test(parts[0])) {
        result.number = parts[0];
      } else {
        result.name = parts[0];
      }
    } else {
      // Multiple parts - last is number, rest is name
      const lastPart = parts[parts.length - 1];

      // Check if last part looks like a jersey number (1-3 digits)
      if (/^\d{1,3}$/.test(lastPart)) {
        result.number = lastPart;
        result.name = parts.slice(0, -1).join(' ');
      } else {
        // Last part is not a number, treat entire string as name
        result.name = cleaned;
      }
    }
  } catch (error) {
    // Return empty result on any parse error
  }

  return result;
}

/**
 * Convert a single parsed personalization to a JSON string for mopExtraInfo.
 *
 * The JSON shape is shared across marketplaces — see buildExtraInfoJson().
 * Only the Mirakl-specific string parsing above is Debenhams' own.
 */
function personalizationToExtraInfo(parsed: DebenhamsPersonalization): string | null {
  return buildExtraInfoJson(parsed);
}

/**
 * Extract personalization entries from order line additional fields.
 * Returns an array of JSON strings (one per item/quantity unit).
 *
 * The API sends multi-item personalization as a newline-delimited string:
 *   "ITEM0 | text1:ISAAC 20\nITEM1 | text1:HOSEA 16"
 * Each entry corresponds to one quantity unit.
 */
function extractPersonalizations(
  additionalFields: DebenhamsAdditionalField[] | undefined,
  quantity: number,
  logger?: Logger
): (string | null)[] {
  const log = logger || defaultLogger;

  if (!additionalFields || additionalFields.length === 0) {
    return new Array(quantity).fill(null);
  }

  // Find the personalization field
  const personalizationField = additionalFields.find(
    field => field.code === 'dbz-item-customisation'
  );

  if (!personalizationField || !personalizationField.value) {
    return new Array(quantity).fill(null);
  }

  // Split by newline to get individual item entries
  const items = personalizationField.value
    .split('\n')
    .map(s => s.trim())
    .filter(s => s !== '');

  log.debug({ raw: personalizationField.value, itemCount: items.length, quantity }, 'Parsing personalization entries');

  // Parse each item entry
  const results: (string | null)[] = [];
  for (let i = 0; i < quantity; i++) {
    if (i < items.length) {
      const parsed = parsePersonalization(items[i]);
      results.push(personalizationToExtraInfo(parsed));
    } else {
      // More quantity units than personalization entries
      results.push(null);
    }
  }

  log.debug({ results }, 'Parsed personalization entries');

  return results;
}

/**
 * Prepare Debenhams order data for insertion into marketplace tables
 */
export async function prepareDebenhamsOrderData(
  orders: DebenhamsOrder[],
  logger?: Logger
): Promise<string> {
  const log = logger || defaultLogger;

  log.info({ orderCount: orders?.length || 0 }, 'Starting Debenhams order data preparation');

  try {
    if (!orders || orders.length === 0) {
      log.info('No orders to process');
      return 'No New Order Found';
    }

    // Get store details
    const storeName = config.DEBENHAMS_STORE_NAME;
    const storeDetails = await getStoreDetails(storeName, log);

    if (!storeDetails) {
      log.error({ storeName }, 'Store not found in store_management table');
      throw new Error(`Store not found in store_management table: ${storeName}`);
    }

    const moStoreId = storeDetails.storeId;
    const marketPlaceName = storeName;

    log.info({ orderCount: orders.length, storeId: moStoreId }, 'Processing orders');

    // Array to store the data for marketplace tables
    const multiMarketPlaceData: Record<string, {
      MoMarketplaceOrder: Record<string, unknown>;
      MopMarketplaceOrderProduct: Array<Record<string, unknown>>;
      MoshMarketplaceOrderStatusHistory: Record<string, unknown>;
    }> = {};

    // Process each order
    for (const order of orders) {
      const orderId = order.order_id;

      log.info({ orderId, state: order.order_state }, 'Processing order');

      // Check if order already exists
      const status = await getOrderStatus(orderId, moStoreId, log);

      if (status === 1) {
        log.info({ orderId }, 'Duplicate entry found, skipping');
        continue;
      }

      // Get shipping address
      const shippingAddress = order.customer?.shipping_address;
      const customerName = shippingAddress
        ? `${shippingAddress.firstname || ''} ${shippingAddress.lastname || ''}`.trim()
        : '';

      // Build shipping address lines
      const shippingLine1 = shippingAddress?.street_1 || '';
      const shippingLine2 = shippingAddress?.street_2 || '';

      // Get country name from ISO code (GBR -> United Kingdom)
      const countryIsoCode = shippingAddress?.country_iso_code || shippingAddress?.country || '';
      const countryName = await getCountryNameFromIsoCode(countryIsoCode, log) || countryIsoCode;

      // Get currency details
      const currencyCode = order.currency_iso_code || 'GBP';
      const currencyDetails = await getCurrencyDetails(currencyCode, log);
      const currencyConversionValue = currencyDetails?.conversionRate || 1;

      // Prepare MoMarketplaceOrder data
      const moMarketplaceOrder: Record<string, unknown> = {
        moStoreName: marketPlaceName,
        moStoreId: moStoreId,
        moOrderId: orderId,
        moOrderPlaceDate: order.created_date ? new Date(order.created_date) : null,
        moOrderUpdateDate: order.last_updated_date ? new Date(order.last_updated_date) : null,
        moOrderShipByDate: order.shipping_deadline ? new Date(order.shipping_deadline) : null,
        moOrderStatus: order.order_state || null,
        moOrderCustomerId: order.customer?.customer_id || null,
        moOrderCustomerEmail: order.customer_notification_email || null,
        moOrderShippingMethod: order.shipping_type_label || 'Standard Delivery',
        moOrderShippingLine1: shippingLine1,
        moOrderShippingLine2: shippingLine2,
        moOrderShippingLine3: null,
        moOrderCustomerName: customerName,
        moCustomerPhone: shippingAddress?.phone || null,
        moOrderShippingCity: shippingAddress?.city || null,
        moOrderShippingState: shippingAddress?.state || null,
        moOrderShippingCountry: countryName,
        moOrderShippingZipcode: shippingAddress?.zip_code || null,
        moUkssConversionRate: currencyConversionValue,
        moOrderCurrency: currencyCode,
        moOrderSubtotal: order.price || 0,
        moShippingTotal: order.shipping_price || 0,
        moOrderTotal: order.total_price || 0,
        moUkssOrderId: null,
        moCreatedBy: 'Get Debenhams Orders',
        moModifiedBy: 'Get Debenhams Orders',
        moDateAdded: new Date(),
        moDateModified: new Date(),
      };

      // Process order lines (products)
      const products: Array<Record<string, unknown>> = [];
      const missingSKUs: Array<{ sku: string; lineId: string }> = [];

      for (const orderLine of order.order_lines) {
        const sku = orderLine.product_shop_sku;
        const lineId = orderLine.order_line_id;

        // Strip optional "-np" suffix before lookup; the marketplace sometimes
        // appends it (e.g. "p-ADBC-123-np") but the variations table stores the base SKU.
        const lookupSku = sku.replace(/-np$/i, '');

        log.info({ sku, lookupSku, lineId, productTitle: orderLine.product_title }, 'Processing order line');

        // Look up product by SKU
        const productDetails = await getProductVariationDataFromSKU(lookupSku, log);

        if (!productDetails || !productDetails.npvProductsId) {
          log.error({ sku, lookupSku, lineId, orderId }, 'SKU not found in new_products_variations table');
          missingSKUs.push({ sku, lineId });
          continue;
        }

        // Extract personalization entries (one per quantity unit)
        const quantity = orderLine.quantity || 1;
        const personalizations = extractPersonalizations(orderLine.order_line_additional_fields, quantity, log);

        // Create one product record per quantity unit
        for (let i = 0; i < quantity; i++) {
          products.push({
            mopStoreName: marketPlaceName,
            mopOrderId: orderId,
            mopMoId: BigInt(0), // Will be updated after order header is saved
            mopProductId: lineId,
            mopProductSku: sku,
            mopProductStatus: orderLine.order_line_state || null,
            mopProductName: orderLine.product_title || null,
            mopProductUpcEan: null,
            mopProductPrice: orderLine.price || 0,
            mopProductVatAmount: null,
            mopProductVatIncluded: '1', // VAT included
            mopProductQuantity: 1, // One record per unit
            mopProductAttributeName: null,
            mopExtraInfo: personalizations[i],
            mopUkssProductSku: productDetails.npvSku || sku,
            mopUkssProductId: String(productDetails.npvProductsId),
            mopUkssProductConfirmationStatus: null,
            mopUkssProductShippingStatus: null,
            mopUkssProductCancelReason: null,
            mopUkssProductReturnReason: null,
            mopUkssTrackingCode: null,
            mopUkssShippingCarrier: null,
            mopCreatedBy: 'Get Debenhams Orders',
            mopModifiedBy: 'Get Debenhams Orders',
            mopDateAdded: new Date(),
            mopDateModified: new Date(),
          });
        }
      }

      // Warn about missing SKUs but still create the order (MOP entries for missing SKUs are already skipped above)
      if (missingSKUs.length > 0) {
        log.warn({ orderId, missingSKUs }, 'Order has products with missing SKUs - order will be created without those products');

        await emailService.sendErrorNotification({
          subject: `Debenhams Order ${orderId} - Missing SKUs`,
          errorMessage: `Hi Team,<br><br>Debenhams Order <b>${orderId}</b> was created but the following SKUs were not found in the new_products_variations table and their products were skipped:<br><ul>${missingSKUs.map(m => `<li>SKU: ${m.sku} (Line ID: ${m.lineId})</li>`).join('')}</ul><br>Please add these SKUs to the system.`,
          module: 'debenhams-order-data-utils',
          context: {
            orderId,
            missingSKUs,
          },
        });
      }

      // Prepare status history data
      const statusHistory: Record<string, unknown> = {
        moshMoOrderId: orderId,
        moshMoId: BigInt(0), // Will be updated after order header is saved
        moshMoOrderStatus: 'PENDING',
        moshMuosmId: BigInt(1),
        moshCreatedBy: 'Get Debenhams Orders',
        moshModifiedBy: 'Get Debenhams Orders',
        moshDateAdded: new Date(),
        moshDateModified: new Date(),
      };

      // Store order data
      multiMarketPlaceData[orderId] = {
        MoMarketplaceOrder: moMarketplaceOrder,
        MopMarketplaceOrderProduct: products,
        MoshMarketplaceOrderStatusHistory: statusHistory,
      };

      log.info({ orderId, productCount: products.length }, 'Order prepared for insertion');
    }

    // Insert orders into database
    if (Object.keys(multiMarketPlaceData).length === 0) {
      log.info('No new orders to insert');
      return 'No New Order Found';
    }

    log.info({ orderCount: Object.keys(multiMarketPlaceData).length }, 'Inserting orders into database');

    const insertStatus = await insertMarketPlaceOrderDetails(multiMarketPlaceData, log, false);

    if (insertStatus === 'Inserted Successfully' || insertStatus === 'No New Order Found') {
      if (insertStatus === 'Inserted Successfully') {
        log.info({ insertedCount: Object.keys(multiMarketPlaceData).length }, 'Orders inserted successfully');
      } else {
        log.info('No new orders found to insert');
      }
      return insertStatus;
    } else {
      log.error({ insertStatus }, 'Error inserting orders into marketplace tables');

      await emailService.sendErrorNotification({
        subject: 'Error inserting Debenhams orders into marketplace tables',
        errorMessage: `Hi Team,<br><br>Error inserting Debenhams orders into marketplace tables.<br><b>Status:</b> ${insertStatus}`,
        module: 'debenhams-order-data-utils',
        context: { insertStatus },
      });

      throw new Error(`Error inserting orders: ${insertStatus}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Error preparing Debenhams order data');

    await emailService.sendErrorNotification({
      subject: 'Error preparing Debenhams order data',
      errorMessage: `Hi Team,<br><br>Error preparing Debenhams order data.<br><b>Error:</b> ${errorMessage}`,
      module: 'debenhams-order-data-utils',
      context: { error: errorMessage },
    });

    throw error;
  }
}
