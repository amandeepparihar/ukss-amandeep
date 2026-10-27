import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';

// ─── Types ────────────────────────────────────────────────────────────

export interface GenderSalesParams {
  startDate: string;
  endDate: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
  noCache?: boolean;
}

interface GenderSummarySqlRow {
  gender: string;
  totalOrders: bigint | number;
  totalUnitsSold: bigint | number | null;
  totalRevenue: number | string | null;
}

interface GenderTimeSeriesSqlRow {
  period: string;
  gender: string;
  unitsSold: bigint | number | null;
  revenue: number | string | null;
}

interface GenderSalesSummary {
  gender: string;
  totalOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  percentageOfTotal: number;
}

interface GenderSalesTimeSeriesEntry {
  period: string;
  genders: Array<{
    gender: string;
    unitsSold: number;
    revenue: number;
  }>;
}

interface GenderSalesResult {
  summary: GenderSalesSummary[];
  timeSeries: GenderSalesTimeSeriesEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val) || 0;
  return val;
}

function getDateFormatExpression(granularity: string): string {
  switch (granularity) {
    case 'daily':
      return "DATE_FORMAT(o.date_purchased, '%Y-%m-%d')";
    case 'weekly':
      return "DATE_FORMAT(o.date_purchased, '%x-W%v')";
    case 'monthly':
    default:
      return "DATE_FORMAT(o.date_purchased, '%Y-%m')";
  }
}

// ─── Sales filter (Critical Rule #19) ─────────────────────────────────

const SALES_FILTER = `
  o.orders_status = 5
  AND op.box1 NOT IN ('Rejected', 'Cancelled')
  AND op.box2 NOT IN ('Rejected', 'Cancelled')
  AND op.box3 NOT IN ('Rejected', 'Cancelled')
  AND op.return_chk != 'yes'
`;

// ─── Main Service ─────────────────────────────────────────────────────

export async function getGenderSales(params: GenderSalesParams): Promise<GenderSalesResult> {
  const { startDate, endDate, granularity = 'monthly', noCache = false } = params;
  const cacheKey = `sales-dashboard:gender-sales:${startDate}:${endDate}:${granularity}`;

  return withCache<GenderSalesResult>(cacheKey, 3600, async () => {
    const logger = getLogger('gender-sales-service');
    const startTime = Date.now();

    // ── Summary Query ──────────────────────────────────────────────
    const summaryQuery = `
      SELECT
        COALESCE(NULLIF(np.np_gender, ''), 'Unspecified') AS gender,
        COUNT(DISTINCT o.orders_id) AS totalOrders,
        SUM(op.products_quantity) AS totalUnitsSold,
        SUM(op.final_price * op.products_quantity) AS totalRevenue
      FROM orders o
      JOIN orders_products op ON o.orders_id = op.orders_id
      LEFT JOIN new_products np ON np.products_id = op.products_id
      WHERE ${SALES_FILTER}
        AND o.date_purchased >= ?
        AND o.date_purchased <= ?
      GROUP BY gender
      ORDER BY totalRevenue DESC
    `;

    const summaryRows = await queryWithLog<GenderSummarySqlRow>('gender-sales', 'summary', summaryQuery, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]);
    const summaryMs = Date.now() - startTime;
    logger.info({ durationMs: summaryMs, rows: summaryRows.length }, 'Gender sales summary query complete');

    if (summaryRows.length === 0) {
      return { summary: [], timeSeries: [] };
    }

    // Compute percentages
    const totalRevenue = summaryRows.reduce((sum, r) => sum + toNumber(r.totalRevenue), 0);

    const summary: GenderSalesSummary[] = summaryRows.map((row) => ({
      gender: row.gender,
      totalOrders: toNumber(row.totalOrders),
      totalUnitsSold: toNumber(row.totalUnitsSold),
      totalRevenue: toNumber(row.totalRevenue),
      percentageOfTotal: totalRevenue > 0
        ? Math.round((toNumber(row.totalRevenue) / totalRevenue) * 1000) / 10
        : 0,
    }));

    // ── Time Series Query ──────────────────────────────────────────
    const periodExpr = getDateFormatExpression(granularity);
    const timeSeriesStartTime = Date.now();

    const timeSeriesQuery = `
      SELECT
        ${periodExpr} AS period,
        COALESCE(NULLIF(np.np_gender, ''), 'Unspecified') AS gender,
        SUM(op.products_quantity) AS unitsSold,
        SUM(op.final_price * op.products_quantity) AS revenue
      FROM orders o
      JOIN orders_products op ON o.orders_id = op.orders_id
      LEFT JOIN new_products np ON np.products_id = op.products_id
      WHERE ${SALES_FILTER}
        AND o.date_purchased >= ?
        AND o.date_purchased <= ?
      GROUP BY period, gender
      ORDER BY period ASC, revenue DESC
    `;

    const timeSeriesRows = await queryWithLog<GenderTimeSeriesSqlRow>('gender-sales', 'time-series', timeSeriesQuery, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]);
    const timeSeriesMs = Date.now() - timeSeriesStartTime;
    logger.info({ durationMs: timeSeriesMs, rows: timeSeriesRows.length }, 'Gender sales time series query complete');

    // Reshape flat rows into grouped structure
    const periodMap = new Map<string, Array<{ gender: string; unitsSold: number; revenue: number }>>();
    for (const row of timeSeriesRows) {
      const period = row.period;
      if (!periodMap.has(period)) {
        periodMap.set(period, []);
      }
      periodMap.get(period)!.push({
        gender: row.gender,
        unitsSold: toNumber(row.unitsSold),
        revenue: toNumber(row.revenue),
      });
    }

    const timeSeries: GenderSalesTimeSeriesEntry[] = Array.from(periodMap.entries()).map(
      ([period, genders]) => ({ period, genders })
    );

    const totalMs = Date.now() - startTime;
    logger.info({ totalMs }, 'Gender sales data fully processed');

    return { summary, timeSeries };
  }, noCache);
}
