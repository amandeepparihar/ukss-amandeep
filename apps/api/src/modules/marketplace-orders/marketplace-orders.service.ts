/**
 * Marketplace Orders to UKSS Orders Service
 *
 * Converts marketplace orders from mo_marketplace_orders to UKSS orders and orders_products tables
 * Based on PHP function: insert_order_detail_in_order_table()
 */

import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { emailService } from '../../lib/email';
import { getPendingMarketplaceOrders, buildTransactionRollbackVerificationNote } from '../../lib/marketplace-orders/marketplace-orders-utils';
import { getCurrencyDetails } from '../../lib/helpers/common-utils';
import { getMarketplaceOrderProducts } from '../../lib/marketplace-orders/marketplace-orders-products-util';
import { getProductVariationDataFromSKU } from '../../lib/new-product-variations/new-product-variations-utils';
import { insertOrderProduct, insertOrderTotal, insertOrderStatusHistory, insertOrderHeader, insertOrderProductAttribute } from '../../lib/orders/orders-products-utils';
import { getSizeOptionToProduct } from '../../lib/products-attributes/products-attributes-utils';
import { getProductOptionDetails, getSizeOptionValueName } from '../../lib/products-options/products-options-utils';
import { config } from '../../config';
import { updatePaypalOrderId } from '../../lib/helpers/paypal-utils';
import { assignShipDate, detectPrintingOrder } from '../../lib/orders/assign-ship-date';
import { autoProcessOrderProducts } from '../../lib/orders/auto-process-order-products';
import { escapeHtml } from '../../lib/utils/string-utils';
import {
  createExecutionContext,
  serializeError,
  getErrorMessage,
  UkssOrderStatus,
  TRANSACTION_TIMEOUT_MS,
  PERSONALIZE_OPTION_ID,
  PERSONALIZE_OPTION_NAME,
  OrderTotalClass,
  OrderTotalSortOrder,
} from '../marketplaces/orders';

const defaultLogger = createLogger('marketplace-orders-service');

// Type helper for Prisma transaction client
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Default email for marketplace orders without customer email
const DEFAULT_UKSS_MARKETPLACE_EMAIL = config.DEFAULT_UKSS_MARKETPLACE_EMAIL || 'ukssmarketplace@gmail.com';

// Store IDs that support personalized orders (parsed once at module load)
const PERSONALIZE_SITE_IDS: number[] = config.PERSONALIZE_ORDERS_SITE
  ? config.PERSONALIZE_ORDERS_SITE.split(',').map(Number)
  : [];

/**
 * @taskId #165499
 *
 * When marketplace orders are imported into the UKSS orders/orders_products tables,
 * hero shirt products were incorrectly getting their own barcode (from new_products_variations.npvProductsBarcodes)
 * instead of the parent product's barcode that the fulfilment center expects.
 *
 * This function detects hero shirts by checking product_lists.parent_product_lists_id != 0,
 * and if found, fetches the parent product's barcode from product_quantities for the matching size.
 *
 * Example: Hero shirt barcode 5063538537115 should be replaced with parent barcode 196605453652.
 *
 * Mirrors the hero shirt detection logic already present in:
 * - processing.stock.ts (resolveProductCode / checkParentStock)
 * - processing.service.ts (hero_shirt product type handling)
 *
 * @param productsModel - The product code (product_lists.product_code / npvProductsModel)
 * @param sizeId - The size mapping ID (products_options_values_to_products_options_id / npvProductsOptionsValuesToProductsOptionsId),
 *                 used to look up the correct barcode row in product_quantities.size_id
 * @param client - Prisma transaction client to ensure the lookup runs within the same transaction
 * @param log - Logger instance for tracing hero shirt detection and barcode resolution
 * @returns The parent product's barcode if the product is a hero shirt, otherwise null
 */
async function getHeroShirtParentBarcode(
  productsModel: string,
  sizeId: number,
  client: PrismaTransactionClient | typeof prisma = prisma,
  log: Logger = defaultLogger,
): Promise<string | null> {
  if (!productsModel || !sizeId) return null;

  try {
    // Look up product_lists to check for parent_product_lists_id
    const productList = await client.productList.findFirst({
      where: { productCode: productsModel },
      select: { parentProductListsId: true },
    });

    if (!productList || !productList.parentProductListsId || productList.parentProductListsId === 0) {
      return null; // Not a hero shirt
    }

    const parentProductListsId = productList.parentProductListsId;
    log.info({ productsModel, parentProductListsId, sizeId }, 'Hero shirt detected, looking up parent barcode');

    // Fetch the parent product's barcode from product_quantities for the matching size
    const parentQuantity = await client.productQuantity.findFirst({
      where: { productListsId: parentProductListsId, sizeId },
      select: { barcode: true },
    });

    if (parentQuantity?.barcode) {
      log.info({ productsModel, parentBarcode: parentQuantity.barcode }, 'Using parent product barcode for hero shirt');
      return parentQuantity.barcode;
    }

    log.warn({ productsModel, parentProductListsId, sizeId }, 'Hero shirt parent barcode not found in product_quantities');
    return null;
  } catch (error) {
    log.error({ productsModel, sizeId, error }, 'Error looking up hero shirt parent barcode');
    return null;
  }
}

