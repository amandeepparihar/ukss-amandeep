/**
 * Auto-Process Order Products for Warehouse Queue
 *
 * Ported from PHP: app/models/pre_processed_order_product.php → AutoProcessAmazonOrders()
 *
 * After a marketplace order is created in the UKSS orders tables, this function
 * checks if all products are in stock and, if so, inserts them into
 * `pre_processed_order_products` to queue the order for warehouse processing.
 *
 * Not yet ported from PHP:
 * - save_designers_commission_in_order_products() — designer commission tracking per product
 *   (PHP line 120 in pre_processed_order_product.php). Requires separate implementation.
 * - Auto-pick stock deduction (PHP lines 358-559) — only runs when store_management.auto_pick = 'yes'.
 *   This is a stock-picking operation, separate from the pre_processed queue insertion.
 *
 * Called by processMarketplaceOrdersToUKSS() after the order transaction completes.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import {
  resolveSmsSize,
  resolveProductCode,
  checkSmsStock,
  checkParentStock,
  isTshirtCategory2214,
} from '../../modules/orders/processing/processing.stock';
import { TOFFS_TYPE_MANUFACTURER_ID_LIST, TOFFS_STORE_IDS } from '../../modules/orders/orders.constants';

const defaultLogger = createLogger('auto-process-order-products');

interface OrderProductRow {
  orders_products_id: number;
  products_id: number;
  products_model: string;
  products_price: number;
  products_quantity: number;
  // Toffs detection (PMS #165061): products.toffs + products.manufacturers_id + orders.order_site
  toffs: string | null;
  manufacturers_id: number | null;
  order_site: number | null;
}

/**
 * Is this order line a Toffs (retro, supplier-sourced) product?
 * Mirrors legacy order_processing_new.php:736-738 detection:
 *   products.toffs != ''  OR  (order_site IN 143,146 AND manufacturers_id IN TOFFS_TYPE_MANUFACTURER_MAPPING).
 * Toffs are supplier-sourced, so they must be force-enqueued regardless of SMS stock (PMS #165061):
 * the order-processing cron then routes no-stock toffs to status 2 -> supplier assignment.
 */
export function isToffsLine(product: {
  toffs?: string | null;
  manufacturers_id?: number | null;
  order_site?: number | null;
}): boolean {
  if (product.toffs != null && product.toffs.trim() !== '') return true;
  return (
    product.order_site != null &&
    TOFFS_STORE_IDS.includes(Number(product.order_site)) &&
    product.manufacturers_id != null &&
    TOFFS_TYPE_MANUFACTURER_ID_LIST.includes(Number(product.manufacturers_id))
  );
}

/**
 * Decide whether a single order line counts as in-stock for PPOP queueing.
 *
 * Mirrors the override chain in legacy PHP pre_processed_order.php:
 *   1. Direct SMS stock check (happy path).
 *   2. Hero-shirt parent fallback (PHP lines 289-324) — when the child
 *      variant has no stock but its parent does.
 *   3. T-shirt category #2214# override (PHP lines 326-335) — force-queue
 *      the line so the cron's downstream logic can sort it out.
 */
async function isLineInStockForPPOP(
  product: OrderProductRow,
  log: Logger,
): Promise<boolean> {
  // Toffs are supplier-sourced — force-enqueue regardless of SMS stock so the order-processing
  // run routes no-stock toffs to status 2 -> supplier (legacy retro branch pre_processed_order.php
  // :135-137; engine detection order_processing_new.php:736-738; PMS #165061). Checked first, so
  // it short-circuits the stock resolution entirely (matches legacy skipping the stock-check block).
  if (isToffsLine(product)) {
    log.debug(
      { ordersProductsId: product.orders_products_id, productsId: product.products_id },
      'Toffs product force-queued (supplier-sourced)',
    );
    return true;
  }

  const sizeResolution = await resolveSmsSize(product.orders_products_id, null);
  if (!sizeResolution) {
    log.debug(
      { ordersProductsId: product.orders_products_id, productsId: product.products_id },
      'No size attribute found; falling back to T-shirt category override',
    );
    return await isTshirtCategory2214(product.products_id);
  }

  const productCode = await resolveProductCode(product.products_model, sizeResolution.sizeId);
  if (!productCode) {
    log.debug(
      { productsModel: product.products_model, productsId: product.products_id },
      'Product code not resolved; falling back to T-shirt category override',
    );
    return await isTshirtCategory2214(product.products_id);
  }

  const qty = product.products_quantity || 1;

  const stock = await checkSmsStock(productCode.productListsId, sizeResolution.sizeId, qty);
  if (stock.available) return true;

  if (productCode.parentProductListsId && productCode.parentProductListsId !== 0) {
    const parentStock = await checkParentStock(
      productCode.parentProductListsId,
      sizeResolution.sizeId,
      qty,
      null,
    );
    if (parentStock) {
      log.debug(
        {
          productsModel: product.products_model,
          parentProductListsId: productCode.parentProductListsId,
        },
        'Stock satisfied via hero-shirt parent fallback',
      );
      return true;
    }
  }

  if (await isTshirtCategory2214(product.products_id)) {
    log.debug(
      { productsId: product.products_id, productsModel: product.products_model },
      'Out-of-stock T-shirt force-queued via category #2214# override',
    );
    return true;
  }

  log.debug(
    {
      productsModel: product.products_model,
      sizeId: sizeResolution.sizeId,
      availableQty: stock.quantity,
    },
    'Product not in stock and no override applies',
  );
  return false;
}

