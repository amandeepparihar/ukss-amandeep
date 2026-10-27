/**
 * Fruugo Order Data Processing Utilities
 * 
 * Converted from PHP function: prepare_fruugo_order_data_for_insertion()
 * 
 * This module processes Fruugo order XML feed files and inserts order data
 * into the marketplace orders database tables.
 */

import { createLogger, type Logger } from '../logger';
import { getStoreDetails } from '../store-management/store-management-utils';
import { getOrderStatus, insertMarketPlaceOrderDetails } from '../marketplace-orders/marketplace-orders-utils';
import { getCurrencyDetails, getCountryNameFromIsoCode } from '../helpers/common-utils';
import { getProductVariationDataFromSKU } from '../new-product-variations/new-product-variations-utils';
import { emailService } from '../email';
import { config } from '../../config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import type {
  FruugoOrdersXML,
  FruugoOrder,
  FruugoOrderLine,
  FruugoAttribute,
} from './fruugo.schema';

const defaultLogger = createLogger('fruugo-order-data-utils');

/**
 * Ensure directory exists, create if it doesn't
 */
async function ensureDirectoryExists(directory: string, logger?: Logger): Promise<void> {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o775 });
    if (logger) {
      logger.debug({ directory }, 'Created directory');
    }
  }
}

/**
 * Format date for zip file name (y_m_d_H_i_s format)
 */