/**
 * Validate order data before insertion
 * Equivalent to PHP: ManageMultisiteOrderIntegration->validateOrderTableDetails()
 */
function validateOrderData(orderData: Record<string, any>, logger?: Logger): { status: 'success' | 'failed'; errorDetails?: Record<string, string> } {
  const log = logger || defaultLogger;
  log.debug({
    orderId: orderData.marketplace_orders_id,
    customerName: orderData.customers_name
  }, 'Validating order data');

  const errors: Record<string, string> = {};

  // Required fields validation
  if (!orderData.customers_name || orderData.customers_name.trim() === '') {
    errors.customers_name = 'Cannot be blank';
  }

  if (!orderData.customers_street_address || orderData.customers_street_address.trim() === '') {
    errors.customers_street_address = 'Cannot be blank';
  }

  if (!orderData.customers_country || orderData.customers_country.trim() === '') {
    errors.customers_country = 'Cannot be blank';
  }

  if (!orderData.customers_email_address || orderData.customers_email_address.trim() === '') {
    errors.customers_email_address = 'Cannot be blank';
  }

  if (!orderData.delivery_name || orderData.delivery_name.trim() === '') {
    errors.delivery_name = 'Cannot be blank';
  }

  if (!orderData.delivery_street_address || orderData.delivery_street_address.trim() === '') {
    errors.delivery_street_address = 'Cannot be blank';
  }

  if (!orderData.delivery_country || orderData.delivery_country.trim() === '') {
    errors.delivery_country = 'Cannot be blank';
  }

  if (!orderData.payment_method || orderData.payment_method.trim() === '') {
    errors.payment_method = 'Cannot be blank';
  }

  if (!orderData.shipping_method || orderData.shipping_method.trim() === '') {
    errors.shipping_method = 'Cannot be blank';
  }

  if (!orderData.shipping_module_code || orderData.shipping_module_code.trim() === '') {
    errors.shipping_module_code = 'Cannot be blank';
  }

  if (Object.keys(errors).length > 0) {
    log.warn({
      orderId: orderData.marketplace_orders_id,
      errorCount: Object.keys(errors).length,
      errors
    }, 'Order validation failed');
    return { status: 'failed', errorDetails: errors };
  }

  log.debug({
    orderId: orderData.marketplace_orders_id
  }, 'Order validation passed');

  return { status: 'success' };
}

/**
 * Prepare order header data for insertion into orders table
 */
