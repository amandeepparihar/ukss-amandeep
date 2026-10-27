/**
 * Daily Revenue Service
 *
 * Aggregates daily revenue for the heatmap chart, with optional
 * year-over-year comparison by shifting dates back 1 year.
 */

import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';
import type { DailyRevenueQuery } from '../sales-dashboard.schema';

// ─── Types ────────────────────────────────────────────────────────────

interface DailyRevenueEntry {
  date: string;
  revenue: number;
}

interface DailyRevenueResult {
  current: DailyRevenueEntry[];
  priorYear?: DailyRevenueEntry[];
}

interface RawDailyRevenueRow {
  sale_date: string;
  revenue: number | string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const CACHE_TTL = 3600; // 1 hour

function toNumber(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val) || 0;
}

function buildCacheKey(params: DailyRevenueQuery): string {
  const parts = [
    'sales-dashboard:daily-revenue',
    params.startDate,
    params.endDate,
  ];
  if (params.comparePriorYear) parts.push('yoy');
  return parts.join(':');
}

/**
 * Shift a YYYY-MM-DD date string back by 1 year.
 */
function shiftDateBackOneYear(dateStr: string): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Query builder ──────────────────────────────────────────────────

async function fetchDailyRevenue(
  startDate: string,
  endDate: string,
): Promise<DailyRevenueEntry[]> {
  const endDateTime = `${endDate} 23:59:59`;

  const sql = `SELECT
       DATE_FORMAT(o.date_purchased, '%Y-%m-%d') AS sale_date,
       SUM(op.final_price * op.products_quantity) AS revenue
     FROM orders_products op
     INNER JOIN orders o ON o.orders_id = op.orders_id
     WHERE o.orders_status = 5
       AND o.date_purchased BETWEEN ? AND ?
       AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
       AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
       AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
       AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
     GROUP BY sale_date
     ORDER BY sale_date ASC`;

  const rows = await queryWithLog<RawDailyRevenueRow>('daily-revenue', 'daily-totals', sql, [startDate, endDateTime]);

  return rows.map((row) => ({
    date: String(row.sale_date),
    revenue: Math.round(toNumber(row.revenue) * 100) / 100,
  }));
}

// ─── Main service function ──────────────────────────────────────────

export async function getDailyRevenue(
  params: DailyRevenueQuery,
): Promise<DailyRevenueResult> {
  const logger = getLogger();
  const cacheKey = buildCacheKey(params);

  return withCache<DailyRevenueResult>(
    cacheKey,
    CACHE_TTL,
    async () => {
      logger.info({ params }, 'Fetching daily revenue data from database');

      const current = await fetchDailyRevenue(params.startDate, params.endDate);

      logger.info({ rowCount: current.length }, 'Daily revenue current period returned');

      const result: DailyRevenueResult = { current };

      if (params.comparePriorYear) {
        const priorStart = shiftDateBackOneYear(params.startDate);
        const priorEnd = shiftDateBackOneYear(params.endDate);

        const priorYear = await fetchDailyRevenue(priorStart, priorEnd);

        logger.info(
          { rowCount: priorYear.length },
          'Daily revenue prior year returned',
        );

        result.priorYear = priorYear;
      }

      return result;
    },
    params.noCache,
  );
}
