/**
 * Backorder management service — handles backorder toggle with all validations.
 * Requirements: REQ-06-014 through REQ-06-020
 *
 * Ported from orders.php lines 4730-4994 (updateBackOrder block).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { UKRS_SITE_ID, TEAMZO_SITE_ID, FRUUGO_SITE_ID } from '../orders.constants';
import { hasFcOrder } from '../orders.helpers';
import { invokeJitUnmark } from './product-actions.service';
import type {
  BoxPickCheckRow, MysteryCheckRow,
  AdminNameRow, ProductPriceRow, OrderSiteRow,
} from './product-actions.types';

const logger = createLogger('product-actions-backorder');

/** External endpoints for backorder notification (REQ-06-019) */
const URL_UKRS = 'https://www.ukrugbyshop.com/index.php?main_page=ukss_return_contact_update';
const URL_TEAMZO = 'https://www.teamzo.com/index.php?main_page=ukss_return_contact_update';

interface BackorderResult {
  status: 'success' | 'error';
  message: string;
}

/**
 * REQ-06-014 through REQ-06-020: Toggle backorder with all validations.
 * Supports bulk operations via underscore-separated product IDs.
 */
export async function toggleBackorder(
  orderId: number,
  orderProductIdStr: string,
  backorder: 'Yes' | 'No',
  adminId: number,
): Promise<BackorderResult> {
  const productIds = orderProductIdStr.split('_').map(id => parseInt(id, 10));

  // REQ-06-015: Check FC order exists for all products
  if (await hasFcOrder(productIds)) {
    return {
      status: 'error',
      message: 'Order Already created on FC. Cannot mark/unmark as Onbackorder.',
    };
  }

  // REQ-06-016: Check no box number already assigned
  // PHP runs this unconditionally (both Yes and No directions)
  const boxRows = await prisma.$queryRaw<BoxPickCheckRow[]>(Prisma.sql`
    SELECT orders_products_id, box_number FROM orders_products
    WHERE orders_products_id IN (${Prisma.join(productIds)})
      AND box_number IS NOT NULL AND box_number != ''
  `);
  if (boxRows.length > 0) {
    return {
      status: 'error',
      message: "Order product has already been picked from the box and cannot be marked as 'Backorder'.",
    };
  }

  // Get admin name for logging (REQ-06-018)
  const adminRows = await prisma.$queryRaw<AdminNameRow[]>(Prisma.sql`
    SELECT admin_name FROM admin WHERE admin_id = ${adminId}
  `);
  const adminName = adminRows.length > 0 ? (adminRows[0].admin_name ?? 'Unknown') : 'Unknown';

  // Get order site for multi-site notifications (REQ-06-019, REQ-06-020)
  const siteRows = await prisma.$queryRaw<OrderSiteRow[]>(Prisma.sql`
    SELECT order_site FROM orders WHERE orders_id = ${orderId}
  `);
  const orderSite = siteRows.length > 0 ? siteRows[0].order_site : null;

  // Process each product
  for (const productId of productIds) {
    try {
      await processBackorderProduct(orderId, productId, backorder, adminName, orderSite);
    } catch (err) {
      logger.error({ err, orderId, productId, backorder }, 'Backorder update failed for product');
    }
  }

  logger.info({ orderId, productIds, backorder, adminName }, 'Backorder toggled');

  return {
    status: 'success',
    message: backorder === 'Yes' ? 'Marked as backorder' : 'Removed from backorder',
  };
}

/**
 * Process a single product for backorder toggle.
 * Handles mystery detection, DB update, history logging, notifications.
 */
