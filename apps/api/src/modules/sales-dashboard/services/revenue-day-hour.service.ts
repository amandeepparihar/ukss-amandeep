import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';

// ─── Types ────────────────────────────────────────────────────────────

export interface RevenueDayHourParams {
  startDate: string;
  endDate: string;
  noCache?: boolean;
}

interface DayOfWeekSqlRow {
  day_of_week: number | bigint;
  day_count: number | bigint;
  order_count: number | bigint;
  total_revenue: number | string | null;
}

interface HourOfDaySqlRow {
  hour_of_day: number | bigint;
  day_count: number | bigint;
  order_count: number | bigint;
  total_revenue: number | string | null;
}

interface DayRevenueEntry {
  dayOfWeek: number;
  dayName: string;
  avgRevenue: number;
  totalRevenue: number;
  orderCount: number;
}

interface HourRevenueEntry {
  hour: number;
  avgRevenue: number;
  totalRevenue: number;
  orderCount: number;
}

interface RevenueDayHourResult {
  byDay: DayRevenueEntry[];
  byHour: HourRevenueEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val) || 0;
  return val;
}

/** Map MySQL DAYOFWEEK (1=Sun, 2=Mon, ... 7=Sat) to day name */
const DAY_NAMES: Record<number, string> = {
  1: 'Sun',
  2: 'Mon',
  3: 'Tue',
  4: 'Wed',
  5: 'Thu',
  6: 'Fri',
  7: 'Sat',
};

/** Reorder from Sun-first (MySQL) to Mon-first for display */
const MON_FIRST_ORDER = [2, 3, 4, 5, 6, 7, 1];

// ─── Sales filter (Critical Rule #19) ─────────────────────────────────

const SALES_FILTER = `
  o.orders_status = 5
  AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
  AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
  AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
  AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
`;

// ─── Main Service ─────────────────────────────────────────────────────

export async function getRevenueDayHour(params: RevenueDayHourParams): Promise<RevenueDayHourResult> {
  const { startDate, endDate, noCache = false } = params;
  const cacheKey = `sales-dashboard:revenue-day-hour:${startDate}:${endDate}`;

  return withCache<RevenueDayHourResult>(cacheKey, 3600, async () => {
    const logger = getLogger();
    const startTime = Date.now();

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    // ── Run both queries in parallel ─────────────────────────────────

    const daySql = `SELECT
      DAYOFWEEK(o.date_purchased) AS day_of_week,
      COUNT(DISTINCT DATE(o.date_purchased)) AS day_count,
      COUNT(DISTINCT o.orders_id) AS order_count,
      SUM(op.final_price * op.products_quantity) AS total_revenue
    FROM orders_products op
      INNER JOIN orders o ON o.orders_id = op.orders_id
    WHERE ${SALES_FILTER}
      AND o.date_purchased BETWEEN ? AND ?
    GROUP BY day_of_week
    ORDER BY day_of_week`;

    const hourSql = `SELECT
      HOUR(o.date_purchased) AS hour_of_day,
      COUNT(DISTINCT DATE(o.date_purchased)) AS day_count,
      COUNT(DISTINCT o.orders_id) AS order_count,
      SUM(op.final_price * op.products_quantity) AS total_revenue
    FROM orders_products op
      INNER JOIN orders o ON o.orders_id = op.orders_id
    WHERE ${SALES_FILTER}
      AND o.date_purchased BETWEEN ? AND ?
    GROUP BY hour_of_day
    ORDER BY hour_of_day`;

    const [dayRows, hourRows] = await Promise.all([
      queryWithLog<DayOfWeekSqlRow>('revenue-day-hour', 'by-day-of-week', daySql, [startDateTime, endDateTime]),
      queryWithLog<HourOfDaySqlRow>('revenue-day-hour', 'by-hour-of-day', hourSql, [startDateTime, endDateTime]),
    ]);

    const queryMs = Date.now() - startTime;
    logger.info({ durationMs: queryMs, dayRows: dayRows.length, hourRows: hourRows.length }, 'Revenue day/hour queries complete');

    // ── Process day-of-week data ─────────────────────────────────────

    const dayMap = new Map<number, DayOfWeekSqlRow>();
    for (const row of dayRows) {
      dayMap.set(toNumber(row.day_of_week), row);
    }

    // Reorder to Mon–Sun
    const byDay: DayRevenueEntry[] = MON_FIRST_ORDER
      .map((dow) => {
        const row = dayMap.get(dow);
        if (!row) return null;
        const totalRevenue = toNumber(row.total_revenue);
        const dayCount = toNumber(row.day_count);
        return {
          dayOfWeek: dow,
          dayName: DAY_NAMES[dow] ?? `Day ${dow}`,
          avgRevenue: dayCount > 0 ? Math.round((totalRevenue / dayCount) * 100) / 100 : 0,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          orderCount: toNumber(row.order_count),
        };
      })
      .filter(Boolean) as DayRevenueEntry[];

    // ── Process hour-of-day data ─────────────────────────────────────

    const byHour: HourRevenueEntry[] = hourRows.map((row) => {
      const totalRevenue = toNumber(row.total_revenue);
      const dayCount = toNumber(row.day_count);
      return {
        hour: toNumber(row.hour_of_day),
        avgRevenue: dayCount > 0 ? Math.round((totalRevenue / dayCount) * 100) / 100 : 0,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        orderCount: toNumber(row.order_count),
      };
    });

    const totalMs = Date.now() - startTime;
    logger.info({ totalMs }, 'Revenue day/hour data fully processed');

    return { byDay, byHour };
  }, noCache);
}
