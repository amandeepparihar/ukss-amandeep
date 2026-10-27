/**
 * Marketplace status propagation — after-commit operations for syncing
 * order status changes to marketplace-specific tables.
 *
 * Requirements: REQ-07-013 (marketplace propagation)
 * Extracted from status.helpers.ts for file-size compliance.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../lib/logger';
import { STATUS, PRE_ORDER_INSERT_STATUSES } from '../orders.constants';
import type {
  AmazonOrderRow,
  FruugoConfirmationRow,
  DhlTrackingRow,
  OrderProductTrackingRow,
} from './status.types';

const logger = createLogger('orders-status-marketplace');

// ---------------------------------------------------------------------------
// Marketplace Status Propagation (REQ-07-013)
// After-commit operations — failures logged, not rolled back
// ---------------------------------------------------------------------------

/**
 * REQ-07-013: Propagate status change to marketplace tables.
 * Runs AFTER the main transaction commits.
 */
export async function propagateMarketplaceStatus(
  prisma: PrismaClient,
  orderId: number,
  newStatus: number,
  orderState: {
    fruugoOrdersId: string | null;
    gosportOrderId: string | null;
    catchOrderId: string | null;
    decathlonOrderId: string | null;
    ebayOrdersId: string | null;
    tescoCustomerOrderId: string | null;
  }
): Promise<string[]> {
  const errors: string[] = [];

  // --- Amazon: Update on every status change ---
  try {
    const amazonRows = await prisma.$queryRaw<AmazonOrderRow[]>(
      Prisma.sql`SELECT CAST(amazon_orders_id AS CHAR) AS amazon_orders_id
                 FROM orders WHERE orders_id = ${orderId}
                   AND amazon_orders_id IS NOT NULL AND amazon_orders_id != ''`
    );
    if (amazonRows.length > 0 && amazonRows[0].amazon_orders_id) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE amazon_orders
                   SET ukss_orders_status = ${newStatus},
                       ukss_last_updated_date = NOW()
                   WHERE amazon_orders_id = ${amazonRows[0].amazon_orders_id}`
      );
    }
  } catch (err) {
    const msg = `Amazon sync failed for order ${orderId}`;
    logger.warn({ orderId, err }, msg);
    errors.push(msg);
  }

  // --- Tesco: Update dispatch_date on shipped ---
  // PHP: WHERE customer_order_no = $tesco_customer_order_no (from orders.tesco_customer_order_id)
  if (newStatus === STATUS.SHIPPED && orderState.tescoCustomerOrderId) {
    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE tesco_orders SET dispatch_date = NOW()
                   WHERE customer_order_no = ${orderState.tescoCustomerOrderId}
                     AND line_status = 50 AND DISPNT_feed_flag = 0`
      );
    } catch (err) {
      const msg = `Tesco dispatch sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  // --- eBay: Update dispatch_date on shipped ---
  // PHP: WHERE ebay_orders_id = $ebay_orders_id (from orders.ebay_orders_id)
  if (newStatus === STATUS.SHIPPED && orderState.ebayOrdersId) {
    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ebay_orders SET dispatch_date = NOW()
                   WHERE ebay_orders_id = ${orderState.ebayOrdersId}`
      );
    } catch (err) {
      const msg = `eBay dispatch sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  // --- Fruugo: Update tracking on shipped ---
  if (newStatus === STATUS.SHIPPED && orderState.fruugoOrdersId) {
    try {
      // Get tracking: DHL first, fallback to orders_products
      let trackingNo = '';
      const dhlRows = await prisma.$queryRaw<DhlTrackingRow[]>(
        Prisma.sql`SELECT shipment_no FROM dhl_shipments
                   WHERE orders_id = ${orderId} LIMIT 1`
      );
      if (dhlRows.length > 0 && dhlRows[0].shipment_no) {
        trackingNo = dhlRows[0].shipment_no;
      } else {
        const opRows = await prisma.$queryRaw<OrderProductTrackingRow[]>(
          Prisma.sql`SELECT tracking_no FROM orders_products
                     WHERE orders_id = ${orderId}
                       AND tracking_no IS NOT NULL AND tracking_no != ''
                     GROUP BY orders_id LIMIT 1`
        );
        if (opRows.length > 0) trackingNo = opRows[0].tracking_no;
      }

      await prisma.$executeRaw(
        Prisma.sql`UPDATE fruugo_orders
                   SET ship_status = 1, tracking_code = ${trackingNo}
                   WHERE fruugo_order_id = ${orderState.fruugoOrdersId}`
      );
    } catch (err) {
      const msg = `Fruugo shipped sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  // --- GoSport: Cancel propagation ---
  if (orderState.gosportOrderId &&
    (newStatus === STATUS.CANCELLED || newStatus === STATUS.REJECTED)) {
    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE gosport_orders SET gosport_order_status = 'To_be_canceled'
                   WHERE ukss_order_id = ${orderId}`
      );
    } catch (err) {
      const msg = `GoSport cancel sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  // --- Catch: Cancel propagation ---
  if (orderState.catchOrderId &&
    (newStatus === STATUS.CANCELLED || newStatus === STATUS.REJECTED)) {
    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE catch_orders SET catch_order_status = 'To_be_canceled'
                   WHERE ukss_order_id = ${orderId}`
      );
    } catch (err) {
      const msg = `Catch cancel sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  // --- Decathlon: Cancel propagation ---
  if (orderState.decathlonOrderId &&
    (newStatus === STATUS.CANCELLED || newStatus === STATUS.REJECTED)) {
    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE decathlon_orders SET decathlon_order_status = 'To_be_canceled'
                   WHERE ukss_order_id = ${orderId}`
      );
    } catch (err) {
      const msg = `Decathlon cancel sync failed for order ${orderId}`;
      logger.warn({ orderId, err }, msg);
      errors.push(msg);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Fruugo Confirmation Check (PHP lines 6732-6760)
// ---------------------------------------------------------------------------

/**
 * Check if a Fruugo order needs confirmation before status change.
 * Returns true if blocked (Fruugo order exists but not confirmed).
 */
export async function isFruugoConfirmationBlocked(
  prisma: PrismaClient,
  fruugoOrdersId: string | null
): Promise<boolean> {
  if (!fruugoOrdersId || fruugoOrdersId === '') return false;

  const rows = await prisma.$queryRaw<FruugoConfirmationRow[]>(
    Prisma.sql`SELECT id FROM fruugo_orders
               WHERE cancel_reason = ''
                 AND ukss_confirmation_status = 0
                 AND fruugo_order_id = ${fruugoOrdersId}`
  );

  return rows.length > 0;
}

/**
 * Check if status is one that triggers pre-order pipeline insert.
 */
export function isPreOrderStatus(status: number): boolean {
  return (PRE_ORDER_INSERT_STATUSES as readonly number[]).includes(status);
}
