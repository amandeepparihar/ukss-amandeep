/**
 * Status management helper functions — ported from PHP general.php and orders.php.
 * Pre-order pipeline, ship-by-date calculation, box field updates,
 * order process status updates.
 *
 * Inventory operations are in status.inventory.ts.
 * Marketplace propagation is in status.marketplace.ts.
 *
 * Requirements: REQ-07-006, REQ-07-015, REQ-07-020
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../lib/logger';
import {
  STATUS,
  PROCESS_STATUS_ACTIVE,
  PROCESS_STATUS_RESET,
} from '../orders.constants';
import type {
  OrderProductRow,
  FraudCheckRow,
  PreOrderCheckRow,
} from './status.types';

const logger = createLogger('orders-status');

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ---------------------------------------------------------------------------
// REQ-07-006: Pre-Ordered Orders Pipeline Insert
// ---------------------------------------------------------------------------

/**
 * REQ-07-006: Insert into pre_orderded_orders for statuses 12, 23, 128.
 * Ported from orders.php lines 7236-7272.
 * Only inserts if customer is not flagged as fraud.
 */
export async function insertPreOrderedOrders(
  tx: TxClient,
  orderId: number
): Promise<void> {
  // Get customer ID for the order
  const orderRows = await tx.$queryRaw<Array<{ customers_id: number }>>(
    Prisma.sql`SELECT customers_id FROM orders WHERE orders_id = ${orderId}`
  );
  if (orderRows.length === 0) return;

  // Check fraud status — customers.fraud_status is ENUM('0','1'), compare as string.
  // PHP: if ($fraud_check['fraud_status'] != '0') → skip insert.
  const fraudRows = await tx.$queryRaw<FraudCheckRow[]>(
    Prisma.sql`SELECT fraud_status FROM customers
               WHERE customers_id = ${orderRows[0].customers_id}`
  );
  if (fraudRows.length > 0 && fraudRows[0].fraud_status !== '0') return;

  // Get all order products
  const products = await tx.$queryRaw<Array<{ orders_products_id: number }>>(
    Prisma.sql`SELECT orders_products_id FROM orders_products
               WHERE orders_id = ${orderId}`
  );

  for (const p of products) {
    // Check for existing entry (prevent duplicates)
    const existing = await tx.$queryRaw<PreOrderCheckRow[]>(
      Prisma.sql`SELECT pre_orderded_orders_id FROM pre_orderded_orders
                 WHERE orders_id = ${orderId}
                   AND orders_products_id = ${p.orders_products_id}`
    );

    if (existing.length === 0) {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO pre_orderded_orders
                   (orders_id, orders_products_id, date_added)
                   VALUES (${orderId}, ${p.orders_products_id}, NOW())`
      );
    }
  }

  logger.info({ orderId, productCount: products.length }, 'Inserted pre-ordered orders');
}

// ---------------------------------------------------------------------------
// REQ-07-015: Ship-by-Date Calculation
// ---------------------------------------------------------------------------

/**
 * REQ-07-015: Calculate ship-by-date.
 * Ported from orders.php lines 6788-6872.
 * Only runs for status 14 (Awaiting Printing) or 16 (Being Picked).
 * Only updates if ship_by_date is empty/zero.
 * Status 16 uses same-day shipping logic; status 14 uses next-day+ logic.
 */
export async function calculateAndSetShipByDate(
  tx: TxClient,
  orderId: number,
  newStatus: number,
  currentShipByDate: Date | string | null
): Promise<void> {
  // PHP orders.php line 6789: only applies for status 14 or 16
  if (newStatus !== STATUS.AWAITING_PRINTING && newStatus !== STATUS.BEING_PICKED) {
    return;
  }

  // PHP: if ship_by_date > 0 → do nothing
  if (currentShipByDate && String(currentShipByDate) !== '0000-00-00 00:00:00') {
    return;
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = dayNames[now.getDay()];
  const isWeekend = dayOfWeek === 'Sat' || dayOfWeek === 'Sun';

  let daysToAdd: number;

  if (newStatus === STATUS.BEING_PICKED) {
    // PHP orders.php lines 6796-6829: status 16 (Being Picked) — ships same day or next day
    if (currentTime <= '14:00:00') {
      if (!isWeekend) {
        // Weekday before 14:00: ship today, except Mon after 11:00 → tomorrow
        daysToAdd = (dayOfWeek === 'Mon' && currentTime > '11:00:00') ? 1 : 0;
      } else {
        daysToAdd = dayOfWeek === 'Sun' ? 1 : 2; // Sun→Mon, Sat→Mon
      }
    } else {
      // After 14:00
      if (!isWeekend) {
        daysToAdd = dayOfWeek === 'Fri' ? 3 : 1;
      } else {
        daysToAdd = dayOfWeek === 'Sun' ? 1 : 2; // Sun→Mon, Sat→Mon
      }
    }
  } else {
    // STATUS.AWAITING_PRINTING (14) — PHP orders.php lines 6830-6869
    if (currentTime <= '14:00:00') {
      if (!isWeekend) {
        if (dayOfWeek === 'Mon') {
          daysToAdd = currentTime <= '11:00:00' ? 1 : 2;
        } else if (dayOfWeek === 'Fri') {
          daysToAdd = 3; // skip weekend
        } else {
          daysToAdd = 1; // Tue-Thu
        }
      } else {
        daysToAdd = dayOfWeek === 'Sun' ? 2 : 3; // Sun→Tue, Sat→Tue
      }
    } else {
      // After 14:00
      if (!isWeekend) {
        if (dayOfWeek === 'Fri' || dayOfWeek === 'Thu') {
          daysToAdd = 4;
        } else {
          daysToAdd = 2; // Mon-Wed
        }
      } else {
        daysToAdd = dayOfWeek === 'Sun' ? 2 : 3; // Sun→Tue, Sat→Tue
      }
    }
  }

  const shipByDate = new Date(now);
  shipByDate.setDate(shipByDate.getDate() + daysToAdd);
  shipByDate.setHours(23, 59, 59, 0);

  const formatted = shipByDate.toISOString().slice(0, 19).replace('T', ' ');

  await tx.$executeRaw(
    Prisma.sql`UPDATE orders SET ship_by_date = ${formatted}
               WHERE orders_id = ${orderId}`
  );

  logger.info({ orderId, shipByDate: formatted, daysToAdd, newStatus }, 'Set ship-by-date');
}

// ---------------------------------------------------------------------------
// Order Process Status (PHP lines 7223-7225)
// ---------------------------------------------------------------------------

/**
 * REQ-07-020: Update order_process_status based on new order status.
 * Statuses 5,12,14,16,22,23,24,128 → process_status = 1
 * Statuses 1,2,7,18 → process_status = 0
 */
export async function updateOrderProcessStatus(
  tx: TxClient,
  orderId: number,
  newStatus: number
): Promise<void> {
  if ((PROCESS_STATUS_ACTIVE as readonly number[]).includes(newStatus)) {
    await tx.$executeRaw(
      Prisma.sql`UPDATE orders
                 SET order_process_status = 1, order_process_date = NOW()
                 WHERE orders_id = ${orderId}
                   AND order_process_status = 0`
    );
  } else if ((PROCESS_STATUS_RESET as readonly number[]).includes(newStatus)) {
    await tx.$executeRaw(
      Prisma.sql`UPDATE orders
                 SET order_process_status = 0, order_process_date = NOW()
                 WHERE orders_id = ${orderId}`
    );
  }
}

// ---------------------------------------------------------------------------
// Box Field Updates (PHP lines 7274-7329)
// ---------------------------------------------------------------------------

/**
 * Update box1/box2/box3 fields on orders_products based on status change.
 * Ported from orders.php lines 7274-7329.
 */
export async function updateBoxFields(
  tx: TxClient,
  orderId: number,
  newStatus: number,
  previousStatus: number
): Promise<void> {
  const products = await tx.$queryRaw<OrderProductRow[]>(
    Prisma.sql`SELECT orders_products_id, backorder, ship_chk
               FROM orders_products WHERE orders_id = ${orderId}`
  );

  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  if (newStatus === STATUS.CANCELLED) {
    // Status 18: Mark boxes as 'Cancelled' for non-shipped products
    for (const p of products) {
      if (p.ship_chk === 'no') {
        await tx.$executeRaw(
          Prisma.sql`UPDATE orders_products
                     SET box1 = 'Cancelled', box2 = 'Cancelled', box3 = 'Cancelled'
                     WHERE orders_products_id = ${p.orders_products_id}`
        );
      }
    }
  } else if (newStatus === STATUS.REJECTED) {
    // Status 112: Mark boxes as 'Rejected' for non-shipped products
    for (const p of products) {
      if (p.ship_chk === 'no') {
        await tx.$executeRaw(
          Prisma.sql`UPDATE orders_products
                     SET box1 = 'Rejected', box2 = 'Rejected', box3 = 'Rejected'
                     WHERE orders_products_id = ${p.orders_products_id}`
        );
      }
    }
  } else if (previousStatus === STATUS.REJECTED && newStatus !== STATUS.REJECTED) {
    // Moving FROM rejected: clear box fields
    for (const p of products) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE orders_products
                   SET box1 = '', box2 = '', box3 = ''
                   WHERE orders_products_id = ${p.orders_products_id}`
      );
    }
  } else if (newStatus === STATUS.BEING_PICKED) {
    // Status 16: Set box dates for non-backorder, non-shipped products
    const nextWorkingDate = calculateNextWorkingDateStr(today);
    for (const p of products) {
      if (p.backorder === 'No' && p.ship_chk === 'no') {
        await tx.$executeRaw(
          Prisma.sql`UPDATE orders_products
                     SET box1 = ${todayStr}, box2 = ${todayStr}, box3 = ${nextWorkingDate}
                     WHERE orders_products_id = ${p.orders_products_id}`
        );
      }
    }
  } else if (newStatus === STATUS.SHIPPED) {
    // Status 5: Set all box dates to today for non-backorder, non-shipped
    for (const p of products) {
      if (p.backorder === 'No' && p.ship_chk === 'no') {
        await tx.$executeRaw(
          Prisma.sql`UPDATE orders_products
                     SET box1 = ${todayStr}, box2 = ${todayStr}, box3 = ${todayStr}
                     WHERE orders_products_id = ${p.orders_products_id}`
        );
      }
    }
  }
}

/**
 * Calculate next working date (skips Sundays).
 * Ported from calculateNextWorkingDate() in general.php line 3913.
 * Note: PHP only excludes Sundays (not Saturdays) per checkWeeKend().
 */
function calculateNextWorkingDateStr(fromDate: Date): string {
  const next = new Date(fromDate);
  next.setDate(next.getDate() + 1);

  // Skip Sunday (day === 0)
  while (next.getDay() === 0) {
    next.setDate(next.getDate() + 1);
  }

  return `${String(next.getDate()).padStart(2, '0')}/${String(next.getMonth() + 1).padStart(2, '0')}/${next.getFullYear()}`;
}
