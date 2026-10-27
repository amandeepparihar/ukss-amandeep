/**
 * Marketplace Orders - Create Orders in UKSS Utilities
 * 
 * This module contains reusable functions for creating marketplace orders in UKSS database.
 * Extracted from shopify-orders.service.ts for reusability across different order sources.
 */

import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { getStoreDetails } from '../store-management/store-management-utils';
import { getProductVariationDataFromSKU } from '../new-product-variations/new-product-variations-utils';
import { getCurrencyDetails } from '../helpers/common-utils';
import { emailService } from '../email';
import { config } from '../../config';
import { TRANSACTION_TIMEOUT_MS } from '../../modules/marketplaces/orders/constants';

const defaultLogger = createLogger('marketplace-orders-utils');

// Type helper for Prisma transaction client
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Verification step shown to the BA when an order insert fails because its
 * transaction was rolled back. A rolled-back transaction does not always mean
 * the order is missing, so the BA must confirm against the database before
 * escalating to a developer.
 *
 * @param marketplaceOrderId - The marketplace order id(s) to verify. Optional;
 *                             when omitted, generic wording is used.
 * @returns HTML snippet to append to the error notification email body.
 */
export function buildTransactionRollbackVerificationNote(marketplaceOrderId?: string): string {
  const idText = marketplaceOrderId
    ? `<code>${marketplaceOrderId}</code>`
    : 'the marketplace order id';
  return `
    <h3 style="color: #0275d8;">Verification Step (for BA):</h3>
    <ol>
      <li>Open the <b>mo_marketplace_orders</b> table and search for ${idText} in the <b>mo_order_id</b> column.</li>
      <li>If the <b>mo_order_id</b> is present, the order has already been inserted — no further action is needed.</li>
      <li>If it is not present, wait for half an hour and check again.</li>
      <li>If it is still not present after half an hour, raise the issue to the developer.</li>
    </ol>`;
}

/**
 * Get pending marketplace orders (where mo_ukss_order_id IS NULL)
 * 
 * @param limit - Maximum number of orders to fetch
 * @returns Array of marketplace orders
 */
export async function getPendingMarketplaceOrders(limit?: number, logger?: Logger) {
  const startTime = Date.now();
  const log = logger || defaultLogger;
  try {

    const orders = await prisma.moMarketplaceOrder.findMany({
      where: {
        moUkssOrderId: null,
      },
      ...(limit ? { take: limit } : {}),
      orderBy: {
        moDateAdded: 'asc',
      },
      include: {
        products: true,
      },
    });

    const duration = Date.now() - startTime;
    log.info({
      count: orders.length,
      limit,
      duration
    }, 'Fetched pending marketplace orders successfully');

    if (orders.length > 0) {
      const orderIds = orders.map((o: any) => o.moOrderId).filter(Boolean);
      log.debug({
        orderIds: orderIds.slice(0, 10), // Log first 10 IDs
        totalOrders: orders.length
      }, 'Pending order IDs retrieved');
    }

    return orders;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', limit, duration }, 'Failed to fetch pending marketplace orders');
    throw error;
  }
}

/**
 * Check if an order already exists in the database
 * Equivalent to PHP: get_order_status($mo_order_id, $mo_store_id)
 *
 * Matches if the API order id equals mo_order_id OR mo_external_order_id for the store
 * (legacy rows may store the marketplace id only in mo_external_order_id).
 *
 * @param orderId - Order ID to check
 * @param storeId - Store ID
 * @param logger - Optional logger instance (for dependency injection)
 * @returns 1 if order exists, 0 if not
 */
export async function getOrderStatus(
  orderId: string,
  storeId: number,
  logger?: Logger
): Promise<0 | 1> {
  const log = logger || defaultLogger;

  try {
    const existingOrder = await prisma.moMarketplaceOrder.findFirst({
      where: {
        moStoreId: storeId,
        OR: [{ moOrderId: orderId }, { moExternalOrderId: orderId }],
      },
      select: {
        moId: true,
      },
    });

    return existingOrder ? 1 : 0;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', orderId, storeId }, 'Error checking order status');
    return 0; // If error, treat as new order
  }
}

