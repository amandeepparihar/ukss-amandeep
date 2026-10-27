import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { getStoreDetails } from '../store-management/store-management-utils';
import { getOrderStatus, insertMarketPlaceOrderDetails } from '../marketplace-orders/marketplace-orders-utils';
import { getCurrencyDetails, getCountryNameFromIsoCode } from '../helpers/common-utils';
import { getProductVariationDataFromSKU } from '../new-product-variations/new-product-variations-utils';
import { getProductCustomOptionsMapping } from './toffs-token-utils';
import { emailService } from '../email';
import { extractPaypalDataFromToffsOrder } from '../helpers/paypal-utils';

const defaultLogger = createLogger('toffs-orders-data-utils');

// Type definitions for TOFFS order data
interface ToffsOrderItem {
  item_id: string;
  product_type: string;
  sku: string;
  name: string;
  price: number;
  price_incl_tax?: number;
  base_tax_amount?: number;
  qty_ordered: number;
  product_option?: {
    extension_attributes?: {
      custom_options?: Array<{
        option_id: string;
        option_value: string;
      }>;
    };
  };
}

interface ToffsShippingAddress {
  street?: string[];
  firstname?: string;
  lastname?: string;
  telephone?: string;
  city?: string;
  country_id?: string;
  postcode?: string;
}

interface ToffsOrder {
  entity_id: string;
  increment_id?: string;
  created_at: string;
  updated_at: string;
  status: string;
  customer_email: string;
  shipping_description: string;
  order_currency_code: string;
  subtotal_incl_tax: number;
  shipping_incl_tax: number;
  grand_total: number;
  items: ToffsOrderItem[];
  extension_attributes?: {
    shipping_assignments?: Array<{
      shipping?: {
        address?: ToffsShippingAddress;
      };
    }>;
  };
  payment?: {
    method?: string;
  };
}

export interface ProductCustomOption {
  option_id: string;
  title: string;
  price: number;
}

/**
 * Get UKSS product SKU from TOFFS SKU
 * TODO: Implement this function - needs toffs_sku column in new_products_variations table
 */
async function getUkssSkuFromToffsSku(toffsSku: string, logger?: Logger): Promise<string | null> {
  const log = logger || defaultLogger;
  try {
    log.info({ toffsSku }, 'Looking up UKSS SKU from TOFFS SKU');

    // Query new_products_variations table by toffs_sku column.
    // npv_delete_status is a MySQL ENUM('0','1'), so the value must be passed as a
    // string — passing the int 0 silently matches nothing because MySQL treats
    // numeric inputs to an ENUM as a 1-based ordinal index. Abhinav Gautam — ticket #165637.
    const result = await prisma.newProductsVariation.findFirst({
      where: {
        toffsSku: toffsSku,
        npvDeleteStatus: '0',
      },
      select: {
        npvSku: true,
      },
    });

    if (result?.npvSku) {
      log.info({ toffsSku, ukssSku: result.npvSku }, 'UKSS SKU found');
      return result.npvSku;
    }

    log.warn({ toffsSku }, 'UKSS SKU not found for TOFFS SKU');
    return null;
  } catch (error) {
    log.error({ error, toffsSku }, 'Error looking up UKSS SKU from TOFFS SKU');
    return null;
  }
}

/**
 * Process custom options and calculate extra info
 */
function processCustomOptions(
  customOptions: Array<{ option_id: string; option_value: string }> | undefined,
  productMapping: ProductCustomOption[],
  logger?: Logger
): { mopExtraInfo: string | null; totalCustomPrice: number } {
  const log = logger || defaultLogger;

  if (!customOptions || customOptions.length === 0 || productMapping.length === 0) {
    return { mopExtraInfo: null, totalCustomPrice: 0 };
  }

  const mopData: Record<string, string> = {};
  let totalCustomPrice = 0;

  // Create option_id to title/price mapping
  const optionMapping: Record<string, string> = {};
  const optionPrices: Record<string, number> = {};

  for (const option of productMapping) {
    optionMapping[option.option_id] = option.title.toLowerCase();
    optionPrices[option.option_id] = option.price;
  }

  // Process order custom options
  for (const orderOption of customOptions) {
    const optionId = orderOption.option_id;
    const optionValue = orderOption.option_value;

    // Skip if option_value is empty or null
    if (!optionValue || optionValue.trim() === '') {
      log.info({ optionId }, 'Skipping empty option_value');
      continue;
    }

    // Get the label from mapping
    if (optionMapping[optionId]) {
      const label = optionMapping[optionId];
      mopData[label] = optionValue;

      // Add price if exists
      if (optionPrices[optionId] && optionPrices[optionId] > 0) {
        totalCustomPrice += optionPrices[optionId];
      }
    }
  }

  // Add total price to mopData if there are custom prices
  if (totalCustomPrice > 0) {
    mopData['price'] = totalCustomPrice.toFixed(2);
  }

  // Convert to JSON string or null if no data
  const mopExtraInfo = Object.keys(mopData).length > 0 ? JSON.stringify(mopData) : null;

  return { mopExtraInfo, totalCustomPrice };
}