/**
 * Auto-process marketplace order products into the warehouse queue.
 *
 * Logic (matching PHP AutoProcessAmazonOrders lines 581-598):
 * 1. Fetch all order products
 * 2. For each product, resolve size → product code → check stock
 * 3. If all products are in stock and no pre-existing rows, insert into pre_processed_order_products
 *
 * Note: The PHP `auto_pick` check (store_management.auto_pick) gates the stock-picking
 * flow (lines 358-559), NOT the pre_processed insert (lines 581-598). The insert
 * happens regardless of auto_pick value, so we don't check it here.
 *
 * @param orderId - UKSS order ID
 */
export async function autoProcessOrderProducts(
  orderId: number,
  logger?: Logger
): Promise<void> {
  const log = logger || defaultLogger;

  if (!orderId) {
    log.warn('No orderId provided, skipping auto-process');
    return;
  }

  // Fetch order products
  const orderProducts = await prisma.$queryRaw<OrderProductRow[]>(
    Prisma.sql`
      SELECT op.orders_products_id, op.products_id, op.products_model, op.products_price, op.products_quantity,
             p.toffs, p.manufacturers_id, o.order_site
      FROM orders_products op
      LEFT JOIN products p ON op.products_id = p.products_id
      LEFT JOIN orders o ON op.orders_id = o.orders_id
      WHERE op.orders_id = ${orderId}
    `
  );

  if (orderProducts.length === 0) {
    log.warn({ orderId }, 'No order products found, skipping auto-process');
    return;
  }

  // Check if already pre-processed (PHP: PreProcessedOrderProduct::find('count'))
  const existingRows = await prisma.$queryRaw<Array<{ cnt: number }>>(
    Prisma.sql`SELECT COUNT(*) AS cnt FROM pre_processed_order_products WHERE orders_id = ${orderId}`
  );
  if (Number(existingRows[0]?.cnt ?? 0) > 0) {
    log.debug({ orderId }, 'Order already has pre_processed rows, skipping');
    return;
  }

  // Check stock for each product, applying the PHP override chain per line.
  // We do not break early: continue iterating so debug logs cover every line.
  let allInStock = true;

  for (const product of orderProducts) {
    const lineInStock = await isLineInStockForPPOP(product, log);
    if (!lineInStock) {
      allInStock = false;
    }
  }

  // PHP inserts into pre_processed_order_products when in_stock = 0
  // (confusing PHP naming: $in_stock starts at 0, gets set to 1 on failure)
  // in_stock=0 means all in stock → insert. in_stock=1 means some out of stock → skip.
  if (!allInStock) {
    log.info({ orderId }, 'Not all products in stock, skipping pre-process insertion');
    return;
  }

  // Insert one row per product into pre_processed_order_products
  for (const product of orderProducts) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO pre_processed_order_products
          (orders_id, orders_products_id, order_products_id, status,
           process_archive, to_be_printed, sift_score_bit, date_added, date_modified)
        VALUES (${orderId}, ${product.orders_products_id}, ${product.products_id}, 0,
                0, 0, '0', NOW(), NOW())
      `
    );
  }

  log.info({ orderId, productCount: orderProducts.length }, 'Order products auto-processed into warehouse queue');
}
