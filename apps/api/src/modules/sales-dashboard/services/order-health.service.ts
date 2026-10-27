/**
 * Order Health Service
 *
 * Computes order health metrics: total products ordered, rejection rate,
 * return rate, and fulfillment rate across ALL order statuses.
 *
 * This is the EXCEPTION chart — it does NOT filter by orders_status = 5.
 * It measures the entire order pipeline quality.
 */

import { prisma, Prisma } from '../../../lib/prisma';
import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';

// ─── Parameter & Row Interfaces ──────────────────────────────────────

interface OrderHealthParams {
  startDate: string;
  endDate: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
  noCache?: boolean;
}

interface TotalRow {
  period: string;
  total_products_ordered: bigint;
  total_units: bigint;
  total_revenue: number | string;
}

interface RejectedRow {
  period: string;
  rejected_products: bigint;
  rejected_units: bigint;
  rejected_revenue: number | string;
}

interface OrdersRejectedRow {
  period: string;
  rejected_orders: bigint;
}

interface ReturnedRow {
  period: string;
  returned_products: bigint;
  returned_units: bigint;
  returned_revenue: number | string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val);
  return val;
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

// ─── Main Service Function ───────────────────────────────────────────

export async function getOrderHealth(params: OrderHealthParams) {
  const { startDate, endDate, granularity = 'monthly', noCache = false } = params;
  const logger = getLogger();

  const cacheKey = `sales-dashboard:order-health:${startDate}:${endDate}:${granularity}`;

  return withCache(cacheKey, 3600, async () => {
    logger.info({ startDate, endDate, granularity }, 'Fetching order health metrics');

    // Append time to endDate so BETWEEN includes the full day
    const endDateTime = `${endDate} 23:59:59`;

    // Build granularity expression
    let dateGroupExpr: ReturnType<typeof Prisma.sql>;
    switch (granularity) {
      case 'daily':
        dateGroupExpr = Prisma.sql`DATE_FORMAT(o.date_purchased, '%Y-%m-%d')`;
        break;
      case 'weekly':
        dateGroupExpr = Prisma.sql`DATE_FORMAT(DATE_SUB(o.date_purchased, INTERVAL WEEKDAY(o.date_purchased) DAY), '%Y-%m-%d')`;
        break;
      case 'monthly':
      default:
        dateGroupExpr = Prisma.sql`DATE_FORMAT(o.date_purchased, '%Y-%m')`;
        break;
    }

    // Run all 4 queries in parallel
    const queryStart = Date.now();

    const [totalRows, rejectedRows, ordersRejectedRows, returnedRows] = await Promise.all([
      // Query 1 — Total products ordered (ALL statuses — NO orders_status filter)
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'order-health', label: 'total-products', params: { startDate, endDate, granularity } },
          '[order-health] Executing query: total-products',
        );
        const rows = await prisma.$queryRaw<TotalRow[]>`
          SELECT
            ${dateGroupExpr} AS period,
            COUNT(*) AS total_products_ordered,
            SUM(op.products_quantity) AS total_units,
            SUM(op.final_price * op.products_quantity) AS total_revenue
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
          WHERE o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
          GROUP BY period
          ORDER BY period
        `;
        logger.info(
          { chart: 'order-health', label: 'total-products', durationMs: Date.now() - start, rowCount: rows.length },
          '[order-health] Query complete: total-products',
        );
        return rows;
      })(),

      // Query 2 — Products rejected/cancelled (box-level)
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'order-health', label: 'rejected-products', params: { startDate, endDate, granularity } },
          '[order-health] Executing query: rejected-products',
        );
        const rows = await prisma.$queryRaw<RejectedRow[]>`
          SELECT
            ${dateGroupExpr} AS period,
            COUNT(*) AS rejected_products,
            SUM(op.products_quantity) AS rejected_units,
            SUM(op.final_price * op.products_quantity) AS rejected_revenue
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
          WHERE (op.box1 IN ('Rejected', 'Cancelled')
              OR op.box2 IN ('Rejected', 'Cancelled')
              OR op.box3 IN ('Rejected', 'Cancelled'))
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
          GROUP BY period
          ORDER BY period
        `;
        logger.info(
          { chart: 'order-health', label: 'rejected-products', durationMs: Date.now() - start, rowCount: rows.length },
          '[order-health] Query complete: rejected-products',
        );
        return rows;
      })(),

      // Query 3 — Whole orders rejected (status-level)
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'order-health', label: 'rejected-orders', params: { startDate, endDate, granularity } },
          '[order-health] Executing query: rejected-orders',
        );
        const rows = await prisma.$queryRaw<OrdersRejectedRow[]>`
          SELECT
            ${dateGroupExpr} AS period,
            COUNT(DISTINCT o.orders_id) AS rejected_orders
          FROM orders o
          WHERE o.orders_status IN (18, 112)
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
          GROUP BY period
          ORDER BY period
        `;
        logger.info(
          { chart: 'order-health', label: 'rejected-orders', durationMs: Date.now() - start, rowCount: rows.length },
          '[order-health] Query complete: rejected-orders',
        );
        return rows;
      })(),

      // Query 4 — Products returned
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'order-health', label: 'returned-products', params: { startDate, endDate, granularity } },
          '[order-health] Executing query: returned-products',
        );
        const rows = await prisma.$queryRaw<ReturnedRow[]>`
          SELECT
            ${dateGroupExpr} AS period,
            COUNT(*) AS returned_products,
            SUM(op.products_quantity) AS returned_units,
            SUM(op.final_price * op.products_quantity) AS returned_revenue
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
          WHERE op.return_chk = 'yes'
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
          GROUP BY period
          ORDER BY period
        `;
        logger.info(
          { chart: 'order-health', label: 'returned-products', durationMs: Date.now() - start, rowCount: rows.length },
          '[order-health] Query complete: returned-products',
        );
        return rows;
      })(),
    ]);

    logger.info(
      { chart: 'order-health', durationMs: Date.now() - queryStart },
      '[order-health] All 4 parallel queries complete',
    );

    // ─── Merge by period ─────────────────────────────────────────────

    interface PeriodData {
      totalProducts: number;
      totalUnits: number;
      totalRevenue: number;
      rejectedProducts: number;
      rejectedUnits: number;
      rejectedRevenue: number;
      rejectedOrders: number;
      returnedProducts: number;
      returnedUnits: number;
      returnedRevenue: number;
    }

    const periodMap = new Map<string, PeriodData>();

    const getOrCreate = (period: string): PeriodData => {
      if (!periodMap.has(period)) {
        periodMap.set(period, {
          totalProducts: 0,
          totalUnits: 0,
          totalRevenue: 0,
          rejectedProducts: 0,
          rejectedUnits: 0,
          rejectedRevenue: 0,
          rejectedOrders: 0,
          returnedProducts: 0,
          returnedUnits: 0,
          returnedRevenue: 0,
        });
      }
      return periodMap.get(period)!;
    };

    for (const row of totalRows) {
      const d = getOrCreate(row.period);
      d.totalProducts = toNumber(row.total_products_ordered);
      d.totalUnits = toNumber(row.total_units);
      d.totalRevenue = toNumber(row.total_revenue);
    }

    for (const row of rejectedRows) {
      const d = getOrCreate(row.period);
      d.rejectedProducts = toNumber(row.rejected_products);
      d.rejectedUnits = toNumber(row.rejected_units);
      d.rejectedRevenue = toNumber(row.rejected_revenue);
    }

    for (const row of ordersRejectedRows) {
      const d = getOrCreate(row.period);
      d.rejectedOrders = toNumber(row.rejected_orders);
    }

    for (const row of returnedRows) {
      const d = getOrCreate(row.period);
      d.returnedProducts = toNumber(row.returned_products);
      d.returnedUnits = toNumber(row.returned_units);
      d.returnedRevenue = toNumber(row.returned_revenue);
    }

    // ─── Build time series with computed rates ───────────────────────

    const sortedPeriods = Array.from(periodMap.keys()).sort();

    const timeSeries = sortedPeriods.map((period) => {
      const d = periodMap.get(period)!;
      const rejectionRate = safeRate(d.rejectedProducts, d.totalProducts);
      const returnRate = safeRate(d.returnedProducts, d.totalProducts);
      const fulfillmentRate = d.totalProducts === 0
        ? 0
        : Math.round((100 - rejectionRate - returnRate) * 100) / 100;

      return {
        period,
        totalProducts: d.totalProducts,
        totalUnits: d.totalUnits,
        totalRevenue: d.totalRevenue,
        rejected: {
          products: d.rejectedProducts,
          units: d.rejectedUnits,
          revenue: d.rejectedRevenue,
        },
        returned: {
          products: d.returnedProducts,
          units: d.returnedUnits,
          revenue: d.returnedRevenue,
        },
        rejectionRate,
        returnRate,
        fulfillmentRate,
      };
    });

    // ─── Compute summary across all periods ──────────────────────────

    const totalProducts = timeSeries.reduce((s, t) => s + t.totalProducts, 0);
    const totalUnits = timeSeries.reduce((s, t) => s + t.totalUnits, 0);
    const totalRevenue = timeSeries.reduce((s, t) => s + t.totalRevenue, 0);
    const totalRejectedProducts = timeSeries.reduce((s, t) => s + t.rejected.products, 0);
    const totalRejectedUnits = timeSeries.reduce((s, t) => s + t.rejected.units, 0);
    const totalRejectedRevenue = timeSeries.reduce((s, t) => s + t.rejected.revenue, 0);
    const totalRejectedOrders = sortedPeriods.reduce(
      (s, p) => s + periodMap.get(p)!.rejectedOrders, 0,
    );
    const totalReturnedProducts = timeSeries.reduce((s, t) => s + t.returned.products, 0);
    const totalReturnedUnits = timeSeries.reduce((s, t) => s + t.returned.units, 0);
    const totalReturnedRevenue = timeSeries.reduce((s, t) => s + t.returned.revenue, 0);

    const overallRejectionRate = safeRate(totalRejectedProducts, totalProducts);
    const overallReturnRate = safeRate(totalReturnedProducts, totalProducts);
    const overallFulfillmentRate = totalProducts === 0
      ? 0
      : Math.round((100 - overallRejectionRate - overallReturnRate) * 100) / 100;

    const summary = {
      totalProductsOrdered: totalProducts,
      totalUnits,
      totalRevenue,
      productsRejected: {
        count: totalRejectedProducts,
        units: totalRejectedUnits,
        revenue: totalRejectedRevenue,
        rate: overallRejectionRate,
      },
      ordersRejected: {
        count: totalRejectedOrders,
        rate: safeRate(totalRejectedOrders, totalProducts),
      },
      productsReturned: {
        count: totalReturnedProducts,
        units: totalReturnedUnits,
        revenue: totalReturnedRevenue,
        rate: overallReturnRate,
      },
      fulfillmentRate: overallFulfillmentRate,
    };

    logger.info(
      {
        timeSeriesCount: timeSeries.length,
        totalProducts: summary.totalProductsOrdered,
        rejectionRate: summary.productsRejected.rate,
        returnRate: summary.productsReturned.rate,
        fulfillmentRate: summary.fulfillmentRate,
      },
      'Order health query complete',
    );

    return { summary, timeSeries };
  }, noCache);
}