/**
 * Check if an order already exists with global external ID matching.
 *
 * Matches if:
 * 1) mo_order_id equals API order id for the same store, OR
 * 2) mo_external_order_id equals API order id for Baselinker store only
 *    (mo_store_id = BASELINKER_STORE_ID from env).
 *
 * @param orderId - Order ID to check
 * @param storeId - Store ID
 * @param logger - Optional logger instance (for dependency injection)
 * @returns 1 if order exists, 0 if not
 */
export async function getOrderStatusWithGlobalExternalId(
  orderId: string,
  storeId: number,
  logger?: Logger
): Promise<0 | 1> {
  const log = logger || defaultLogger;

  try {
    const existingOrder = await prisma.moMarketplaceOrder.findFirst({
      where: {
        OR: [
          { moStoreId: storeId, moOrderId: orderId },
          { moStoreId: config.BASELINKER_STORE_ID, moExternalOrderId: orderId },
        ],
      },
      select: {
        moId: true,
      },
    });

    return existingOrder ? 1 : 0;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', orderId, storeId }, 'Error checking order status with global external ID');
    return 0; // If error, treat as new order
  }
}

/**
 * Insert marketplace order details into database
 *
 * @param ordersData - Orders data to insert
 * @param logger - Optional logger instance (for dependency injection)
 * @param useTransaction - Whether to use transaction for inserts (default: true)
 * @returns Success or error message
 */