/**
 * Prepare TOFFS order data for insertion into marketplace tables
 * Replicates PHP function: prepare_toffs_order_data_for_insertion
 */
export async function prepareToffsOrderData(
  orderData: ToffsOrder[],
  accessToken: string,
  logger?: Logger,
  storeName: string = 'Toffs'
): Promise<string> {
  const log = logger || defaultLogger;

  log.info({ orderCount: orderData?.length || 0 }, 'Starting TOFFS order data preparation');

  try {
    if (!orderData || orderData.length === 0) {
      log.info('No orders to process');
      return 'No New Order Found';
    }

    // Get store details
    const storeDetails = await getStoreDetails(storeName, log);

    if (!storeDetails) {
      log.error({ storeName }, 'Store not found in store_management table');
      throw new Error(`Store not found in store_management table: ${storeName}`);
    }

    const moStoreId = storeDetails.storeId;
    const marketPlaceName = storeName;

    log.info({ orderCount: orderData.length }, 'Total orders to process');

    // Array to store the data for marketplace tables
    const multiMarketPlaceData: Record<string, {
      MoMarketplaceOrder: any;
      MopMarketplaceOrderProduct: any[];
      MoshMarketplaceOrderStatusHistory: any;
      PaypalData?: Record<string, any>;
    }> = {};

    // Track skipped and successful orders for summary notifications
    const skippedOrders: { orderId: string; missingSKUs: string[] }[] = [];
    const successfulOrders: string[] = [];

    // Process each order
    for (const ordersDetails of orderData) {
      const orderId = String(ordersDetails.entity_id);

      log.info({ orderId }, 'Processing Order');

      // Check if order already exists
      const status = await getOrderStatus(orderId, moStoreId, log);//TODO: Check if this is correct

      if (status === 1) {
        log.info({ orderId }, 'Duplicate entry found, skipping');
        continue;
      }

      // Get shipping address
      const shippingAddress = ordersDetails.extension_attributes?.shipping_assignments?.[0]?.shipping?.address;

      // Prepare MoMarketplaceOrder data
      const moMarketplaceOrder: any = {
        moStoreName: marketPlaceName,
        moStoreId: moStoreId,
        moOrderId: orderId,
        moExternalOrderId: ordersDetails.increment_id || null,
        moOrderPlaceDate: ordersDetails.created_at ? new Date(ordersDetails.created_at) : null,
        moOrderUpdateDate: ordersDetails.updated_at ? new Date(ordersDetails.updated_at) : null,
        moOrderShipByDate: null,
        moOrderStatus: ordersDetails.status || null,
        moOrderCustomerId: null,
        moOrderCustomerEmail: ordersDetails.customer_email || null,
        moOrderShippingMethod: ordersDetails.shipping_description || null,
        moOrderShippingLine1: shippingAddress?.street?.[0] || '',
        moOrderShippingLine2: shippingAddress?.street?.[1] || '',
        moOrderShippingLine3: shippingAddress?.street?.[2] || '',
        moOrderCustomerName: `${shippingAddress?.firstname || ''} ${shippingAddress?.lastname || ''}`.trim(),
        moCustomerPhone: shippingAddress?.telephone || null,
        moOrderShippingCity: shippingAddress?.city || null,
        moOrderShippingState: shippingAddress?.region || shippingAddress?.region_code || null,
        moOrderShippingZipcode: shippingAddress?.postcode || null,
        moUkssOrderId: null,
        moCreatedBy: 'Get Toffs Orders',
        moModifiedBy: 'Get Toffs Orders',
        moDateAdded: new Date(),
        moDateModified: new Date(),
      };

      // Process order items
      const products: any[] = [];
      const missingSKUs: string[] = []; // Track missing SKUs for this order
      let tempKey = 0;

      for (const orderProductDetails of ordersDetails.items) {
        // Only process configurable products
        if (orderProductDetails.product_type !== 'configurable') {
          continue;
        }

        const toffsSku = orderProductDetails.sku; // e.g., "1150    M"
        log.info({ toffsSku }, 'Processing Product SKU');

        // Base SKU (first part before space)
        const baseToffsSku = toffsSku.split(' ')[0].trim();

        // Get custom options from order
        const customOptions = orderProductDetails.product_option?.extension_attributes?.custom_options;

        // Get product custom options mapping from TOFFS API
        let productMapping: ProductCustomOption[] = [];
        try {
          productMapping = await getProductCustomOptionsMapping(baseToffsSku, accessToken, log);
          log.info({ baseToffsSku }, 'Successfully fetched custom options');
        } catch (error) {
          log.error({ error, baseToffsSku }, 'Failed fetching custom options');
          productMapping = [];
        }

        // Process custom options to create mop_extra_info
        const { mopExtraInfo } = processCustomOptions(customOptions, productMapping, log);
        log.info({ mopExtraInfo: mopExtraInfo || 'NULL' }, 'mop_extra_info processed');

        // Get UKSS product SKU from TOFFS SKU
        const npvProductSku = await getUkssSkuFromToffsSku(toffsSku, log);

        if (!npvProductSku) {
          log.error({ toffsSku, orderId }, 'TOFFS SKU not found in new_products_variations table');

          // Track missing SKU - avoid duplicates
          if (!missingSKUs.includes(toffsSku)) {
            missingSKUs.push(toffsSku);
          }
          continue; // Skip this product
        }

        // Get product variation details from UKSS SKU
        const productDetails = await getProductVariationDataFromSKU(npvProductSku, log);
        const ukssProductId = productDetails?.npvProductsId ? String(productDetails.npvProductsId) : '';

        if (!ukssProductId) {
          log.error({ npvProductSku, orderId }, 'Product ID not found in product_feed_variation table');

          // Track missing SKU - avoid duplicates
          if (!missingSKUs.includes(toffsSku)) {
            missingSKUs.push(toffsSku);
          }
          continue; // Skip this product
        }

        // Create product entries based on quantity (one entry per unit)
        const qtyOrdered = orderProductDetails.qty_ordered || 1;

        for (let i = 0; i < qtyOrdered; i++) {
          products.push({
            mopStoreName: marketPlaceName,
            mopOrderId: orderId,
            mopMoId: BigInt(0), // Will be updated after order header is saved
            mopProductId: String(orderProductDetails.item_id),
            mopProductSku: orderProductDetails.sku || '',
            mopProductStatus: null,
            mopProductName: orderProductDetails.name || null,
            mopProductUpcEan: null,
            mopProductPrice: orderProductDetails.price_incl_tax || 0, // Product price must be inclusive of tax #165216
            mopProductVatAmount: orderProductDetails.base_tax_amount || null, // Product VAT amount must be the base tax amount #16521
            mopProductVatIncluded: '1',
            mopProductQuantity: 1,
            mopProductAttributeName: null,
            mopExtraInfo: mopExtraInfo,
            mopUkssProductSku: npvProductSku,
            mopUkssProductId: ukssProductId,
            mopUkssProductConfirmationStatus: null,
            mopUkssProductShippingStatus: null,
            mopUkssProductCancelReason: null,
            mopUkssProductReturnReason: null,
            mopUkssTrackingCode: null,
            mopUkssShippingCarrier: null,
            mopCreatedBy: 'Get Toffs Orders',
            mopModifiedBy: 'Get Toffs Orders',
            mopDateAdded: new Date(),
            mopDateModified: new Date(),
          });
          tempKey++;
        }
      }

      // Warn about missing SKUs but still create the order (MOP entries for missing SKUs are already skipped above)
      if (missingSKUs.length > 0) {
        log.warn(
          { orderId, missingSKUs },
          '# Order has products with missing SKUs - order will be created without those products'
        );

        // Track order with missing SKUs for notification
        skippedOrders.push({ orderId, missingSKUs });
      }

      // Get currency conversion rate
      const currencyCode = ordersDetails.order_currency_code;
      const currencyDetails = await getCurrencyDetails(currencyCode, log);
      const currencyConversionValue = currencyDetails?.conversionRate || 1;

      // Get country name from ISO code
      const countryIsoCode = shippingAddress?.country_id || '';
      const countryName = await getCountryNameFromIsoCode(countryIsoCode, log);

      // Update order data with currency and country info
      moMarketplaceOrder.moOrderShippingCountry = countryName;
      moMarketplaceOrder.moUkssConversionRate = currencyConversionValue;
      moMarketplaceOrder.moOrderCurrency = currencyCode;
      moMarketplaceOrder.moOrderSubtotal = ordersDetails.subtotal_incl_tax || 0;
      moMarketplaceOrder.moShippingTotal = ordersDetails.shipping_incl_tax || 0;
      moMarketplaceOrder.moOrderTotal = ordersDetails.grand_total || 0;

      // Prepare status history data
      const statusHistory = {
        moshMoOrderId: orderId || '0',
        moshMoId: BigInt(0), // Will be updated after order header is saved
        moshMoOrderStatus: 'PENDING',
        moshMuosmId: BigInt(1),
        moshCreatedBy: 'Get Toffs Orders',
        moshModifiedBy: 'Get Toffs Orders',
        moshDateAdded: new Date(),
        moshDateModified: new Date(),
      };

      // Store order data
      multiMarketPlaceData[orderId] = {
        MoMarketplaceOrder: moMarketplaceOrder,
        MopMarketplaceOrderProduct: products,
        MoshMarketplaceOrderStatusHistory: statusHistory,
      };

      // Extract PayPal payment data if payment method is 'paypal_express'
      const paymentMethod = ordersDetails.payment?.method || '';
      if (paymentMethod === 'paypal_express') {
        const paypalData = await extractPaypalDataFromToffsOrder(ordersDetails, log);
        if (paypalData) {
          multiMarketPlaceData[orderId].PaypalData = paypalData;
        }
      }

      // Track successful order
      successfulOrders.push(orderId);
    }

    // Insert orders into database
    if (Object.keys(multiMarketPlaceData).length > 0) {
      const insertStatus = await insertMarketPlaceOrderDetails(multiMarketPlaceData, log, false);

      if (insertStatus === 'Inserted Successfully' || insertStatus === 'No New Order Found' || insertStatus === 'Partially Inserted') {
        if (insertStatus === 'Inserted Successfully') {
          log.info('JOB completed and orders created in marketplace table');
        } else if (insertStatus === 'Partially Inserted') {
          log.warn('JOB completed with partial success. Some orders were inserted, some failed during database insertion.');
        } else {
          log.info('JOB completed and no orders found to create in marketplace table');
        }

        // Check for orders with missing SKUs (orders were still created but some products were skipped)
        if (skippedOrders.length > 0) {
          log.warn(
            { successfulOrders, skippedOrders },
            '# Some orders were created with missing product SKUs.'
          );

          const skippedOrdersDetails = skippedOrders
            .map(
              (order) =>
                `<tr><td style="padding: 8px; border: 1px solid #ddd;">${order.orderId}</td><td style="padding: 8px; border: 1px solid #ddd;">${order.missingSKUs.join(', ')}</td></tr>`
            )
            .join('');

          await emailService.sendErrorNotification({
            subject: `Action Required: TOFFS Orders Created With Missing SKUs`,
            errorMessage: `Hi Team,<br><br>
              <b style="color: #d9534f;">IMPORTANT: Some TOFFS orders were created but have products with missing SKUs that were skipped.</b><br><br>
              <b>Module Name:</b> Get Toffs Orders<br>
              <b>File:</b> apps/api/src/lib/toffs-token/toffs-order-data.utils.ts<br>
              <b>Marketplace:</b> TOFFS<br><br>

              <h3 style="color: #d9534f;">Orders With Missing Product SKUs:</h3>
              <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
                <thead>
                  <tr style="background-color: #f5f5f5;">
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Order ID</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Missing SKU(s)</th>
                  </tr>
                </thead>
                <tbody>
                  ${skippedOrdersDetails}
                </tbody>
              </table>

              <h3 style="color: #0275d8;">Steps to Fix:</h3>
              <ol>
                <li><b>Add the missing SKUs</b> to the <code>toffs_sku</code> column of the <code>new_products_variations</code> table in the database.</li>
                <li><b>Check the orders above</b> - they were created without the missing products.</li>
              </ol>`,
            module: 'toffs-orders-data-utils',
            context: { successfulOrders, skippedOrders },
          });
        }

        return insertStatus;
      } else {
        log.error({ insertStatus }, 'Error inserting orders into marketplace tables');
        emailService.sendErrorNotification({
          subject: `Error inserting orders into marketplace tables`,
          errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Get Toffs Orders <br><b>File:</b> apps/api/src/lib/toffs-token/toffs-order-data.utils.ts <br><b>Error:</b> Error inserting orders into marketplace tables: ${insertStatus}`,
          module: 'toffs-orders-data-utils',
          context: {
            insertStatus: insertStatus,
          },
        });
        throw new Error('Error inserting orders into marketplace tables');
      }
    } else {
      // No orders to insert - check if all orders were skipped due to missing SKUs
      if (skippedOrders.length > 0) {
        log.warn(
          { skippedOrders },
          '# Orders had missing SKUs but no new orders to insert (all may have been duplicates).'
        );

        return 'No New Order Found';
      }

      log.info('No new orders to insert');
      return 'No New Order Found';
    }
  } catch (error) {
    log.error({ error }, 'Error preparing TOFFS order data');
    emailService.sendErrorNotification({
      subject: `Error preparing TOFFS order data`,
      errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Get Toffs Orders <br><b>File:</b> apps/api/src/lib/toffs-token/toffs-order-data.utils.ts <br><b>Error:</b> Error preparing TOFFS order data: ${error}`,
      module: 'toffs-orders-data-utils',
      context: {
        error: error,
      },
    });
    throw error;
  }
}
