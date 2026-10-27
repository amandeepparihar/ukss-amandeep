/**
 * Marketplace alerts — Amazon late orders + FC error/pending panels.
 * Requirements: REQ-02-002, REQ-02-003, REQ-02-004, REQ-02-005
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { FC_BOX_NUMBER } from '../orders.constants';

const logger = createLogger('orders-alerts');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertOrder {
  orderId: number;
  shipByDate: string;
}

export interface AmazonAlerts {
  uk: {
    lateShipments: AlertOrder[];
    expectedLate: AlertOrder[];
  };
  us: {
    lateShipments: AlertOrder[];
    avoidableLate: AlertOrder[];
    expectedLate: AlertOrder[];
  };
}

export interface FcAlerts {
  errorOrders: number;
  manualPending: number;
}

export interface OrderAlerts {
  amazon: AmazonAlerts;
  fc: FcAlerts;
}

// ---------------------------------------------------------------------------
// REQ-02-002 + REQ-02-003: Amazon late order alerts
// ---------------------------------------------------------------------------

interface AmazonAlertRow {
  orders_id: number;
  ship_by_date: string;
  marketplace: string | null;
}

/**
 * REQ-02-002 & REQ-02-003: Fetch Amazon UK and US late order alerts.
 * UK deadline: today 23:59:59. US deadline: tomorrow 07:59:59.
 */
async function getAmazonAlerts(): Promise<AmazonAlerts> {
  const result: AmazonAlerts = {
    uk: { lateShipments: [], expectedLate: [] },
    us: { lateShipments: [], avoidableLate: [], expectedLate: [] },
  };

  try {
    const rows = await prisma.$queryRaw<AmazonAlertRow[]>(Prisma.sql`
      SELECT
        ao.orders_id,
        ao.ship_by_date,
        ao.marketplace
      FROM amazon_orders ao
      INNER JOIN orders o ON ao.orders_id = o.orders_id
      WHERE ao.orders_status = 'Unshipped'
        AND ao.ship_by_date IS NOT NULL
        AND ao.ship_by_date > '2000-01-01'
      ORDER BY ao.ship_by_date ASC
    `);

    const now = new Date();

    for (const row of rows) {
      const shipBy = new Date(row.ship_by_date);
      const alert: AlertOrder = {
        orderId: row.orders_id,
        shipByDate: row.ship_by_date,
      };
      const isUS = row.marketplace === 'US' || row.marketplace === 'CA';

      if (isUS) {
        // REQ-02-003: US deadline is tomorrow 07:59:59
        const hoursRemaining = (shipBy.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursRemaining < 0) {
          if (result.us.lateShipments.length < 10) result.us.lateShipments.push(alert);
        } else if (hoursRemaining < 13) {
          if (result.us.avoidableLate.length < 10) result.us.avoidableLate.push(alert);
        } else {
          if (result.us.expectedLate.length < 10) result.us.expectedLate.push(alert);
        }
      } else {
        // REQ-02-002: UK deadline is today 23:59:59
        const hoursRemaining = (shipBy.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursRemaining < 0) {
          if (result.uk.lateShipments.length < 10) result.uk.lateShipments.push(alert);
        } else {
          if (result.uk.expectedLate.length < 10) result.uk.expectedLate.push(alert);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to fetch Amazon alerts');
  }

  return result;
}

// ---------------------------------------------------------------------------
// REQ-02-004 + REQ-02-005: FC alerts
// ---------------------------------------------------------------------------

interface CountRow { cnt: bigint }

async function getFcAlerts(): Promise<FcAlerts> {
  const result: FcAlerts = { errorOrders: 0, manualPending: 0 };

  try {
    // REQ-02-004: FC error orders
    const errorRows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) as cnt
      FROM orders
      WHERE fc_auto_creation_bit = '1'
        AND fc_order_id IS NULL
        AND fc_order_creation_error != ''
        AND orders_status NOT IN (0, 1, 2, 7, 112, 18, 5)
    `);
    result.errorOrders = Number(errorRows[0]?.cnt ?? 0);

    // REQ-02-005: FC manual pending — orders with FC2023 box + manual bit + mixed products
    // These are orders that have FC2023 products but ALSO have non-FC2023 products
    // with backorder=NO, meaning they need manual FC order creation.
    const pendingRows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT o.orders_id) as cnt
      FROM orders o
      INNER JOIN orders_products op ON o.orders_id = op.orders_id
      WHERE op.box_number = ${FC_BOX_NUMBER}
        AND o.fc_auto_creation_bit = '0'
        AND o.fc_order_id IS NULL
        AND o.orders_status NOT IN (0, 1, 2, 7, 112, 18, 5)
        AND EXISTS (
          SELECT 1 FROM orders_products op2
          WHERE op2.orders_id = o.orders_id
            AND op2.box_number != ${FC_BOX_NUMBER}
            AND op2.backorder = 'NO'
        )
    `);
    result.manualPending = Number(pendingRows[0]?.cnt ?? 0);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch FC alerts');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * REQ-02-002 through REQ-02-005: Fetch all order listing alerts.
 * Amazon and FC alerts are fetched in parallel.
 */
export async function getOrderAlerts(): Promise<OrderAlerts> {
  const [amazon, fc] = await Promise.all([
    getAmazonAlerts(),
    getFcAlerts(),
  ]);

  return { amazon, fc };
}