export async function insertMarketPlaceOrderDetails(
  ordersData: Record<
    string,
    {
      MoMarketplaceOrder: any;
      MopMarketplaceOrderProduct: any[];
      MoshMarketplaceOrderStatusHistory: any;
      PaypalData?: any;
    }
  >,
  logger?: Logger,
  useTransaction: boolean = true
): Promise<string> {
  const log = logger || defaultLogger;

  try {
    if (!ordersData || Object.keys(ordersData).length === 0) {
      return 'No New Order Found';
    }

    // Track successful and failed orders
    const successfulOrders: string[] = [];
    const failedOrders: { orderId: string; error: string; storeName: string }[] = [];

    // Process each order
    for (const [orderId, data] of Object.entries(ordersData)) {
      const storeName = data.MoMarketplaceOrder?.moStoreName || 'Unknown';

      try {
        if (useTransaction) {
          // Use transaction to ensure all inserts are atomic
          // If any operation fails, all changes will be rolled back
          await prisma.$transaction(async (tx: PrismaTransactionClient) => {
            // Insert order header
            const orderHeader = await tx.moMarketplaceOrder.create({
              data: data.MoMarketplaceOrder,
            });

            const moId = orderHeader.moId;

            // Update products with mo_id
            const productsToInsert = data.MopMarketplaceOrderProduct.map(
              (product) => ({
                ...product,
                mopMoId: moId,
              })
            );

            // Insert products
            const productsInserted = await tx.mopMarketplaceOrderProduct.createMany({
              data: productsToInsert,
            });

            // Update status history with mo_id
            const statusHistory = {
              ...data.MoshMarketplaceOrderStatusHistory,
              moshMoId: moId,
            };

            // Insert status history
            const statusHistoryInserted = await tx.moshMarketplaceOrderStatusHistory.create({
              data: statusHistory,
            });

            if (productsInserted.count > 0 && statusHistoryInserted.moshId) {
              // Insert PayPal data
              if (data.PaypalData) {
                await tx.paypal.create({
                  data: data.PaypalData.Paypal,
                });
              }
            }

            log.info({ orderId, moId }, 'Order inserted successfully in transaction');
          }, {
            // Stage 2 insert mirrors Stage 3 (marketplace-orders.service.ts): the
            // default 5s interactive-transaction timeout is too tight under cron
            // batch load (event-loop / connection-pool starvation between the awaited
            // inserts), causing P2028 "Transaction already closed" rollbacks. PM #166206
            timeout: TRANSACTION_TIMEOUT_MS,
          });

          successfulOrders.push(orderId);
        } else {
          // Insert order header
          const orderHeader = await prisma.moMarketplaceOrder.create({
            data: data.MoMarketplaceOrder,
          });

          const moId = orderHeader.moId;

          // Update products with mo_id
          const productsToInsert = data.MopMarketplaceOrderProduct.map(
            (product) => ({
              ...product,
              mopMoId: moId,
            })
          );

          // Insert products
          const productsInserted = await prisma.mopMarketplaceOrderProduct.createMany({
            data: productsToInsert,
          });

          // Update status history with mo_id
          const statusHistory = {
            ...data.MoshMarketplaceOrderStatusHistory,
            moshMoId: moId,
          };

          // Insert status history
          const statusHistoryInserted = await prisma.moshMarketplaceOrderStatusHistory.create({
            data: statusHistory,
          });

          if (productsInserted.count > 0 && statusHistoryInserted.moshId) {
            // Insert PayPal data
            if (data.PaypalData) {
              await prisma.paypal.create({
                data: data.PaypalData.Paypal,
              });
            }
          }

          log.info({ orderId, moId }, 'Order inserted successfully without transaction');
          successfulOrders.push(orderId);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error(
          { error: errorMessage, orderId, storeName },
          useTransaction ? 'Error inserting order (transaction rolled back)' : 'Error inserting order'
        );

        // Track failed order and continue processing remaining orders
        failedOrders.push({ orderId, error: errorMessage, storeName });
      }
    }

    // Send email notification if any orders failed
    if (failedOrders.length > 0) {
      log.error(
        { failedOrders, successfulOrders },
        'Some orders failed to insert into database'
      );

      // Build failed orders details for email
      const failedOrdersDetails = failedOrders
        .map(
          (order) =>
            `<tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${order.orderId}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${order.storeName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${order.error}</td>
            </tr>`
        )
        .join('');

      // Get unique store names for subject
      const storeNames = [...new Set(failedOrders.map((o) => o.storeName))].join(', ');

      await emailService.sendErrorNotification({
        subject: `Error: Marketplace Order(s) Failed to Insert - ${storeNames}`,
        errorMessage: `Hi Team,<br><br>
          <b style="color: #d9534f;">Some marketplace orders failed to insert into the database.</b><br><br>
          <b>Module Name:</b> Marketplace Orders Utils<br>
          <b>File:</b> apps/api/src/lib/marketplace-orders/marketplace-orders-utils.ts<br>
          <b>Function:</b> insertMarketPlaceOrderDetails<br><br>

          ${successfulOrders.length > 0 ? `
          <h3 style="color: #5cb85c;">Successfully Inserted Orders (${successfulOrders.length}):</h3>
          <p>${successfulOrders.join(', ')}</p><br>
          ` : ''}

          <h3 style="color: #d9534f;">Failed Orders (${failedOrders.length}):</h3>
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Order ID</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Store</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Error</th>
              </tr>
            </thead>
            <tbody>
              ${failedOrdersDetails}
            </tbody>
          </table>

          <h3 style="color: #0275d8;">Action Required:</h3>
          <ol>
            <li>Check the error messages above to identify the root cause.</li>
            <li>Common issues include:
              <ul>
                <li>Database connection issues</li>
                <li>Duplicate order ID (order may already exist)</li>
                <li>Invalid data format or missing required fields</li>
                <li>Foreign key constraint violations</li>
              </ul>
            </li>
            <li>Once the issue is resolved, the orders can be reprocessed by running the job again.</li>
          </ol>

          <p style="background-color: #fcf8e3; padding: 10px; border: 1px solid #faebcc; border-radius: 4px;">
            <b>Note:</b> Orders that failed were rolled back (if using transactions).
            Successfully inserted orders are not affected by these failures.
          </p>
          ${useTransaction ? buildTransactionRollbackVerificationNote() : ''}`,
        module: 'marketplace-orders-utils',
        context: { successfulOrders, failedOrders },
      });
    }

    // Determine return status based on results
    if (failedOrders.length === 0) {
      return 'Inserted Successfully';
    } else if (successfulOrders.length === 0) {
      return 'Error in inserting the order product details';
    } else {
      // Partial success - some orders inserted, some failed
      return 'Partially Inserted';
    }
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Error in insertMarketPlaceOrderDetails');
    return 'Error in inserting the order product details: ' + errorMessage;
  }
}

/**
 * Process and save orders
 * 
 * Equivalent to PHP's create_orders_in_ukss() function
 * This function processes marketplace orders (from Shopify or other sources) and saves them into the UKSS database system.
 * 
 * @param orders - Array of order objects (Shopify order format or compatible format)
 * @param storeName - Name of the store/marketplace
 * @param logger - Optional logger instance (for dependency injection). If provided, all logs will go to the same file as the caller.
 * @returns Object with processed and failed counts
 */
export async function createOrdersInUKSS(
  orders: any[],
  storeName: string,
  logger?: Logger
): Promise<{ processed: number; failed: number }> {
  // Use provided logger or fall back to default
  const log = logger || defaultLogger;

  let processed = 0;
  let failed = 0;

  log.info({ orderCount: orders.length, storeName }, 'Processing orders');

  try {
    // Get store details from store_management table
    const storeDetails = await getStoreDetails(storeName, log);

    if (!storeDetails) {
      log.error({ storeName }, 'Store not found in store_management table');
      return { processed: 0, failed: orders.length };
    }

    const moStoreId = storeDetails.storeId;
    const marketPlaceName = storeName;

    // Stores where UKSS is one of several sellers on the marketplace (e.g. Lokkaroom).
    // For these, an order may contain other sellers' products (SKUs not in our DB):
    // we save only our line items, apportion shipping to our share, treat missing SKUs
    // as expected (no alert), and skip orders that contain none of our products.
    const isMultiSellerStore = (config.MULTI_SELLER_STORES || '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => !Number.isNaN(id))
      .includes(moStoreId);

    // Prepare data structure for all orders
    const multiMarketPlaceData: Record<
      string,
      {
        MoMarketplaceOrder: any;
        MopMarketplaceOrderProduct: any[];
        MoshMarketplaceOrderStatusHistory: any;
        PaypalData?: any;
      }
    > = {};

    // Process each order
    for (const ordersDetails of orders) {
      try {
        const orderId = ordersDetails.id?.toString() || '';

        // Check if order already exists
        const status = await getOrderStatus(orderId, moStoreId, log);
        log.info(
          { orderId, status },
          'Order status check completed'
        );

        if (status === 1) {
          log.info({ orderId }, 'Order already exists, skipping');
          continue;
        }

        // Prepare order header data
        const orderData: any = {
          moStoreName: marketPlaceName,
          moStoreId: moStoreId,
          moOrderId: orderId,
          moOrderPlaceDate: ordersDetails.created_at
            ? new Date(ordersDetails.created_at)
            : null,
          moOrderUpdateDate: ordersDetails.updated_at
            ? new Date(ordersDetails.updated_at)
            : null,
          moOrderShipByDate: null,
          moOrderStatus: ordersDetails.fulfillment_status || null,
          moOrderCustomerId:
            ordersDetails.customer?.default_address?.customer_id?.toString() ||
            null,
          moOrderCustomerEmail: ordersDetails.customer?.email || null,
          moOrderShippingMethod:
            ordersDetails.shipping_lines?.[0]?.code || null,
          // FIX: Use shipping_address instead of customer.default_address to get the actual delivery address. PM ID: #165208
          moOrderShippingLine1:
            ordersDetails.shipping_address?.address1 || null,
          moOrderShippingLine2:
            ordersDetails.shipping_address?.address2 || null,
          moOrderCustomerName: `${ordersDetails.customer?.first_name || ''} ${ordersDetails.customer?.last_name || ''}`.trim() || null,
          moCustomerPhone: ordersDetails.customer?.phone || null,
          moOrderShippingCity: ordersDetails.shipping_address?.city || null,
          moOrderShippingState: ordersDetails.shipping_address?.province || null,
          moOrderShippingZipcode: ordersDetails.shipping_address?.zip || null,
          moUkssOrderId: null,
          moCreatedBy: 'footykit',
          moModifiedBy: 'footykit',
          moDateAdded: new Date(),
          moDateModified: new Date(),
        };

        // Prepare personalized products mapping (for stores that support it)
        const personalisedOptionId: Record<
          string,
          { price: number; lineItemId: string }
        > = {};

        if (
          config.PERSONALIZE_ORDERS_SITE &&
          config.PERSONALIZE_ORDERS_SITE.split(',').map(Number).includes(moStoreId) &&
          ordersDetails.line_items &&
          Array.isArray(ordersDetails.line_items)
        ) {
          for (const orderProductDetails of ordersDetails.line_items) {
            if (
              config.SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID &&
              config.SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID.split(',').map(Number).includes(
                Number(orderProductDetails.product_id)
              )
            ) {
              if (orderProductDetails.properties) {
                for (const prop of orderProductDetails.properties) {
                  if (prop.name === '_gpo_parent_product_group') {
                    personalisedOptionId[String(prop.value)] = {
                      price: parseFloat(orderProductDetails.price || '0'),
                      lineItemId: orderProductDetails.id?.toString() || '',
                    };
                  }
                }
              }
            }
          }
        }

        // Process line items (products)
        const products: any[] = [];
        // BOC: Skip order if SKU is not found in new_products_variations table and send email notification. PM ID: #165208
        const missingSKUs: string[] = [];
        // Multi-seller apportionment: count our line items, our shippable line items,
        // and sum our (discount-adjusted) subtotal.
        let ourLineItemCount = 0;
        let ourShippableCount = 0;
        let ourSubtotal = 0;

        if (ordersDetails.line_items && Array.isArray(ordersDetails.line_items)) {
          for (const productDetails of ordersDetails.line_items) {
            // Skip personalized option products (they're handled separately)
            if (
              config.SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID &&
              config.SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID.split(',').map(Number).includes(
                Number(productDetails.product_id)
              )
            ) {
              continue;
            }

            // Initialize personalized info
            const mopExtraInfo: any = {};
            let productPrice = parseFloat(productDetails.price || '0');
            let productId = productDetails.id?.toString() || '';

            // Process personalized product properties
            if (
              productDetails.properties &&
              Array.isArray(productDetails.properties) &&
              config.PERSONALIZE_ORDERS_SITE &&
              config.PERSONALIZE_ORDERS_SITE.split(',').map(Number).includes(moStoreId)
            ) {
              for (const prop of productDetails.properties) {
                if (prop.name === 'Name' && prop.value && prop.value.trim() !== '') {
                  mopExtraInfo.name = prop.value;
                } else if (
                  prop.name === 'Number' &&
                  prop.value &&
                  prop.value.trim() !== ''
                ) {
                  mopExtraInfo.number = prop.value;
                } else if (prop.name === '_gpo_addon_price') {
                  mopExtraInfo.price = parseFloat(prop.value || '0');
                } else if (prop.name === '_gpo_product_group') {
                  const groupValue = String(prop.value);
                  if (personalisedOptionId[groupValue]) {
                    // Add personalized price to product price
                    productPrice += personalisedOptionId[groupValue].price;
                    mopExtraInfo.price = personalisedOptionId[groupValue].price;
                    // Append personalized line item ID
                    productId = `${productId},${personalisedOptionId[groupValue].lineItemId}`;
                  }
                }
              }
            }

            const mopExtraInfoJson =
              Object.keys(mopExtraInfo).length > 0
                ? JSON.stringify(mopExtraInfo)
                : null;

            // Handle SKU (set to empty string if null)
            const productSku = productDetails.sku;

            // Lookup UKSS product ID from SKU
            const productVariationDetails = await getProductVariationDataFromSKU(productSku, log);

            if (!productVariationDetails || !productVariationDetails.npvProductsId) {
              log.error(
                { orderId, sku: productSku },
                'SKU not found in new_products_variations table for Shopify order'
              );
              if (productSku && !missingSKUs.includes(productSku)) {
                missingSKUs.push(productSku);
              }
              continue; // Skip this product
            }

            const ukssProductId = String(productVariationDetails.npvProductsId);

            // Create base product record
            const baseProduct: any = {
              mopStoreName: marketPlaceName,
              mopOrderId: orderId,
              mopMoId: 0, // Will be updated after order header is saved
              mopProductId: productId,
              mopProductSku: productSku || '',
              mopProductStatus: null,
              mopProductName: productDetails.title || null,
              mopProductUpcEan: null,
              mopProductPrice: productPrice,
              mopProductVatAmount: parseFloat(
                productDetails.tax_lines?.[0]?.price || '0'
              ),
              mopProductVatIncluded: productDetails.taxable ? '1' : '0',
              mopProductQuantity: 1,
              mopProductAttributeName: productDetails.variant_title || null,
              mopExtraInfo: mopExtraInfoJson,
              mopUkssProductSku: productSku || '',
              mopUkssProductId: ukssProductId,
              mopUkssProductConfirmationStatus: null,
              mopUkssProductShippingStatus: null,
              mopUkssProductCancelReason: null,
              mopUkssProductReturnReason: null,
              mopUkssTrackingCode: null,
              mopUkssShippingCarrier: null,
              mopCreatedBy: 'footykit',
              mopModifiedBy: 'footykit',
              mopDateAdded: new Date(),
              mopDateModified: new Date(),
            };

            // Handle quantity > 1 (create multiple records)
            const quantity = parseInt(productDetails.quantity || '1', 10);
            for (let i = 0; i < quantity; i++) {
              products.push({ ...baseProduct });
            }

            // Track our share for multi-seller apportionment.
            // Subtotal is discount-adjusted: gross (price x qty) minus the line's
            // discount allocations (Shopify puts discount-code amounts here, not in
            // total_discount). Shipping is apportioned by SHIPPABLE line-item count,
            // so non-shippable lines (e.g. memberships) carry no shipping.
            const lineDiscount = (productDetails.discount_allocations || []).reduce(
              (sum: number, alloc: any) => sum + parseFloat(alloc?.amount || '0'),
              0
            );
            ourLineItemCount++;
            ourSubtotal += productPrice * quantity - lineDiscount;
            if (productDetails.requires_shipping !== false) {
              ourShippableCount++;
            }
          }
        }

        // Multi-seller stores: an order with none of our products belongs entirely to
        // other sellers — skip it instead of creating an empty order header.
        if (isMultiSellerStore && ourLineItemCount === 0) {
          log.info(
            { orderId, storeName, totalLineItems: ordersDetails.line_items?.length || 0 },
            'No UKSS products in order (all other sellers) - skipping order'
          );
          continue;
        }

        // If any SKUs are missing, create the mo record but skip the missing-SKU products in mop.
        // Multi-seller stores skip this alert: missing SKUs there are other sellers' products, not errors.
        if (missingSKUs.length > 0 && !isMultiSellerStore) {
          log.error(
            { orderId, missingSKUs, storeName },
            'Some SKUs not found in new_products_variations table. Order header (mo) will be created; missing SKU products will be excluded from mop.'
          );

          await emailService.sendErrorNotification({
            subject: `${storeName} Order ${orderId} - Missing SKU(s)`,
            errorMessage: `Hi Team,<br><br>
              <b>${storeName}</b> Order <b>${orderId}</b> was partially processed. The following SKUs were not found in the new_products_variations table and were excluded from the order products:<br>
              <ul>${missingSKUs.map(sku => `<li>SKU: ${sku}</li>`).join('')}</ul><br>
              <b>Note:</b> The order header (mo table) has been created, but the above products are missing from the mop table.<br><br>
              <b>Module Name:</b> Marketplace Orders Utils<br>
              <b>File:</b> apps/api/src/lib/marketplace-orders/marketplace-orders-utils.ts<br>
              <b>Function:</b> createOrdersInUKSS<br><br>
              Please add these SKUs to the system.`,
            module: 'marketplace-orders-utils',
            context: { orderId, missingSKUs, storeName },
          });
          // Do not continue — fall through so the mo record is still created
        }
        // EOC: PM ID: #165208

        // Get currency conversion rate
        const currencyCode = ordersDetails.currency || 'USD';
        const currencyDetails = await getCurrencyDetails(currencyCode, log);
        const currencyConversionValue = currencyDetails?.conversionRate ?? 1;

        // Set financial information.
        // Shipping can span multiple shipping_lines (e.g. a 0.00 line + a real one),
        // so sum them all rather than reading only the first.
        const fullShipping = (ordersDetails.shipping_lines || []).reduce(
          (sum: number, line: any) => sum + parseFloat(line?.price || '0'),
          0
        );
        if (isMultiSellerStore) {
          // Apportion shipping across SHIPPABLE line items only: shipping x
          // (our shippable / total shippable). Non-shippable lines (memberships)
          // are excluded; when all shippable items are ours this yields full shipping.
          const totalShippableCount = (ordersDetails.line_items || []).filter(
            (li: any) => li?.requires_shipping !== false
          ).length;
          const apportionedShipping =
            totalShippableCount > 0
              ? Math.round(((fullShipping * ourShippableCount) / totalShippableCount) * 100) / 100
              : 0;
          orderData.moOrderSubtotal = Math.round(ourSubtotal * 100) / 100;
          orderData.moShippingTotal = apportionedShipping;
          orderData.moOrderTotal =
            Math.round((ourSubtotal + apportionedShipping) * 100) / 100;
        } else {
          orderData.moOrderSubtotal = parseFloat(
            ordersDetails.current_subtotal_price || '0'
          );
          orderData.moShippingTotal = fullShipping;
          orderData.moOrderTotal = parseFloat(
            ordersDetails.current_total_price || '0'
          );
        }
        orderData.moOrderCurrency = currencyCode;
        orderData.moUkssConversionRate = currencyConversionValue;
        orderData.moOrderShippingCountry =
          ordersDetails.shipping_address?.country || null;

        // Prepare status history
        // Convert orderId to string for moshMoOrderId (database expects varchar(255))
        const moshMoOrderId = String(orderId || '0');

        const statusHistory = {
          moshMoOrderId: moshMoOrderId,
          moshMoId: 0, // Will be updated after order header is saved
          moshMoOrderStatus: 'Pending',
          moshMuosmId: 1,
          moshCreatedBy: 'footykit',
          moshModifiedBy: 'footykit',
          moshDateAdded: new Date(),
          moshDateModified: new Date(),
        };

        // Store prepared data
        multiMarketPlaceData[orderId] = {
          MoMarketplaceOrder: orderData,
          MopMarketplaceOrderProduct: products,
          MoshMarketplaceOrderStatusHistory: statusHistory,
        };
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : 'Unknown error', orderId: ordersDetails.id },
          'Error preparing order data'
        );
        failed++;
      }
    }

    // Insert all orders into database
    if (Object.keys(multiMarketPlaceData).length > 0) {
      const insertResult = await insertMarketPlaceOrderDetails(
        multiMarketPlaceData,
        log
      );

      if (insertResult === 'Inserted Successfully') {
        processed = Object.keys(multiMarketPlaceData).length;
        log.info(
          { processed, storeName },
          'Orders created successfully in marketplace tables'
        );
      } else {
        failed = Object.keys(multiMarketPlaceData).length;
        log.error(
          { failed, storeName, error: insertResult },
          'Failed to insert orders'
        );
      }
    } else {
      log.info({ storeName }, 'No new orders to insert');
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', storeName }, 'Error in createOrdersInUKSS');
    failed = orders.length;
  }

  log.info(
    { processed, failed, total: orders.length, storeName },
    'Order processing completed'
  );

  return { processed, failed };
}
