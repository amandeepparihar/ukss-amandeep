/**
 * Product Type Sales Service
 *
 * Provides summary and time-series data for sales broken down by product type.
 * Joins orders_products -> orders -> new_products -> product_types.
 */

import { prisma, Prisma } from '../../../lib/prisma';
import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';

interface ProductTypeSalesParams {
  startDate: string;
  endDate: string;
  typeId?: number;
  granularity?: 'daily' | 'weekly' | 'monthly';
  noCache?: boolean;
}

interface SummaryRow {
  type_id: number | bigint;
  type_name: string;
  total_orders: bigint;
  total_units: bigint;
  total_revenue: number | string;
}

interface TimeSeriesRow {
  period: string;
  type_id: number | bigint;
  type_name: string;
  units_sold: bigint;
  revenue: number | string;
}

function stripPrefix(name: string): string {
  return name.replace(/^Product\s*-\s*/, '');
}

function toBigIntNumber(val: bigint | number | string): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val);
  return val;
}

export async function getProductTypeSales(params: ProductTypeSalesParams) {
  const { startDate, endDate, typeId, granularity = 'monthly', noCache = false } = params;
  const logger = getLogger();

  const cacheKey = `sales-dashboard:product-type-sales:${startDate}:${endDate}:${typeId ?? 'all'}:${granularity}`;

  return withCache(cacheKey, 3600, async () => {
    logger.info({ startDate, endDate, typeId, granularity }, 'Fetching product type sales');

    // Append time to endDate so BETWEEN includes the full day
    const endDateTime = `${endDate} 23:59:59`;

    // Build optional typeId filter
    const typeFilter = typeId !== undefined
      ? Prisma.sql`AND pt.type_id = ${typeId}`
      : Prisma.empty;

    // ─── Summary Query ─────────────────────────────────────────────
    logger.info(
      { chart: 'product-type-sales', label: 'summary', params: { startDate, endDate, typeId } },
      '[product-type-sales] Executing query: summary',
    );
    const summaryStartMs = Date.now();
    const summaryRows = await prisma.$queryRaw<SummaryRow[]>`
      SELECT
        pt.type_id AS type_id,
        pt.type_name AS type_name,
        COUNT(DISTINCT o.orders_id) AS total_orders,
        SUM(op.products_quantity) AS total_units,
        SUM(op.final_price * op.products_quantity) AS total_revenue
      FROM orders_products op
        INNER JOIN orders o ON o.orders_id = op.orders_id
        INNER JOIN new_products np ON np.products_id = op.products_id
        INNER JOIN product_types pt ON pt.type_id = np.products_type
      WHERE o.orders_status = 5
        AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
        AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
        AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
        AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
        AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
        ${typeFilter}
      GROUP BY pt.type_id, pt.type_name
      ORDER BY total_revenue DESC
    `;
    const summaryDurationMs = Date.now() - summaryStartMs;
    logger.info(
      { chart: 'product-type-sales', label: 'summary', durationMs: summaryDurationMs, rowCount: summaryRows.length },
      '[product-type-sales] Query complete: summary',
    );

    // Compute total revenue for percentage calculation
    const totalRevenue = summaryRows.reduce(
      (sum, row) => sum + toBigIntNumber(row.total_revenue),
      0,
    );

    const summary = summaryRows.map((row) => {
      const revenue = toBigIntNumber(row.total_revenue);
      return {
        typeId: toBigIntNumber(row.type_id),
        typeName: stripPrefix(row.type_name),
        totalOrders: toBigIntNumber(row.total_orders),
        totalUnitsSold: toBigIntNumber(row.total_units),
        totalRevenue: revenue,
        percentageOfTotal: totalRevenue > 0
          ? Math.round((revenue / totalRevenue) * 10000) / 100
          : 0,
      };
    });

    // ─── Time Series Query ─────────────────────────────────────────
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

    logger.info(
      { chart: 'product-type-sales', label: 'time-series', params: { startDate, endDate, typeId, granularity } },
      '[product-type-sales] Executing query: time-series',
    );
    const timeSeriesStartMs = Date.now();
    const timeSeriesRows = await prisma.$queryRaw<TimeSeriesRow[]>`
      SELECT
        ${dateGroupExpr} AS period,
        pt.type_id AS type_id,
        pt.type_name AS type_name,
        SUM(op.products_quantity) AS units_sold,
        SUM(op.final_price * op.products_quantity) AS revenue
      FROM orders_products op
        INNER JOIN orders o ON o.orders_id = op.orders_id
        INNER JOIN new_products np ON np.products_id = op.products_id
        INNER JOIN product_types pt ON pt.type_id = np.products_type
      WHERE o.orders_status = 5
        AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
        AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
        AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
        AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
        AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
        ${typeFilter}
      GROUP BY period, pt.type_id, pt.type_name
      ORDER BY period ASC, revenue DESC
    `;
    const timeSeriesDurationMs = Date.now() - timeSeriesStartMs;
    logger.info(
      { chart: 'product-type-sales', label: 'time-series', durationMs: timeSeriesDurationMs, rowCount: timeSeriesRows.length },
      '[product-type-sales] Query complete: time-series',
    );

    // Group flat rows into { period, types: [...] } structure
    const timeSeriesMap = new Map<string, Array<{
      typeId: number;
      typeName: string;
      unitsSold: number;
      revenue: number;
    }>>();

    for (const row of timeSeriesRows) {
      const period = row.period;
      if (!timeSeriesMap.has(period)) {
        timeSeriesMap.set(period, []);
      }
      timeSeriesMap.get(period)!.push({
        typeId: toBigIntNumber(row.type_id),
        typeName: stripPrefix(row.type_name),
        unitsSold: toBigIntNumber(row.units_sold),
        revenue: toBigIntNumber(row.revenue),
      });
    }

    const timeSeries = Array.from(timeSeriesMap.entries()).map(([period, types]) => ({
      period,
      types,
    }));

    logger.info(
      { summaryCount: summary.length, timeSeriesCount: timeSeries.length },
      'Product type sales query complete',
    );

    return { summary, timeSeries };
  }, noCache);
}

export async function getProductTypes() {
  const logger = getLogger();

  return withCache('sales-dashboard:product-types:list', 3600, async () => {
    logger.info(
      { chart: 'product-type-sales', label: 'product-types-list' },
      '[product-type-sales] Executing query: product-types-list',
    );
    const productTypesStartMs = Date.now();
    const rows = await prisma.$queryRaw<Array<{ type_id: number | bigint; type_name: string }>>`
      SELECT type_id, type_name
      FROM product_types
      ORDER BY type_name ASC
    `;
    const productTypesDurationMs = Date.now() - productTypesStartMs;
    logger.info(
      { chart: 'product-type-sales', label: 'product-types-list', durationMs: productTypesDurationMs, rowCount: rows.length },
      '[product-type-sales] Query complete: product-types-list',
    );

    return rows.map((row) => ({
      typeId: toBigIntNumber(row.type_id),
      typeName: stripPrefix(row.type_name),
    }));
  });
}