async function processBackorderProduct(
  orderId: number,
  productId: number,
  backorder: 'Yes' | 'No',
  adminName: string,
  orderSite: number | null,
): Promise<void> {
  // REQ-06-017: Mystery product detection
  let isMystery = false;
  if (backorder === 'Yes') {
    isMystery = await checkMysteryProduct(productId);
  }

  // Fetch price data once (used by both logging and Fruugo update)
  const priceRows = await prisma.$queryRaw<ProductPriceRow[]>(Prisma.sql`
    SELECT final_price, fruugo_id FROM orders_products WHERE orders_products_id = ${productId}
  `);
  const priceData = priceRows.length > 0 ? priceRows[0] : { final_price: 0, fruugo_id: null };

  // REQ-06-014: Update backorder status + box fields
  if (backorder === 'Yes') {
    // Mystery flag only set on 'Yes' direction; two queries kept separate for clarity
    if (isMystery) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE orders_products
        SET backorder = 'Yes', is_mystery = 'yes',
            box1 = 'backorder', box2 = 'backorder', box3 = 'backorder'
        WHERE orders_products_id = ${productId} AND orders_id = ${orderId}
      `);
    } else {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE orders_products
        SET backorder = 'Yes',
            box1 = 'backorder', box2 = 'backorder', box3 = 'backorder'
        WHERE orders_products_id = ${productId} AND orders_id = ${orderId}
      `);
    }
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products
      SET backorder = 'No', box1 = '', box2 = '', box3 = ''
      WHERE orders_products_id = ${productId} AND orders_id = ${orderId}
    `);
  }

  // PMS #165637: clear JIT on backorder='Yes' (guarded; mirrors invoke_jit_unmark_via_action).
  // Prevents backordered+JIT lines leaking into the JIT FC bucket. Position matches legacy
  // orders.php:5181-5185 (after the backorder UPDATE, before history logging).
  if (backorder === 'Yes') {
    await invokeJitUnmark(productId);
  }

  // REQ-06-018: Backorder history logging
  await logBackorderHistory(orderId, productId, backorder, adminName, priceData);

  // REQ-06-019: Multi-site notification (fire-and-forget)
  if (orderSite === UKRS_SITE_ID || orderSite === TEAMZO_SITE_ID) {
    notifyMultiSite(orderId, productId, backorder, orderSite).catch(err => {
      logger.warn({ err, orderId, productId, orderSite }, 'Multi-site backorder notification failed');
    });
  }

  // REQ-06-020: Fruugo cancel reason update
  if (orderSite === FRUUGO_SITE_ID) {
    await updateFruugoCancelReason(productId, backorder, priceData.fruugo_id);
  }
}

/**
 * REQ-06-017: Check if a product belongs to the mystery product category.
 * Collects master_categories_id and products_to_categories, checks against MYSTERY_PRODUCT_CATEGORY.
 */
async function checkMysteryProduct(orderProductId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<MysteryCheckRow[]>(Prisma.sql`
    SELECT np.master_categories_id, np.products_to_categories
    FROM orders_products op
    INNER JOIN new_products np ON op.products_id = np.products_id
    WHERE op.orders_products_id = ${orderProductId}
  `);

  if (rows.length === 0) return false;

  // Load MYSTERY_PRODUCT_CATEGORY from DB config at runtime
  const configRows = await prisma.$queryRaw<Array<{ configuration_value: string }>>(Prisma.sql`
    SELECT configuration_value FROM configuration
    WHERE configuration_key = 'MYSTERY_PRODUCT_CATEGORY'
    LIMIT 1
  `);
  if (configRows.length === 0) return false;

  const mysteryCategory = parseInt(configRows[0].configuration_value, 10);
  if (isNaN(mysteryCategory)) return false;

  const { master_categories_id, products_to_categories } = rows[0];

  // Collect all category IDs
  const categoryIds: number[] = [];
  if (master_categories_id != null) categoryIds.push(master_categories_id);
  if (products_to_categories) {
    // Format: "1#,2#,3#" or "1,2,3" — parse both
    const parts = products_to_categories.split(',').map(s => s.replace(/#/g, '').trim());
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (!isNaN(num)) categoryIds.push(num);
    }
  }

  return categoryIds.includes(mysteryCategory);
}

/**
 * REQ-06-018: Log backorder change to backorders_products table.
 */
async function logBackorderHistory(
  orderId: number,
  productId: number,
  backorder: 'Yes' | 'No',
  adminName: string,
  priceData: ProductPriceRow,
): Promise<void> {
  const finalPrice = priceData.final_price ?? 0;

  const comment = backorder === 'Yes' ? 'On Backorder' : 'Removed from Backorder';
  const refundVal = backorder === 'Yes' ? '1' : '';

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO backorders_products
      (orders_id, orders_products_id, user, backorder, comment, price, ship_status, refund)
    VALUES
      (${orderId}, ${productId}, ${adminName}, ${backorder}, ${comment}, ${finalPrice}, '0', ${refundVal})
  `);
}

/**
 * REQ-06-019: Notify UKRS or Teamzo about backorder status change via HTTP POST.
 */
async function notifyMultiSite(
  orderId: number,
  productId: number,
  backorder: 'Yes' | 'No',
  orderSite: number,
): Promise<void> {
  const url = orderSite === UKRS_SITE_ID ? URL_UKRS : URL_TEAMZO;

  const body = new URLSearchParams({
    ukss_orders_id: String(orderId),
    ukss_orders_products_id: String(productId),
    backorder,
    action: 'backorder_update',
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    logger.info(
      { orderId, productId, orderSite, httpStatus: response.status },
      'Multi-site backorder notification sent',
    );
  } catch (err) {
    logger.warn({ err, orderId, productId, orderSite }, 'Multi-site notification failed (fire-and-forget)');
  }
}

/**
 * REQ-06-020: Update Fruugo cancel reason when backorder changes.
 */
async function updateFruugoCancelReason(
  productId: number,
  backorder: 'Yes' | 'No',
  fruugoId: string | null,
): Promise<void> {
  if (!fruugoId) return;

  const cancelReason = backorder === 'Yes' ? 'out_of_stock' : '';
  await prisma.$executeRaw(Prisma.sql`
    UPDATE fruugo_orders SET cancel_reason = ${cancelReason}
    WHERE id = ${fruugoId}
  `);

  logger.info({ productId, fruugoId, cancelReason }, 'Fruugo cancel reason updated');
}
