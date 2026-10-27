import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';

// ─── Types ────────────────────────────────────────────────────────────

export interface CustomerSegmentsParams {
  startDate: string;
  endDate: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
  noCache?: boolean;
}

interface RawRow {
  period: string;
  segment: string;
  order_count: bigint | number | string;
  revenue: number | string | null;
}

interface CustomerSegmentTimeSeries {
  period: string;
  newRevenue: number;
  repeatRevenue: number;
  newOrders: number;
  repeatOrders: number;
  repeatPercentage: number;
}

interface CustomerSegmentsSummary {
  totalNewRevenue: number;
  totalRepeatRevenue: number;
  totalNewOrders: number;
  totalRepeatOrders: number;
  overallRepeatPercentage: number;
}

interface CustomerSegmentsResponse {
  summary: CustomerSegmentsSummary;
  timeSeries: CustomerSegmentTimeSeries[];
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

function emptyResponse(): CustomerSegmentsResponse {
  return {
    summary: {
      totalNewRevenue: 0,
      totalRepeatRevenue: 0,
      totalNewOrders: 0,
      totalRepeatOrders: 0,
      overallRepeatPercentage: 0,
    },
    timeSeries: [],
  };
}

// ─── Main Service ─────────────────────────────────────────────────────

export async function getCustomerSegments(
  params: CustomerSegmentsParams
): Promise<CustomerSegmentsResponse> {
  const logger = getLogger();
  const { startDate, endDate, granularity = 'monthly', noCache = false } = params;

  const cacheKey = `sales-dashboard:customer-segments:${startDate}:${endDate}:${granularity}`;

  return withCache<CustomerSegmentsResponse>(
    cacheKey,
    3600,
    async () => {
      const periodExpr = getDateFormatExpression(granularity);

      const query = `
        SELECT
          ${periodExpr} AS period,
          CASE
            WHEN o.repeat_orders_count = 0 THEN 'new'
            WHEN o.repeat_orders_count > 0 THEN 'repeat'
          END AS segment,
          COUNT(DISTINCT o.orders_id) AS order_count,
          SUM(op.final_price * op.products_quantity) AS revenue
        FROM orders_products op
          INNER JOIN orders o ON o.orders_id = op.orders_id
        WHERE o.orders_status = 5
          AND o.date_purchased BETWEEN ? AND ?
          AND o.repeat_orders_count != -1
          AND (op.box1 NOT IN ('Rejected','Cancelled') OR op.box1 IS NULL)
          AND (op.box2 NOT IN ('Rejected','Cancelled') OR op.box2 IS NULL)
          AND (op.box3 NOT IN ('Rejected','Cancelled') OR op.box3 IS NULL)
          AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
        GROUP BY period, segment
        ORDER BY period
      `;

      logger.info({ startDate, endDate, granularity }, 'Querying customer segments data');

      const rows = await queryWithLog<RawRow>('customer-segments', 'segment-data', query, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]);

      if (!rows || rows.length === 0) {
        logger.info('No customer segments data found for the given date range');
        return emptyResponse();
      }

      // Accumulate totals per segment
      let totalNewRevenue = 0;
      let totalRepeatRevenue = 0;
      let totalNewOrders = 0;
      let totalRepeatOrders = 0;

      // Group by period for time series
      const periodMap = new Map<string, {
        newRevenue: number;
        repeatRevenue: number;
        newOrders: number;
        repeatOrders: number;
      }>();

      for (const row of rows) {
        const orders = toNumber(row.order_count);
        const revenue = toNumber(row.revenue);
        const isNew = row.segment === 'new';

        if (isNew) {
          totalNewOrders += orders;
          totalNewRevenue += revenue;
        } else {
          totalRepeatOrders += orders;
          totalRepeatRevenue += revenue;
        }

        if (!periodMap.has(row.period)) {
          periodMap.set(row.period, {
            newRevenue: 0,
            repeatRevenue: 0,
            newOrders: 0,
            repeatOrders: 0,
          });
        }

        const entry = periodMap.get(row.period)!;
        if (isNew) {
          entry.newRevenue += revenue;
          entry.newOrders += orders;
        } else {
          entry.repeatRevenue += revenue;
          entry.repeatOrders += orders;
        }
      }

      // Build time series with repeat percentage
      const timeSeries: CustomerSegmentTimeSeries[] = [];
      for (const [period, data] of periodMap) {
        const totalOrders = data.newOrders + data.repeatOrders;
        timeSeries.push({
          period,
          newRevenue: Math.round(data.newRevenue * 100) / 100,
          repeatRevenue: Math.round(data.repeatRevenue * 100) / 100,
          newOrders: data.newOrders,
          repeatOrders: data.repeatOrders,
          repeatPercentage: totalOrders > 0
            ? Math.round((data.repeatOrders / totalOrders) * 10000) / 100
            : 0,
        });
      }

      // Compute overall repeat percentage
      const grandTotalOrders = totalNewOrders + totalRepeatOrders;
      const overallRepeatPercentage = grandTotalOrders > 0
        ? Math.round((totalRepeatOrders / grandTotalOrders) * 10000) / 100
        : 0;

      const result: CustomerSegmentsResponse = {
        summary: {
          totalNewRevenue: Math.round(totalNewRevenue * 100) / 100,
          totalRepeatRevenue: Math.round(totalRepeatRevenue * 100) / 100,
          totalNewOrders,
          totalRepeatOrders,
          overallRepeatPercentage,
        },
        timeSeries,
      };

      logger.info(
        {
          totalNewOrders,
          totalRepeatOrders,
          totalNewRevenue: result.summary.totalNewRevenue,
          totalRepeatRevenue: result.summary.totalRepeatRevenue,
          overallRepeatPercentage,
          periods: timeSeries.length,
        },
        'Customer segments data computed'
      );

      return result;
    },
    noCache,
  );
}