function prepareOrderHeaderData(
  marketplaceOrder: any,
  currencyDetails: { conversionRate: number; symbol: string },
  logger?: Logger
): Record<string, any> {
  const log = logger || defaultLogger;

  const zipCode = marketplaceOrder.moOrderShippingZipcode || 'N/A';
  const customerName = marketplaceOrder.moOrderCustomerName || '';
  const shippingAddress = [
    marketplaceOrder.moOrderShippingLine1?.trim() || '',
    marketplaceOrder.moOrderShippingLine2?.trim() || '',
    marketplaceOrder.moOrderShippingLine3?.trim() || '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const orderData: Record<string, any> = {
    customers_id: '0', // Marketplace customers not in UKSS system
    customers_name: customerName,
    customers_company: '',
    customers_street_address: shippingAddress || '',
    customers_suburb: '',
    customers_city: marketplaceOrder.moOrderShippingCity || '',
    customers_postcode: zipCode,
    customers_state: marketplaceOrder.moOrderShippingState || '',
    customers_country: marketplaceOrder.moOrderShippingCountry || '',
    customers_email_address: marketplaceOrder.moOrderCustomerEmail || DEFAULT_UKSS_MARKETPLACE_EMAIL,
    customers_telephone: marketplaceOrder.moCustomerPhone || '',

    // WHY: Delivery and billing addresses are set to the shipping address.
    // The MOP table only stores shipping address (no moBilling* fields).
    // Marketplace APIs don't provide separate billing addresses.
    delivery_name: customerName,
    delivery_company: '',
    delivery_street_address: shippingAddress || '',
    delivery_suburb: '',
    delivery_city: marketplaceOrder.moOrderShippingCity || '',
    delivery_postcode: zipCode,
    delivery_state: marketplaceOrder.moOrderShippingState || '',
    delivery_country: marketplaceOrder.moOrderShippingCountry || '',

    billing_name: customerName,
    billing_company: '',
    billing_street_address: shippingAddress || '',
    billing_suburb: '',
    billing_city: marketplaceOrder.moOrderShippingCity || '',
    billing_postcode: zipCode,
    billing_state: marketplaceOrder.moOrderShippingState || '',
    billing_country: marketplaceOrder.moOrderShippingCountry || '',

    // WHY: Constructed from store name — MOP has no payment method field.
    payment_method: `Payment via ${marketplaceOrder.moStoreName || 'Marketplace'}`,
    payment_module_code: '',
    shipping_method: marketplaceOrder.moOrderShippingMethod || '',
    shipping_module_code: marketplaceOrder.moOrderShippingMethod || '',
    date_purchased: marketplaceOrder.moOrderPlaceDate || new Date(),
    orders_status: String(UkssOrderStatus.PROCESSING),
    order_total: marketplaceOrder.moOrderTotal
      ? Number(marketplaceOrder.moOrderTotal) / currencyDetails.conversionRate
      : 0,
    order_tax: 0, // Recalculated from product VAT amounts after products are fetched
    currency: marketplaceOrder.moOrderCurrency || '',
    currency_value: currencyDetails.conversionRate,

    // Special fields
    order_site: marketplaceOrder.moAmazonStoreId || marketplaceOrder.moStoreId?.toString() || null,
    orders_from: null,
  };

  // Amazon order handling
  if (marketplaceOrder.moAmazonOrderId) {
    orderData.amazon_orders_id = marketplaceOrder.moAmazonOrderId;
  }

  // Delivery dates
  if (marketplaceOrder.moDeliverByDate) {
    orderData.deliver_by_date = marketplaceOrder.moDeliverByDate;
  }

  if (marketplaceOrder.moOrderShipByDate) {
    orderData.ship_by_date = marketplaceOrder.moOrderShipByDate;
  }

  log.debug({ orderData }, 'Order header data prepared');
  return orderData;
}

/**
 * Prepare order product data for insertion into orders_products table
 */
function prepareOrderProductData(
  marketplaceProduct: any,
  ordersId: number,
  currencyConversionRate: number
): Record<string, any> {
  return {
    orders_id: ordersId,
    products_id: marketplaceProduct.mopUkssProductId || null,
    products_model: null, // Will be populated from product lookup if needed
    product_barcode: null, // Will be populated from product lookup if needed
    products_name: marketplaceProduct.mopProductName || '',
    products_price: marketplaceProduct.mopProductPrice
      ? Number(marketplaceProduct.mopProductPrice) / currencyConversionRate
      : 0,
    final_price: marketplaceProduct.mopProductPrice
      ? Number(marketplaceProduct.mopProductPrice) / currencyConversionRate
      : 0,
    products_quantity: 1, // Each record represents one unit
  };
}

/**
 * Update marketplace order with UKSS order ID
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
async function updateMarketplaceOrder(
  moId: bigint,
  ukssOrderId: number,
  logger?: Logger,
  tx?: PrismaTransactionClient
) {
  const log = logger || defaultLogger;
  const client = tx || prisma;
  try {
    await client.moMarketplaceOrder.update({
      where: {
        moId: moId,
      },
      data: {
        moUkssOrderId: ukssOrderId,
      },
    });

    log.info({ moId, ukssOrderId }, 'Updated marketplace order with UKSS order ID');
  } catch (error) {
    log.error({ error: serializeError(error), moId, ukssOrderId }, 'Failed to update marketplace order');
    throw error;
  }
}

/**
 * Update marketplace order product with UKSS order product ID
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
async function updateMarketplaceOrderProduct(
  mopId: bigint,
  ukssOrderProductId: number,
  logger?: Logger,
  tx?: PrismaTransactionClient
) {
  const log = logger || defaultLogger;
  const client = tx || prisma;
  try {
    // Note: This field might not exist in the schema yet, so we'll use raw SQL
    await client.mopMarketplaceOrderProduct.update({
      where: { mopId: mopId },
      data: { mopUkssOrdersProductsId: ukssOrderProductId },
    });

    log.info({ mopId, ukssOrderProductId }, 'Updated marketplace order product with UKSS order product ID');
  } catch (error) {
    log.error({ error: serializeError(error), mopId, ukssOrderProductId }, 'Failed to update marketplace order product');
    throw error;
  }
}

/**
 * Process pending marketplace orders and convert them to UKSS orders
 * This is the main function equivalent to PHP: insert_order_detail_in_order_table()
 */