function formatDateForZip(date: Date): string {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}_${month}_${day}_${hours}_${minutes}_${seconds}`;
}

/**
 * Archive existing XML feed files to zip
 */
async function archiveExistingFeedFiles(feedFileDirectory: string, logger?: Logger): Promise<void> {
  const log = logger || defaultLogger;

  try {
    // Check if archive directory exists
    const archiveDir = path.join(feedFileDirectory, 'Archive');
    await ensureDirectoryExists(archiveDir, log);

    // Create zip file name with timestamp (1 day ago format: y_m_d_H_i_s)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const zipFileName = `order_feed_${formatDateForZip(yesterday)}.zip`;
    const zipFilePath = path.join(archiveDir, zipFileName);

    // Find all XML files in feed directory
    const files = await fs.readdir(feedFileDirectory);
    const xmlFiles = files.filter(file => file.endsWith('.xml'));

    if (xmlFiles.length === 0) {
      log.info('No XML files to archive');
      return;
    }

    // Create zip archive
    return new Promise((resolve, reject) => {
      const output = createWriteStream(zipFilePath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      output.on('close', async () => {
        log.info({ zipFilePath, fileCount: xmlFiles.length }, 'Zip archive created successfully');

        // Delete XML files after archiving
        for (const xmlFile of xmlFiles) {
          const xmlFilePath = path.join(feedFileDirectory, xmlFile);
          try {
            await fs.unlink(xmlFilePath);
            log.debug({ xmlFile }, 'Deleted XML file after archiving');
          } catch (error) {
            log.error({ error, xmlFile }, 'Failed to delete XML file after archiving');
          }
        }

        resolve();
      });

      archive.on('error', (error) => {
        log.error({ error }, 'Failed to create zip archive');
        reject(error);
      });

      archive.pipe(output);

      // Add XML files to archive
      for (const xmlFile of xmlFiles) {
        const xmlFilePath = path.join(feedFileDirectory, xmlFile);
        archive.file(xmlFilePath, { name: xmlFile });
      }

      archive.finalize();
    });
  } catch (error) {
    log.error({ error }, 'Failed to archive existing feed files');
    throw error;
  }
}

/**
 * Parse XML file and convert to JavaScript object
 * Similar to PHP's XmlToArrayComponent->xml2array()
 */
function parseXMLToObject(xmlContent: string): FruugoOrdersXML | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      // Keep element text as strings. Every Fruugo field written to the DB lands in a
      // VarChar column; when the parser coerced numeric-looking text to a JS number
      // (e.g. <o:city>1300</o:city> -> 1300), Prisma rejected the insert with
      // "Expected String or Null, provided Int" and the whole order was lost.
      // Numeric fields that need arithmetic (price/vat/quantity) are already wrapped in
      // parseFloat/parseInt, so they are unaffected. PM #166196 (province) was the same
      // bug patched per-field; this fixes the class at the source. Order 235596112001004571.
      parseTagValue: false,
      trimValues: true,
    });

    const parsed = parser.parse(xmlContent) as any;

    // Basic validation: Check if the structure looks correct
    if (!parsed?.['o:orders'] || !parsed['o:orders']['o:order']) {
      defaultLogger.error('XML structure invalid: missing o:orders or o:order');
      return null;
    }

    // Normalize o:order to always be an array (like PHP code does)
    const ordersData = parsed['o:orders']['o:order'];
    if (!Array.isArray(ordersData)) {
      parsed['o:orders']['o:order'] = [ordersData];
    }

    return parsed as FruugoOrdersXML;
  } catch (error) {
    defaultLogger.error({ error }, 'Failed to parse XML');
    return null;
  }
}

/**
 * Normalize order lines to always be an array
 */
function normalizeOrderLines(orderLines: FruugoOrderLine | FruugoOrderLine[]): FruugoOrderLine[] {
  if (Array.isArray(orderLines)) {
    return orderLines;
  }
  return [orderLines];
}

/**
 * Normalize attributes to always be an array
 */
function normalizeAttributes(attributes?: FruugoAttribute | FruugoAttribute[]): FruugoAttribute[] {
  if (!attributes) {
    return [];
  }
  if (Array.isArray(attributes)) {
    return attributes;
  }
  return [attributes];
}

/**
 * Prepare Fruugo order data for insertion into database
 * 
 * Converted from PHP function: prepare_fruugo_order_data_for_insertion()
 * 
 * This function:
 * 1. Reads the Fruugo order XML feed file
 * 2. Parses the XML data
 * 3. Processes each order and prepares data for database insertion
 * 4. Inserts orders into marketplace_orders, marketplace_order_products, and marketplace_order_status_history tables
 * 5. Archives the XML file after successful processing
 */
export async function prepareFruugoOrderDataForInsertion(logger?: Logger): Promise<void> {
  const log = logger || defaultLogger;

  // Activity log: Job Initiated
  log.info({ function: 'prepareFruugoOrderDataForInsertion' }, '# Job Initiated.');
  log.info({ function: 'prepareFruugoOrderDataForInsertion' }, '#Start: prepareFruugoOrderDataForInsertion Function');

  try {
    const catalogDirectory = config.DIR_FS_CATALOG ?? '';
    // Get Fruugo directory path
    const fruugoDirectory = catalogDirectory + config.DIR_FS_FRUUGO;
    if (!fruugoDirectory) {
      throw new Error('DIR_FS_FRUUGO is not configured. Please set the DIR_FS_FRUUGO environment variable.');
    }

    // Resolve directory path
    const projectRoot = process.cwd();
    let resolvedDirectory: string;

    const normalizedDirectory = fruugoDirectory.trim().replace(/['"]/g, '').replace(/\/$/, '');

    if (path.isAbsolute(normalizedDirectory)) {
      if (normalizedDirectory.startsWith('/') && !normalizedDirectory.startsWith(projectRoot)) {
        const relativePath = normalizedDirectory.substring(1);
        resolvedDirectory = path.resolve(projectRoot, relativePath);
      } else {
        resolvedDirectory = path.normalize(normalizedDirectory);
      }
    } else {
      resolvedDirectory = path.resolve(projectRoot, normalizedDirectory);
    }

    // XML file path
    const xmlFilePath = path.join(resolvedDirectory, 'fruugo_orders_feed.xml');

    // Check if file exists
    try {
      await fs.access(xmlFilePath);
    } catch {
      log.error({ xmlFilePath }, '# ERROR: The order feed file is missing.');
      await emailService.sendErrorNotification({
        subject: 'Error: Fruugo Order Feed Not Found',
        errorMessage: `Hi Team,<br>Please check the order mentioned below:<br><b>Module Name:</b> Marketplace Order Controller <br><b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Possible reasons for error:</b>The fruugo order feed not found.<br><b>Possible Fix:</b> check the fruugo order feed on the server.`,
        module: 'fruugo-order-data-utils',
      });
      return;
    }

    log.info({ xmlFilePath }, '# The order feed is present. Reading the order feed.');

    // Read XML file
    const xmlContent = await fs.readFile(xmlFilePath, 'utf-8');

    // Parse XML to object
    const xmlDataArray = parseXMLToObject(xmlContent);

    if (!xmlDataArray) {
      log.error('# ERROR: Failed to parse XML file.');
      await emailService.sendErrorNotification({
        subject: 'Error: Fruugo Order Feed Format Incorrect',
        errorMessage: `Hi Team,<br>Please check the order mentioned below:<br><b>Module Name:</b> Marketplace Order Controller <br><b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Possible reasons for error:</b>The fruugo order feed having incorrect format.<br><b>Possible Fix:</b> check the fruugo order feed on the server.`,
        module: 'fruugo-order-data-utils',
      });
      return;
    }

    log.debug({ xmlData: JSON.stringify(xmlDataArray) }, '# The order feed data array:');

    // Get store details
    const marketPlaceName = 'Fruugo';
    const storeDetails = await getStoreDetails(marketPlaceName, log);

    if (!storeDetails) {
      log.error({ marketPlaceName }, 'Store not found in store_management table');
      await emailService.sendErrorNotification({
        subject: 'Error: Fruugo Store Not Found',
        errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Marketplace Order Controller <br><b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Error:</b> Store not found in store_management table.`,
        module: 'fruugo-order-data-utils',
      });
      return;
    }

    const moStoreId = storeDetails.storeId;

    // Array to store the data for marketplace_orders, marketplace_order_products and marketplace_order_status_history tables
    const multiMarketPlaceData: Record<
      string,
      {
        MoMarketplaceOrder: any;
        MopMarketplaceOrderProduct: any[];
        MoshMarketplaceOrderStatusHistory: any;
      }
    > = {};

    // Check if orders exist in XML
    if (!xmlDataArray['o:orders'] || !xmlDataArray['o:orders']['o:order']) {
      log.error('# ERROR: The order feed is having incorrect format.');
      await emailService.sendErrorNotification({
        subject: 'Error: Fruugo Order Feed Format Incorrect',
        errorMessage: `Hi Team,<br>Please check the order mentioned below:<br><b>Module Name:</b> Marketplace Order Controller <br><b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Possible reasons for error:</b>The fruugo order feed having incorrect format.<br><b>Possible Fix:</b> check the fruugo order feed on the server.`,
        module: 'fruugo-order-data-utils',
      });
      return;
    }

    // Get orders (schema guarantees it's always an array after preprocessing)
    const orders: FruugoOrder[] = xmlDataArray['o:orders']['o:order'];

    log.info({ orderCount: orders.length }, 'Processing orders from XML feed');

    // Track successful and skipped orders for mixed order scenario
    const successfulOrders: string[] = [];
    const skippedOrders: { orderId: string; missingSKUs: string[] }[] = [];

    // Process each order
    for (const ordersDetails of orders) {
      try {
        const orderId = ordersDetails['o:orderId'];

        // Check if order already exists
        const status = await getOrderStatus(orderId, moStoreId, log);

        // If order doesn't exist (status == 0), prepare data for insertion
        if (status === 0) {
          // Normalize order lines
          const orderLines = normalizeOrderLines(ordersDetails['o:orderLines']['o:orderLine']);

          // Prepare order header data
          const shippingAddress = ordersDetails['o:shippingAddress'];
          const addressLine1 = shippingAddress['o:streetAddress'] || null;
          const addressLine2 = null; // Not in XML structure
          const addressLine3 = null; // Not in XML structure

          const moMarketplaceOrder: any = {
            moStoreName: marketPlaceName,
            moStoreId: moStoreId,
            moOrderId: orderId,
            moOrderPlaceDate: new Date(ordersDetails['o:orderDate']),
            moOrderUpdateDate: new Date(ordersDetails['o:orderReleaseDate']),
            moOrderShipByDate: null,
            moOrderStatus: ordersDetails['o:orderStatus'],
            moOrderCustomerId: String(ordersDetails['o:customerOrderId']),
            moOrderCustomerEmail: null,
            moOrderShippingMethod: 'Standard Shipping',
            moOrderShippingLine1: addressLine1,
            moOrderShippingLine2: addressLine2,
            moOrderShippingLine3: addressLine3,
            moOrderCustomerName: `${shippingAddress['o:firstName']} ${shippingAddress['o:lastName']}`,
            moCustomerPhone: String(shippingAddress['o:phoneNumber'] || null),
            moOrderShippingCity: shippingAddress['o:city'],
            moOrderShippingState: shippingAddress['o:province'] ? String(shippingAddress['o:province']) : null,
            moOrderShippingZipcode: String(shippingAddress['o:postalCode']),
            moUkssOrderId: null,
            moCreatedBy: 'Get Fruugo Orders',
            moModifiedBy: 'Get Fruugo Orders',
            moDateAdded: new Date(),
            moDateModified: new Date(),
          };

          // Prepare product data
          const products: any[] = [];
          const missingSKUs: string[] = []; // Track missing SKUs
          let marketPlaceOrderSubtotal = 0;
          let currencyCode = '';

          for (const orderLine of orderLines) {
            const totalNumberOfItems = parseInt(orderLine['o:totalNumberOfItems'] || '1', 10);
            currencyCode = orderLine['o:currencyCode'];

            // Create one entry per item (quantity = 1 for each)
            for (let i = 0; i < totalNumberOfItems; i++) {
              // Add to subtotal (using itemPriceInclVat, not totalPriceInclVat)
              marketPlaceOrderSubtotal += parseFloat(orderLine['o:itemPriceInclVat'] || '0');

              // Normalize attributes
              const attributes = normalizeAttributes(orderLine['o:attributes']?.['o:attribute']);
              const attributeName = attributes.length >= 2
                ? `${attributes[0]['o:attributeValue']}_${attributes[1]['o:attributeValue']}`
                : attributes.length === 1
                  ? attributes[0]['o:attributeValue']
                  : null;

              // Get product variation data from SKU
              const skuId = orderLine['o:skuId'];
              const productDetails = await getProductVariationDataFromSKU(skuId, log);

              if (!productDetails || !productDetails.npvProductsId) {
                log.error(
                  { orderId, skuId },
                  '# Job failed to fetch the SKU of the fruugo order id'
                );
                log.error(
                  { orderId, skuId },
                  '# The System could not get the order product details for fruugo order id. Please check the issue with this order.'
                );

                // Track missing SKU - avoid duplicates
                if (!missingSKUs.includes(skuId)) {
                  missingSKUs.push(skuId);
                }
                continue; // Skip this product
              }

              const product: any = {
                mopStoreName: marketPlaceName,
                mopOrderId: orderId,
                mopMoId: BigInt(0), // Will be updated after order header is saved
                mopProductId: String(orderLine['o:fruugoProductId']),
                mopProductSku: String(orderLine['o:fruugoSkuId']),
                mopProductStatus: null,
                mopProductName: String(orderLine['o:skuName']),
                mopProductUpcEan: null,
                mopProductPrice: parseFloat(orderLine['o:itemPriceInclVat'] || '0'),
                mopProductVatAmount: parseFloat(orderLine['o:itemVat'] || '0'),
                mopProductVatIncluded: '1', // In Fruugo, VAT is included in the price
                mopProductQuantity: 1, // One entry per item
                mopProductAttributeName: attributeName,
                mopUkssProductSku: skuId,
                mopUkssProductId: String(productDetails.npvProductsId),
                mopUkssProductConfirmationStatus: null,
                mopUkssProductShippingStatus: null,
                mopUkssProductCancelReason: null,
                mopUkssProductReturnReason: null,
                mopUkssTrackingCode: null,
                mopUkssShippingCarrier: null,
                mopCreatedBy: 'Get Fruugo Orders',
                mopModifiedBy: 'Get Fruugo Orders',
                mopDateAdded: new Date(),
                mopDateModified: new Date(),
              };

              products.push(product);
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
          const currencyDetails = await getCurrencyDetails(currencyCode, log);
          const currencyConversionValue = currencyDetails?.conversionRate || 1;

          // Get country name from ISO code
          const countryIsoCode = shippingAddress['o:countryCode'];
          const countryName = await getCountryNameFromIsoCode(countryIsoCode, log);

          // Update order with currency and country info
          moMarketplaceOrder.moOrderShippingCountry = countryName;
          moMarketplaceOrder.moUkssConversionRate = currencyConversionValue;
          moMarketplaceOrder.moOrderCurrency = currencyCode;
          moMarketplaceOrder.moOrderSubtotal = marketPlaceOrderSubtotal;
          moMarketplaceOrder.moShippingTotal = parseFloat(ordersDetails['o:shippingCostInclVAT'] || '0');
          moMarketplaceOrder.moOrderTotal = moMarketplaceOrder.moShippingTotal + marketPlaceOrderSubtotal;

          // Prepare status history
          const statusHistory: any = {
            moshMoOrderId: orderId,
            moshMoId: BigInt(0), // Will be updated after order header is saved
            moshMoOrderStatus: 'PENDING',
            moshMuosmId: 1,
            moshCreatedBy: 'footykit',
            moshModifiedBy: 'footykit',
            moshDateAdded: new Date(),
            moshDateModified: new Date(),
          };

          // Store prepared data
          multiMarketPlaceData[orderId] = {
            MoMarketplaceOrder: moMarketplaceOrder,
            MopMarketplaceOrderProduct: products,
            MoshMarketplaceOrderStatusHistory: statusHistory,
          };

          // Track successful order
          successfulOrders.push(orderId);
        } else {
          log.warn({ orderId }, 'Duplicate Entry Found For Fruugo Order ID');
        }
      } catch (error) {
        log.error({ error, orderId: ordersDetails['o:orderId'] }, 'Error processing order');
      }
    }

    // Insert orders into database
    if (Object.keys(multiMarketPlaceData).length > 0) {
      const status = await insertMarketPlaceOrderDetails(multiMarketPlaceData, log);

      if (status === 'Inserted Successfully' || status === 'No New Order Found' || status === 'Partially Inserted') {
        // Archive existing XML files (even for partial success, some orders were inserted)
        await archiveExistingFeedFiles(resolvedDirectory, log);

        if (status === 'Inserted Successfully') {
          log.info('# Job completed Successfully.');
          log.info('# Successfully Inserted Orders.');
        } else if (status === 'Partially Inserted') {
          log.warn('# Job completed with partial success. Some orders were inserted, some failed during database insertion.');
          log.warn('# Check email notification for details on failed orders.');
        } else {
          log.info('# Job completed Successfully(No Order found to insert).');
          log.info('# No Order found to insert.');
        }

        // Check for orders with missing SKUs (orders were still created but some products were skipped)
        if (skippedOrders.length > 0) {
          log.warn(
            { successfulOrders, skippedOrders },
            '# Some orders were created with missing product SKUs.'
          );

          // Build skipped orders details for email
          const skippedOrdersDetails = skippedOrders
            .map(
              (order) =>
                `<tr><td style="padding: 8px; border: 1px solid #ddd;">${order.orderId}</td><td style="padding: 8px; border: 1px solid #ddd;">${order.missingSKUs.join(', ')}</td></tr>`
            )
            .join('');

          const wikiLink = process.env.FRUUGO_ORDER_FETCH_ISSUE_WIKI_LINK || 'https://pm.veldev.com/projects/ab_testing_sitf/wiki/Fruugo_-_Order_Fetch_Issue';

          await emailService.sendErrorNotification({
            subject: `Action Required: Fruugo Orders Created With Missing SKUs`,
            errorMessage: `Hi Team,<br><br>
              <b style="color: #d9534f;">IMPORTANT: Some Fruugo orders were created but have products with missing SKUs that were skipped.</b><br><br>
              <b>Module Name:</b> Marketplace Order Controller<br>
              <b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br>
              <b>Marketplace:</b> FRUUGO<br><br>

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
                <li><b>Open the wiki link: <a href="${wikiLink}" target="_blank">Fruugo - Order Fetch Issue</a></b> for more information on how to add the missing SKUs.</li>
                <li><b>Check the orders above</b> - they were created without the missing products.</li>
              </ol>`,
            module: 'fruugo-order-data-utils',
            context: { successfulOrders, skippedOrders },
          });
        }
      } else {
        // refs: #166192 - Do not send a second, generic "Fruugo Order not inserted"
        // email here. insertMarketPlaceOrderDetails already emails a detailed
        // per-order failure alert (order IDs + errors), so re-emailing on a
        // failure status is redundant noise. Just log the returned status.
        log.error({ status }, '# Job Failed to insert data into marketplace related tables.');
        log.error('# The order insertion in the marketplace orders table is failed.');
      }
    } else {
      // No orders to insert - check if all orders were skipped due to missing SKUs
      if (skippedOrders.length > 0) {
        log.warn(
          { skippedOrders },
          '# Orders had missing SKUs but no new orders to insert (all may have been duplicates).'
        );
      } else {
        log.info('No new orders to insert');
      }
    }
  } catch (error) {
    log.error({ error }, 'Error in prepareFruugoOrderDataForInsertion');
    await emailService.sendErrorNotification({
      subject: 'Error: Fruugo Order Processing Failed',
      errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Marketplace Order Controller <br><b>File:</b> apps/api/src/lib/fruugo/fruugo-order-data.utils.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`,
      module: 'fruugo-order-data-utils',
    });
    throw error;
  }
}