export async function processMarketplaceOrdersToUKSS(limit?: number) {
  const startTime = Date.now();
  const { executionId, logger: log } = createExecutionContext('marketplace-orders-service');

  log.info({ limit, executionId }, 'Starting marketplace orders to UKSS conversion');

  let processedCount = 0;
  let failedCount = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    // 1. Fetch pending marketplace orders
    const pendingOrders = await getPendingMarketplaceOrders(limit, log);

    if (pendingOrders.length === 0) {
      log.info('No pending marketplace orders found');
      return {
        success: true,
        processed: 0,
        failed: 0,
        message: 'No pending orders to process',
      };
    }

    // 2. Process each order
    log.info({
      totalOrders: pendingOrders.length
    }, 'Starting to process individual marketplace orders');

    for (const marketplaceOrder of pendingOrders) {
      const orderStartTime = Date.now();
      try {
        const marketplaceOrderId = marketplaceOrder.moOrderId || 'unknown';

        log.info({
          marketplaceOrderId,
          moId: marketplaceOrder.moId.toString(),
          storeName: marketplaceOrder.moStoreName,
          orderTotal: marketplaceOrder.moOrderTotal,
          currency: marketplaceOrder.moOrderCurrency
        }, 'Processing marketplace order');

        // 2.1 Get currency details
        // WHY: Use moUkssConversionRate (captured at order fetch time in Stage 1)
        // for consistent GBP values across MOP and UKSS tables.
        // getCurrencyDetails() is only used for the currency symbol.
        const currencyCode = marketplaceOrder.moOrderCurrency;
        const moConversionRate = Number(marketplaceOrder.moUkssConversionRate || 0);
        log.debug({ marketplaceOrderId, currencyCode, moConversionRate }, 'Resolving currency for order');
        const currencySymbolLookup = await getCurrencyDetails(currencyCode, log);

        if (!currencySymbolLookup) {
          const errorMsg = `Currency not found: ${currencyCode}`;
          log.error({
            marketplaceOrderId,
            currencyCode,
            moId: marketplaceOrder.moId.toString()
          }, errorMsg);
          failedCount++;
          errors.push({ orderId: marketplaceOrderId, error: errorMsg });

          await emailService.sendErrorNotification({
            subject: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed - Currency Not Found`,
            errorMessage: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed because currency not found in our database - ${escapeHtml(currencyCode || '')}`,
            module: 'marketplace-orders',
            context: {
              marketplaceOrderId,
              currencyCode,
              moId: marketplaceOrder.moId.toString()
            },
            executionId,
          });
          continue;
        }

        // Use MOP rate if available, fall back to fresh lookup for legacy data
        const currencyDetails = {
          conversionRate: moConversionRate > 0 ? moConversionRate : currencySymbolLookup.conversionRate,
          symbol: currencySymbolLookup.symbol,
        };

        // 2.2 Prepare order header data
        log.debug({ marketplaceOrderId }, 'Preparing order header data');
        const orderHeaderData = prepareOrderHeaderData(marketplaceOrder, currencyDetails, log);

        // 2.3 Validate order data
        log.debug({ marketplaceOrderId }, 'Validating order data');
        const validation = validateOrderData(orderHeaderData);
        if (validation.status === 'failed') {
          const errorMsg = `Validation failed: ${JSON.stringify(validation.errorDetails)}`;
          log.error({ marketplaceOrderId, errors: validation.errorDetails }, 'Order validation failed');
          await emailService.sendErrorNotification({
            subject: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed - Validation Failed`,
            errorMessage: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed because validation failed - ${escapeHtml(JSON.stringify(validation.errorDetails))}`,
            module: 'marketplace-orders',
            context: {
              marketplaceOrderId,
              errors: validation.errorDetails
            },
          });
          failedCount++;
          errors.push({ orderId: marketplaceOrderId, error: errorMsg });
          continue;
        }

        // 2.6 Fetch marketplace order products (before transaction - read operation)
        log.debug({
          marketplaceOrderId
        }, 'Fetching marketplace order products');
        const marketplaceProducts = await getMarketplaceOrderProducts(marketplaceOrder.moId, log);

        log.info({
          marketplaceOrderId,
          productCount: marketplaceProducts.length
        }, 'Processing order products');

        // Warn if order has no products, but still create the order
        if (marketplaceProducts.length === 0) {
          log.warn({ marketplaceOrderId }, 'Order has no products - will still create order header');
          await emailService.sendErrorNotification({
            subject: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Created Without Products`,
            errorMessage: `Hi Team,<br>Marketplace Order(${escapeHtml(marketplaceOrderId)}) was created but it has no products. Please check manually.`,
            module: 'marketplace-orders',
            context: {
              marketplaceOrderId,
            },
          });
        }

        // Prepare product variation lookups and validate all products in a single loop
        const productVariations = new Map<string, any>();
        const productOptions = new Map<string, { optionId: number | null; optionName: string; sizeValueName: string }>();
        const productsWithMissingVariations: Array<{ mopId: string; sku: string }> = [];

        for (const marketplaceProduct of marketplaceProducts) {
          try {
            const productVariation = await getProductVariationDataFromSKU(marketplaceProduct.mopUkssProductSku, log);
            if (productVariation) {
              productVariations.set(marketplaceProduct.mopId.toString(), productVariation);

              // Pre-fetch product options (keyed by productId + sizeValueId to handle
              // same product ordered in multiple sizes within one order)
              const productId = productVariation.npvProductsId;
              const productOptionValueId = productVariation.npvSizeOptionsValueId ?? null;
              const optionsKey = `${productId}-${productOptionValueId}`;
              if (productId && !productOptions.has(optionsKey)) {
                const optionId = await getSizeOptionToProduct(productId, log);
                const getSizeName = await getProductOptionDetails(optionId ?? undefined, undefined, log);
                const sizeValueName = await getSizeOptionValueName(productOptionValueId ?? 0, log);
                productOptions.set(optionsKey, {
                  optionId: optionId ?? null,
                  optionName: getSizeName?.productsOptionsName ?? '',
                  sizeValueName: sizeValueName?.productsOptionsValuesName ?? ''
                });
              }
            } else {
              // Product variation not found - add to missing list
              log.warn({
                sku: marketplaceProduct.mopUkssProductSku,
                mopId: marketplaceProduct.mopId.toString()
              }, 'Product variation not found for SKU');

              productsWithMissingVariations.push({
                mopId: marketplaceProduct.mopId.toString(),
                sku: marketplaceProduct.mopUkssProductSku || 'N/A'
              });
            }
          } catch (error) {
            log.error({ error: serializeError(error), mopId: marketplaceProduct.mopId.toString() }, 'Error fetching product variation');
            // If error occurs, treat as missing variation
            productsWithMissingVariations.push({
              mopId: marketplaceProduct.mopId.toString(),
              sku: marketplaceProduct.mopUkssProductSku || 'N/A'
            });
          }
        }

        // Warn about missing variations but still create the order
        if (productsWithMissingVariations.length > 0) {
          log.warn({
            marketplaceOrderId,
            missingCount: productsWithMissingVariations.length
          }, 'Order has products with missing SKU/variation - will still create order, skipping those products');

          // Send email notification
          await emailService.sendErrorNotification({
            subject: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Created - Missing Product Variations`,
            errorMessage: `Hi Team,<br>Marketplace Order(${escapeHtml(marketplaceOrderId)}) was created but the following products were skipped due to missing SKU/variation:<br><ul>${productsWithMissingVariations.map(p => `<li>Product ID: ${escapeHtml(p.mopId)}, SKU: ${escapeHtml(p.sku)}</li>`).join('')}</ul>`,
            module: 'marketplace-orders',
            context: {
              marketplaceOrderId,
              missingProducts: productsWithMissingVariations
            },
          });
        }

        // Calculate order tax from MOP product VAT amounts
        // WHY: Stage 1 captures per-product VAT (mopProductVatAmount) from marketplace APIs.
        // Previously this data was discarded — order_tax was hardcoded to 0.
        const orderTaxOriginal = marketplaceProducts.reduce((sum, p) => {
          const vatAmount = Number(p.mopProductVatAmount || 0);
          const qty = Number(p.mopProductQuantity ?? 1);
          return sum + (vatAmount * qty);
        }, 0);
        const orderTaxConverted = Number((orderTaxOriginal / currencyDetails.conversionRate).toFixed(2));
        orderHeaderData.order_tax = orderTaxConverted;

        // 2.4-2.10 Wrap all database write operations in a transaction
        // This ensures atomicity: either all operations succeed or all are rolled back
        let ukssOrderId: number | null = null;
        try {
          await prisma.$transaction(async (tx: PrismaTransactionClient) => {
            // 2.4 Insert order header
            ukssOrderId = await insertOrderHeader(orderHeaderData, log, tx);

            if (!ukssOrderId) {
              throw new Error('Failed to insert order header');
            }

            log.info({ marketplaceOrderId, ukssOrderId }, 'Order header inserted successfully');

            // 2.5 Update marketplace order with UKSS order ID
            await updateMarketplaceOrder(marketplaceOrder.moId, ukssOrderId, log, tx);

            // 2.6 Process order products
            for (const marketplaceProduct of marketplaceProducts) {
              const productVariation = productVariations.get(marketplaceProduct.mopId.toString());

              if (!productVariation) {
                log.warn({ mopId: marketplaceProduct.mopId.toString() }, 'Skipping product - no variation found for SKU');
                continue;
              }

              const quantity = marketplaceProduct.mopProductQuantity ?? 1;

              // Create one record per unit (quantity = 1 for each)
              for (let i = 0; i < quantity; i++) {
                const productData = prepareOrderProductData(
                  marketplaceProduct,
                  ukssOrderId,
                  currencyDetails.conversionRate
                );

                // Update product data with variation info
                productData.products_id = productVariation.npvProductsId || productData.products_id;
                productData.products_model = productVariation.npvProductsModel || productData.products_model;
                productData.products_name = productVariation.npvProductsName || productData.products_name;

                // Hero shirt barcode fix: if the product has a parent (hero shirt),
                // use the parent product's barcode from product_quantities instead of
                // the hero shirt's own barcode from new_products_variations
                const heroParentBarcode = await getHeroShirtParentBarcode(
                  productVariation.npvProductsModel,
                  productVariation.npvProductsOptionsValuesToProductsOptionsId,
                  tx,
                  log,
                );
                productData.product_barcode = heroParentBarcode
                  || productVariation.npvProductsBarcodes
                  || productData.product_barcode;

                const ukssOrderProductId = await insertOrderProduct(productData, log, tx);

                if (!ukssOrderProductId) {
                  throw new Error(`Failed to insert order product for mopId: ${marketplaceProduct.mopId.toString()}`);
                }

                // Update marketplace order product with UKSS order product ID
                await updateMarketplaceOrderProduct(marketplaceProduct.mopId, ukssOrderProductId, log, tx);

                // Get product options (using composite key to match correct size)
                const productId = productData.products_id;
                const productOptionValueId = productVariation.npvSizeOptionsValueId ?? null;
                const options = productOptions.get(`${productId}-${productOptionValueId}`);

                // Insert product attributes (size) if we have variation data
                if (productVariation && productVariation.npvSizeOptionsValueId && options) {
                  const attributeData = {
                    orders_id: ukssOrderId,
                    orders_products_id: ukssOrderProductId,
                    products_options: options.optionName,
                    products_options_values: options.sizeValueName,
                    products_options_id: options.optionId,
                    products_options_values_id: productOptionValueId,
                  };

                  await insertOrderProductAttribute(attributeData, log, tx);
                  log.info({ ukssOrderProductId }, 'Product size attribute inserted');
                }

                // Insert personalized attributes if mop_extra_info exists
                const storeId = marketplaceOrder.moStoreId;

                if (
                  marketplaceProduct.mopExtraInfo &&
                  storeId &&
                  PERSONALIZE_SITE_IDS.includes(storeId)
                ) {
                  try {
                    const extraInfo = JSON.parse(marketplaceProduct.mopExtraInfo);
                    const hasName = extraInfo.name && extraInfo.name.trim() !== '';
                    const hasNumber = extraInfo.number && extraInfo.number.trim() !== '';

                    if (hasName || hasNumber) {
                      const personalizedAttributeData = {
                        orders_id: ukssOrderId,
                        orders_products_id: ukssOrderProductId,
                        products_options: PERSONALIZE_OPTION_NAME,
                        products_options_values: `${extraInfo.name || ''}, ${extraInfo.number || ''}`.trim().replace(/^,\s*|,\s*$/g, ''),
                        products_options_id: PERSONALIZE_OPTION_ID,
                        products_options_values_id: 0,
                        options_values_price: extraInfo.price ? Number(extraInfo.price) / currencyDetails.conversionRate : 0,
                        price_prefix: '+',
                      };

                      await insertOrderProductAttribute(personalizedAttributeData, log, tx);
                      log.info({ ukssOrderProductId }, 'Personalized attribute inserted');
                    }
                  } catch (error) {
                    log.error({ error: serializeError(error), mopId: marketplaceProduct.mopId.toString() }, 'Failed to parse personalized attribute');
                    // Don't throw - continue with order processing
                  }
                }

                log.info(
                  { mopId: marketplaceProduct.mopId.toString(), ukssOrderProductId },
                  'Order product inserted successfully'
                );
              }
            }

            // 2.7 Insert order totals (Total, Shipping, Sub-Total)
            log.debug({
              marketplaceOrderId,
              ukssOrderId
            }, 'Preparing order totals');
            const shippingMethod = marketplaceOrder.moOrderShippingMethod || 'Shipping';
            const totals: Array<{ title: string; class: string; sort_order: string; text: string; value: number }> = [
              {
                title: 'Sub-Total:',
                class: OrderTotalClass.SUBTOTAL,
                sort_order: OrderTotalSortOrder.SUBTOTAL,
                text: `${currencyDetails.symbol}${marketplaceOrder.moOrderSubtotal || 0}`,
                value: Number((Number(marketplaceOrder.moOrderSubtotal || 0) / currencyDetails.conversionRate).toFixed(2)),
              },
              {
                title: `${shippingMethod}:`,
                class: OrderTotalClass.SHIPPING,
                sort_order: OrderTotalSortOrder.SHIPPING,
                text: `${currencyDetails.symbol}${marketplaceOrder.moShippingTotal || 0}`,
                value: Number((Number(marketplaceOrder.moShippingTotal || 0) / currencyDetails.conversionRate).toFixed(2)),
              },
              {
                title: 'Total:',
                class: OrderTotalClass.TOTAL,
                sort_order: OrderTotalSortOrder.TOTAL,
                text: `${currencyDetails.symbol}${marketplaceOrder.moOrderTotal || 0}`,
                value: Number((Number(marketplaceOrder.moOrderTotal || 0) / currencyDetails.conversionRate).toFixed(2)),
              },
            ];

            // Add tax row if VAT data was captured by Stage 1
            if (orderTaxConverted > 0) {
              totals.push({
                title: 'Tax:',
                class: OrderTotalClass.TAX,
                sort_order: OrderTotalSortOrder.TAX,
                text: `${currencyDetails.symbol}${orderTaxOriginal.toFixed(2)}`,
                value: orderTaxConverted,
              });
            }

            for (const total of totals) {
              const totalData = {
                orders_id: ukssOrderId,
                title: total.title,
                text: total.text,
                value: total.value,
                class: total.class,
                sort_order: total.sort_order,
              };

              await insertOrderTotal(totalData, log, tx);
              log.debug({
                ukssOrderId,
                title: total.title,
                value: total.value
              }, 'Order total inserted');
            }

            log.info({
              marketplaceOrderId,
              ukssOrderId,
              totalCount: totals.length
            }, 'All order totals inserted successfully');

            // 2.8 Insert order status history
            log.debug({ marketplaceOrderId, ukssOrderId }, 'Inserting order status history');
            const statusHistoryData = {
              orders_id: ukssOrderId,
              orders_status_id: String(UkssOrderStatus.PROCESSING),
              date_added: new Date().toISOString().slice(0, 19).replace('T', ' '), // Format: YYYY-MM-DD HH:MM:SS
              customer_notified: '0',
              comments: 'Processing',
            };

            await insertOrderStatusHistory(statusHistoryData, log, tx);
            log.info({
              marketplaceOrderId,
              ukssOrderId,
              statusId: String(UkssOrderStatus.PROCESSING)
            }, 'Order status history inserted');

            // 2.10 Update PayPal for Toffs orders
            const toffsStoreName = config.TOFFS_STORE_NAME || 'Toffs';
            if (
              marketplaceOrder.moExternalOrderId &&
              marketplaceOrder.moStoreName === toffsStoreName
            ) {
              const paypalUpdated = await updatePaypalOrderId(ukssOrderId, marketplaceOrder.moExternalOrderId, log, tx);
              if (!paypalUpdated) {
                log.warn({ ukssOrderId, marketplaceOrderId: marketplaceOrder.moExternalOrderId }, 'PayPal update returned false');
                // Don't throw - PayPal update failure shouldn't rollback the entire order
              }
            }
          }, {
            timeout: TRANSACTION_TIMEOUT_MS,
          });

          // Transaction completed successfully
          log.info({ marketplaceOrderId, ukssOrderId }, 'Order transaction completed successfully');

          // Post-transaction: Assign ship date (non-fatal — order is already created)
          if (ukssOrderId) {
            try {
              const printingFlag = await detectPrintingOrder(ukssOrderId, log);
              await assignShipDate(ukssOrderId, printingFlag, log);
            } catch (shipDateError) {
              log.error({ error: shipDateError, ukssOrderId, marketplaceOrderId }, 'Failed to assign ship date (non-fatal)');
            }

            // Post-transaction: Auto-process for warehouse queue (non-fatal)
            try {
              await autoProcessOrderProducts(ukssOrderId, log);
            } catch (autoProcessError) {
              log.error({ error: autoProcessError, ukssOrderId, marketplaceOrderId }, 'Failed to auto-process order products (non-fatal)');
            }
          }

          // Handle personalized order missing data notification (outside transaction)
          const storeId = marketplaceOrder.moStoreId;
          for (const marketplaceProduct of marketplaceProducts) {
            if (
              marketplaceProduct.mopExtraInfo &&
              storeId &&
              PERSONALIZE_SITE_IDS.includes(storeId)
            ) {
              try {
                const extraInfo = JSON.parse(marketplaceProduct.mopExtraInfo);
                const hasName = extraInfo.name && extraInfo.name.trim() !== '';
                const hasNumber = extraInfo.number && extraInfo.number.trim() !== '';

                if (!hasName && !hasNumber && ukssOrderId) {
                  await emailService.sendErrorNotification({
                    subject: `DATA MISSING: ${escapeHtml(marketplaceOrder.moStoreName || '')} Personalized order data missing.`,
                    errorMessage: `Hi,<br><br> In the given below ${escapeHtml(marketplaceOrder.moStoreName || '')} personalized order, Both Name and Number are missing so we have not made the entry of this order product in 'orders_products_attributes' table. <br><br> Kindly check the order details manually.<br> ${escapeHtml(marketplaceOrder.moStoreName || '')} order id: ${escapeHtml(String(marketplaceProduct.mopOrderId || ''))}<br> UKSS order id: ${ukssOrderId}`,
                    module: 'marketplace-orders',
                    context: {
                      marketplaceOrderId: marketplaceOrder.moOrderId,
                    },
                  });
                }
              } catch (error) {
                // Ignore parse errors for notification
              }
            }
          }

        } catch (error) {
          // Transaction was rolled back automatically
          const errorMsg = getErrorMessage(error);
          log.error({
            error: serializeError(error),
            marketplaceOrderId,
            moId: marketplaceOrder.moId.toString()
          }, 'Transaction failed - all changes rolled back');

          failedCount++;
          errors.push({ orderId: marketplaceOrderId, error: errorMsg });

          await emailService.sendErrorNotification({
            subject: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed - Transaction Rolled Back`,
            errorMessage: `Marketplace Order(${escapeHtml(marketplaceOrderId)}) Insert Failed. Transaction was rolled back due to error: ${escapeHtml(errorMsg)}${buildTransactionRollbackVerificationNote(escapeHtml(marketplaceOrderId))}`,
            module: 'marketplace-orders',
            context: {
              marketplaceOrderId,
              error: errorMsg,
              moId: marketplaceOrder.moId.toString()
            },
          });
          continue;
        }

        const orderDuration = Date.now() - orderStartTime;
        processedCount++;
        log.info({
          marketplaceOrderId,
          ukssOrderId,
          duration: orderDuration
        }, 'Marketplace order processed successfully');
      } catch (error) {
        const orderDuration = Date.now() - orderStartTime;
        const errorMsg = getErrorMessage(error);
        log.error({
          error: serializeError(error),
          marketplaceOrderId: marketplaceOrder.moOrderId,
          moId: marketplaceOrder.moId.toString(),
          duration: orderDuration
        }, 'Error processing marketplace order');
        failedCount++;
        errors.push({ orderId: marketplaceOrder.moOrderId || 'unknown', error: errorMsg });
      }
    }

    const duration = Date.now() - startTime;

    log.info(
      { processed: processedCount, failed: failedCount, duration },
      'Marketplace orders to UKSS conversion completed'
    );

    return {
      success: true,
      processed: processedCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    log.error({ error: serializeError(error) }, 'Failed to process marketplace orders to UKSS');
    await emailService.sendErrorNotification({
      subject: `Error: Marketplace Orders to UKSS Conversion Failed`,
      errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Orders From Marketplace to UKSS <br><b>File:</b> apps/api/src/modules/marketplace-orders/marketplace-orders.service.ts <br><b>Error:</b> Failed to process marketplace orders to UKSS.`,
      module: 'marketplace-orders',
      context: {
        error: errorMsg,
      },
    });

    return {
      success: false,
      processed: processedCount,
      failed: failedCount,
      error: errorMsg,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
