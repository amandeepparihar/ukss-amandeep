/**
 * KPI Stats Helper — Sales Dashboard
 *
 * Implements the KPI aggregation logic for the Sales Dashboard:
 *  - Period date range calculation (today, week, month, year) in UK/London timezone
 *  - Comparison date range computation for each period tab
 *  - Raw SQL aggregate queries on the legacy `orders` table
 *  - Percentage change calculations
 *
 * All date calculations use UK/London timezone (Europe/London) which
 * observes GMT in winter and BST (GMT+1) in summer. The Intl API is
 * used for timezone conversion without requiring an external library.
 *
 * @taskId #165091-7
 */

import { Prisma } from '@prisma/client';
import type { KPIData } from '@admin/shared';
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { getCachedOrFetch, buildCacheKey } from './cache.helper';

// ====================================================
// Constants
// ====================================================

/** Cache TTL for KPI data in seconds (5 minutes). */
const KPI_CACHE_TTL_SECONDS = 5 * 60;

/** Cache grace period in seconds (2 minutes). */
const KPI_CACHE_GRACE_SECONDS = 2 * 60;

/** London timezone identifier for Intl API. */
const LONDON_TZ = 'Europe/London';

// ====================================================
// Types (internal)
// ====================================================

/**
 * Raw aggregate row returned by the KPI SQL query.
 * MySQL may return bigint or Decimal types as strings.
 * @taskId #165091-7
 */
interface KPIRawRow {
  totalOrders: number | bigint;
  totalRevenue: number | string | null;
  averageOrderValue: number | string | null;
  pendingOrders: number | bigint;
}

/**
 * A date range with inclusive start and exclusive end (midnight boundaries).
 * Datetimes are in UTC but correspond to London midnight boundaries.
 * @taskId #165091-7
 */
interface KPIDateRange {
  start: string; // YYYY-MM-DD HH:mm:ss (UTC equivalent of London midnight start)
  end: string;   // YYYY-MM-DD HH:mm:ss (UTC equivalent of London midnight end, exclusive)
}

/**
 * Definition of a comparison period to compute.
 * @taskId #165091-7
 */
interface ComparisonDef {
  label: string;
  range: KPIDateRange;
}

// ====================================================
// Timezone Helpers
// ====================================================

/**
 * Get the current date/time in London timezone as individual components.
 *
 * Uses `Intl.DateTimeFormat` with `Europe/London` to correctly handle
 * GMT/BST transitions without an external date library.
 *
 * @returns Date components in London time
 * @taskId #165091-7
 */
function getLondonNow(): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Build a UTC Date object that represents a specific London date at midnight.
 *
 * This accounts for the London timezone offset (GMT vs BST) so that when
 * formatted as a UTC datetime string, it corresponds to midnight in London.
 *
 * @param year  - Year in London time
 * @param month - Month (1-12) in London time
 * @param day   - Day in London time
 * @returns Date object representing midnight London time (in UTC)
 * @taskId #165091-7
 */
function londonMidnight(year: number, month: number, day: number): Date {
  // Create a date in UTC for the given London calendar date at noon (to avoid
  // DST boundary issues when probing the offset)
  const utcProbe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Use Intl to find the London hour at this UTC time. The difference between
  // the London hour and the UTC hour gives us the offset.
  const londonParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(utcProbe);

  const londonHour = parseInt(londonParts.find((p) => p.type === 'hour')?.value ?? '12', 10);
  const utcHour = utcProbe.getUTCHours();
  const offsetHours = londonHour - utcHour;

  // Midnight in London = 00:00 London = (00:00 - offset) UTC
  // If London is UTC+1 (BST), midnight London = 23:00 UTC previous day
  return new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0));
}

/**
 * Format a Date object as a MySQL datetime string (YYYY-MM-DD HH:mm:ss).
 *
 * @taskId #165091-7
 */
function formatMySQLDatetime(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const sec = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${sec}`;
}

// ====================================================
// Period Date Range Calculations
// ====================================================

/**
 * Get the number of days in a given month/year.
 *
 * @taskId #165091-7
 */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month gives the last day of the current month
  return new Date(year, month, 0).getDate();
}

/**
 * Compute the date range for a KPI period.
 *
 * All boundaries are midnight-to-midnight in London time, stored as UTC
 * datetime strings for MySQL queries. The `end` is exclusive (start of
 * the next period).
 *
 * @param period - The KPI period tab
 * @returns KPIDateRange with UTC datetime strings corresponding to London midnight boundaries
 * @taskId #165091-7
 */
/**
 * Convert an arbitrary YYYY-MM-DD date range into a KPIDateRange (London
 * midnight boundaries, exclusive end) — the same shape getPeriodRange
 * produces for the fixed 'today'/'week'/'month'/'year' tabs.
 * @taskId executive-sales-dashboard
 */
function customRangeToKPIRange(startDate: string, endDate: string): KPIDateRange {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = londonMidnight(sy, sm, sd);
  const end = new Date(londonMidnight(ey, em, ed).getTime() + 24 * 60 * 60 * 1000);
  return { start: formatMySQLDatetime(start), end: formatMySQLDatetime(end) };
}

/**
 * The equal-length period immediately preceding an arbitrary custom range,
 * for a single "vs Previous Period" comparison — mirrors
 * sales-dashboard.service.ts's getPreviousPeriodDates but in KPIDateRange
 * (London-midnight datetime) form rather than YYYY-MM-DD.
 * @taskId executive-sales-dashboard
 */
function getPreviousCustomRange(startDate: string, endDate: string): KPIDateRange {
  const current = customRangeToKPIRange(startDate, endDate);
  const currentStart = new Date(current.start.replace(' ', 'T') + 'Z');
  const currentEnd = new Date(current.end.replace(' ', 'T') + 'Z');
  const rangeMs = currentEnd.getTime() - currentStart.getTime();
  const prevEnd = currentStart;
  const prevStart = new Date(currentStart.getTime() - rangeMs);
  return { start: formatMySQLDatetime(prevStart), end: formatMySQLDatetime(prevEnd) };
}

function getPeriodRange(period: 'today' | 'week' | 'month' | 'year'): KPIDateRange {
  const now = getLondonNow();

  switch (period) {
    case 'today': {
      const start = londonMidnight(now.year, now.month, now.day);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return { start: formatMySQLDatetime(start), end: formatMySQLDatetime(end) };
    }

    case 'week': {
      // ISO 8601: Monday = 1, Sunday = 7
      // JavaScript getDay(): Sunday = 0, Monday = 1, ..., Saturday = 6
      const todayMidnight = londonMidnight(now.year, now.month, now.day);
      const jsDay = todayMidnight.getUTCDay(); // 0=Sun...6=Sat
      // Days since Monday: Mon=0, Tue=1, ..., Sun=6
      const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1;
      const monday = new Date(todayMidnight.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
      const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { start: formatMySQLDatetime(monday), end: formatMySQLDatetime(nextMonday) };
    }

    case 'month': {
      const start = londonMidnight(now.year, now.month, 1);
      const nextMonth = now.month === 12 ? 1 : now.month + 1;
      const nextMonthYear = now.month === 12 ? now.year + 1 : now.year;
      const end = londonMidnight(nextMonthYear, nextMonth, 1);
      return { start: formatMySQLDatetime(start), end: formatMySQLDatetime(end) };
    }

    case 'year': {
      const start = londonMidnight(now.year, 1, 1);
      const end = londonMidnight(now.year + 1, 1, 1);
      return { start: formatMySQLDatetime(start), end: formatMySQLDatetime(end) };
    }
  }
}

/**
 * Safely subtract months from a date, clamping to the last day of the
 * target month when the original day exceeds it.
 *
 * Business logic: "March 31 vs February" resolves to Feb 28 (or 29 in leap years).
 *
 * @param year  - Source year
 * @param month - Source month (1-12)
 * @param day   - Source day
 * @param monthsToSubtract - Number of months to go back
 * @returns { year, month, day } clamped to a valid date
 * @taskId #165091-7
 */
function subtractMonths(
  year: number,
  month: number,
  day: number,
  monthsToSubtract: number,
): { year: number; month: number; day: number } {
  let targetMonth = month - monthsToSubtract;
  let targetYear = year;

  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  const maxDay = daysInMonth(targetYear, targetMonth);
  return { year: targetYear, month: targetMonth, day: Math.min(day, maxDay) };
}

// ====================================================
// Comparison Date Range Builders
// ====================================================

/**
 * Build comparison date ranges for the "today" period tab.
 *
 * Comparisons:
 *  - vs Yesterday
 *  - vs Same Day Last Week (7 days ago)
 *  - vs Same Day Last Month (clamp month-end edge cases)
 *  - vs Same Day Last Year
 *
 * @taskId #165091-7
 */
function getTodayComparisons(): ComparisonDef[] {
  const now = getLondonNow();
  const comparisons: ComparisonDef[] = [];

  // vs Yesterday
  {
    const yesterday = new Date(Date.UTC(now.year, now.month - 1, now.day - 1));
    const yStart = londonMidnight(
      yesterday.getUTCFullYear(),
      yesterday.getUTCMonth() + 1,
      yesterday.getUTCDate(),
    );
    const yEnd = new Date(yStart.getTime() + 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Yesterday',
      range: { start: formatMySQLDatetime(yStart), end: formatMySQLDatetime(yEnd) },
    });
  }

  // vs Same Day Last Week (exactly 7 days ago)
  {
    const lastWeek = new Date(Date.UTC(now.year, now.month - 1, now.day - 7));
    const lwStart = londonMidnight(
      lastWeek.getUTCFullYear(),
      lastWeek.getUTCMonth() + 1,
      lastWeek.getUTCDate(),
    );
    const lwEnd = new Date(lwStart.getTime() + 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Same Day Last Week',
      range: { start: formatMySQLDatetime(lwStart), end: formatMySQLDatetime(lwEnd) },
    });
  }

  // vs Same Day Last Month (month-end edge case handled by subtractMonths)
  {
    const prev = subtractMonths(now.year, now.month, now.day, 1);
    const smStart = londonMidnight(prev.year, prev.month, prev.day);
    const smEnd = new Date(smStart.getTime() + 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Same Day Last Month',
      range: { start: formatMySQLDatetime(smStart), end: formatMySQLDatetime(smEnd) },
    });
  }

  // vs Same Day Last Year
  {
    const prev = subtractMonths(now.year, now.month, now.day, 12);
    const syStart = londonMidnight(prev.year, prev.month, prev.day);
    const syEnd = new Date(syStart.getTime() + 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Same Day Last Year',
      range: { start: formatMySQLDatetime(syStart), end: formatMySQLDatetime(syEnd) },
    });
  }

  return comparisons;
}

/**
 * Build comparison date ranges for the "week" period tab.
 *
 * Comparisons:
 *  - vs Last Week (Mon-Sun, 7 days prior)
 *  - vs Same Week Last Month (Mon-Sun, ~4 weeks / 28 days prior)
 *  - vs Same Week Last Year (Mon-Sun, ~52 weeks / 364 days prior)
 *
 * @taskId #165091-7
 */
function getWeekComparisons(): ComparisonDef[] {
  const currentRange = getPeriodRange('week');
  const currentStart = new Date(currentRange.start.replace(' ', 'T') + 'Z');
  const comparisons: ComparisonDef[] = [];

  // vs Last Week (exactly 7 days before current week start)
  {
    const lwStart = new Date(currentStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lwEnd = new Date(lwStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Last Week',
      range: { start: formatMySQLDatetime(lwStart), end: formatMySQLDatetime(lwEnd) },
    });
  }

  // vs Same Week Last Month (~4 weeks back = 28 days)
  {
    const smStart = new Date(currentStart.getTime() - 28 * 24 * 60 * 60 * 1000);
    const smEnd = new Date(smStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Same Week Last Month',
      range: { start: formatMySQLDatetime(smStart), end: formatMySQLDatetime(smEnd) },
    });
  }

  // vs Same Week Last Year (52 weeks back = 364 days)
  {
    const syStart = new Date(currentStart.getTime() - 364 * 24 * 60 * 60 * 1000);
    const syEnd = new Date(syStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    comparisons.push({
      label: 'vs Same Week Last Year',
      range: { start: formatMySQLDatetime(syStart), end: formatMySQLDatetime(syEnd) },
    });
  }

  return comparisons;
}

/**
 * Build comparison date ranges for the "month" period tab.
 *
 * Comparisons:
 *  - vs Last Month (same day range for fair partial-month comparison)
 *  - vs Same Month Last Year (same day range)
 *
 * For partial months (current month is incomplete), we compare the same
 * day-of-month range in the comparison period to ensure a fair comparison.
 *
 * @taskId #165091-7
 */
function getMonthComparisons(): ComparisonDef[] {
  const now = getLondonNow();
  const comparisons: ComparisonDef[] = [];
  const currentDayOfMonth = now.day;

  // vs Last Month (1st to same day-of-month, clamped to last day of previous month)
  {
    const prev = subtractMonths(now.year, now.month, 1, 1);
    const lmStart = londonMidnight(prev.year, prev.month, 1);
    // Clamp comparison end to lesser of currentDayOfMonth or last day of previous month
    const maxDay = daysInMonth(prev.year, prev.month);
    const endDay = Math.min(currentDayOfMonth, maxDay);
    const endDateUTC = new Date(Date.UTC(prev.year, prev.month - 1, endDay + 1));
    const lmEnd = londonMidnight(
      endDateUTC.getUTCFullYear(),
      endDateUTC.getUTCMonth() + 1,
      endDateUTC.getUTCDate(),
    );
    comparisons.push({
      label: 'vs Last Month',
      range: { start: formatMySQLDatetime(lmStart), end: formatMySQLDatetime(lmEnd) },
    });
  }

  // vs Same Month Last Year (1st to same day-of-month, clamped)
  {
    const prevYear = now.year - 1;
    const syStart = londonMidnight(prevYear, now.month, 1);
    const maxDay = daysInMonth(prevYear, now.month);
    const endDay = Math.min(currentDayOfMonth, maxDay);
    const endDateUTC = new Date(Date.UTC(prevYear, now.month - 1, endDay + 1));
    const syEnd = londonMidnight(
      endDateUTC.getUTCFullYear(),
      endDateUTC.getUTCMonth() + 1,
      endDateUTC.getUTCDate(),
    );
    comparisons.push({
      label: 'vs Same Month Last Year',
      range: { start: formatMySQLDatetime(syStart), end: formatMySQLDatetime(syEnd) },
    });
  }

  return comparisons;
}

/**
 * Build comparison date ranges for the "year" period tab.
 *
 * Comparison:
 *  - vs Last Year (Jan 1 to same date last year, for fair partial-year comparison)
 *
 * @taskId #165091-7
 */
function getYearComparisons(): ComparisonDef[] {
  const now = getLondonNow();
  const comparisons: ComparisonDef[] = [];

  // vs Last Year (Jan 1 to today's date last year)
  {
    const prevYear = now.year - 1;
    const syStart = londonMidnight(prevYear, 1, 1);
    // Same day in the previous year (clamp for leap year edge: Feb 29 -> Feb 28)
    const maxDay = daysInMonth(prevYear, now.month);
    const clampedDay = Math.min(now.day, maxDay);
    // End is exclusive: midnight of the day after the comparison end date
    const endDateUTC = new Date(Date.UTC(prevYear, now.month - 1, clampedDay + 1));
    const syEnd = londonMidnight(
      endDateUTC.getUTCFullYear(),
      endDateUTC.getUTCMonth() + 1,
      endDateUTC.getUTCDate(),
    );
    comparisons.push({
      label: 'vs Last Year',
      range: { start: formatMySQLDatetime(syStart), end: formatMySQLDatetime(syEnd) },
    });
  }

  return comparisons;
}

/**
 * Get the comparison definitions for a given period.
 *
 * @taskId #165091-7
 */
function getComparisonDefs(period: 'today' | 'week' | 'month' | 'year'): ComparisonDef[] {
  switch (period) {
    case 'today':
      return getTodayComparisons();
    case 'week':
      return getWeekComparisons();
    case 'month':
      return getMonthComparisons();
    case 'year':
      return getYearComparisons();
  }
}

// ====================================================
// SQL Query Execution
// ====================================================

/**
 * Execute the KPI aggregate query for a date range with optional store filter.
 *
 * Returns: totalOrders, totalRevenue, averageOrderValue, pendingOrders.
 *
 * The query targets the legacy `orders` table using raw SQL because it
 * is not part of the Prisma schema.
 *
 * @param range  - Inclusive start / exclusive end datetime range (UTC)
 * @param stores - Optional array of store IDs to filter by `order_site`
 * @returns Parsed KPI metrics (all numbers, never null)
 * @taskId #165091-7
 */
async function queryKPIForRange(
  range: KPIDateRange,
  stores?: number[],
): Promise<{ totalOrders: number; totalRevenue: number; averageOrderValue: number; pendingOrders: number }> {
  const logger = getLogger('sales-dashboard');

  // Raw SQL: Legacy table not in Prisma schema
  // The `orders` table stores all UKSS orders across all marketplaces.
  // `order_total` is the order value in GBP.
  // `orders_status`: 1=Pending, 2=Processing, 3=Processing, 4=Backorder
  // `date_purchased` is a DATETIME column.
  // `order_site` links to `store_management.store_id`.

  let rows: KPIRawRow[];

  if (stores && stores.length > 0) {
    // Raw SQL: Legacy table not in Prisma schema
    rows = await prisma.$queryRaw<KPIRawRow[]>`
      SELECT
        COUNT(*) AS totalOrders,
        COALESCE(SUM(o.order_total), 0) AS totalRevenue,
        COALESCE(AVG(o.order_total), 0) AS averageOrderValue,
        COALESCE(SUM(CASE WHEN o.orders_status IN (1,2,3,4) THEN 1 ELSE 0 END), 0) AS pendingOrders
      FROM orders o
      WHERE o.date_purchased >= ${range.start}
        AND o.date_purchased < ${range.end}
        AND o.order_site IN (${Prisma.join(stores)})
    `;
  } else {
    // Raw SQL: Legacy table not in Prisma schema
    rows = await prisma.$queryRaw<KPIRawRow[]>`
      SELECT
        COUNT(*) AS totalOrders,
        COALESCE(SUM(o.order_total), 0) AS totalRevenue,
        COALESCE(AVG(o.order_total), 0) AS averageOrderValue,
        COALESCE(SUM(CASE WHEN o.orders_status IN (1,2,3,4) THEN 1 ELSE 0 END), 0) AS pendingOrders
      FROM orders o
      WHERE o.date_purchased >= ${range.start}
        AND o.date_purchased < ${range.end}
    `;
  }

  logger.debug(
    { rangeStart: range.start, rangeEnd: range.end, stores, rowCount: rows.length },
    'KPI query executed',
  );

  if (!rows || rows.length === 0) {
    return { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, pendingOrders: 0 };
  }

  const row = rows[0];

  // MySQL may return bigint or string for aggregates — normalize to number
  const totalOrders = Number(row.totalOrders) || 0;
  const totalRevenue = Number(row.totalRevenue) || 0;
  // Edge case: Division by zero for AOV when totalOrders = 0 -> return 0
  const averageOrderValue = totalOrders > 0 ? Number(row.averageOrderValue) || 0 : 0;
  const pendingOrders = Number(row.pendingOrders) || 0;

  return { totalOrders, totalRevenue, averageOrderValue, pendingOrders };
}

// ====================================================
// Comparison Calculation
// ====================================================

/**
 * Calculate percentage change between current and previous values.
 *
 * @param current  - Current period value
 * @param previous - Previous period value
 * @returns Percentage change (2 decimal places), or `null` if previous is 0
 *          (no comparison data available)
 * @taskId #165091-7
 */
function calcPercentageChange(current: number, previous: number): number | null {
  if (previous === 0) {
    // No comparison data -> null for percentage change
    return null;
  }
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

// ====================================================
// Public API
// ====================================================

/**
 * Get KPI summary statistics for a given period with comparisons.
 *
 * Returns aggregated order counts, revenue, AOV, and pending orders for
 * the current period, along with percentage-change comparisons against
 * relevant previous periods.
 *
 * Results are cached in Redis using stale-while-revalidate pattern:
 *  - Cache key: `sd:kpi:{period}:{storeIds}`
 *  - TTL: 5 minutes, grace: 2 minutes
 *
 * Comparison sets per period tab:
 *  - **Today**: vs Yesterday, vs Same Day Last Week, vs Same Day Last Month, vs Same Day Last Year
 *  - **This Week**: vs Last Week, vs Same Week Last Month, vs Same Week Last Year
 *  - **This Month**: vs Last Month, vs Same Month Last Year
 *  - **This Year**: vs Last Year (same period Jan 1 to today's date)
 *
 * Edge cases:
 *  - No orders for period -> returns 0s (not null)
 *  - No comparison data -> returns `null` for percentage change
 *  - Division by zero for AOV when totalOrders = 0 -> returns 0
 *  - Month-end edge: "March 31 vs February" -> uses Feb 28/29
 *
 * @param period - The KPI period tab: 'today', 'week', 'month', 'year'
 * @param stores - Optional array of store IDs to filter by
 * @returns KPIData with metrics and comparisons
 *
 * @taskId #165091-7
 */
export async function getKPIStats(
  period: 'today' | 'week' | 'month' | 'year',
  stores?: number[],
  customRange?: { startDate: string; endDate: string },
  noCache?: boolean,
): Promise<KPIData> {
  const logger = getLogger('sales-dashboard');
  // When customRange is given, the cache key is derived from the actual dates
  // rather than `period` — otherwise two different custom ranges (or a custom
  // range and a real period-tab call) reusing the same `period` label would
  // collide on one cache entry and serve each other's numbers.
  const cacheKey = buildCacheKey(
    'kpi',
    customRange ? `custom:${customRange.startDate}:${customRange.endDate}` : period,
    stores,
  );

  logger.info({ period, stores, customRange, cacheKey }, 'Fetching KPI stats');

  const { data } = await getCachedOrFetch<KPIData>(
    cacheKey,
    KPI_CACHE_TTL_SECONDS,
    KPI_CACHE_GRACE_SECONDS,
    async () => fetchKPIStatsFromDB(period, stores, customRange),
    noCache,
  );

  return data;
}

/**
 * Fetch KPI stats directly from the database (bypasses cache).
 *
 * This is the `fetchFn` passed to `getCachedOrFetch`. It runs the primary
 * period query plus all comparison queries in parallel for performance.
 *
 * For year and month tabs with partial periods, the current range end is
 * adjusted to "end of today" for a fair comparison with previous periods.
 *
 * @param period - KPI period tab
 * @param stores - Optional store filter
 * @returns Fully computed KPIData
 * @taskId #165091-7
 */
async function fetchKPIStatsFromDB(
  period: 'today' | 'week' | 'month' | 'year',
  stores?: number[],
  customRange?: { startDate: string; endDate: string },
): Promise<KPIData> {
  const logger = getLogger('sales-dashboard');
  const startTime = Date.now();

  // When a custom range is given, it always wins over the period-tab logic —
  // the caller picked an explicit range, so there is no "partial period"
  // adjustment to make and only one comparison makes sense: the equal-length
  // period immediately before it.
  let effectiveRange: KPIDateRange;
  let comparisonDefs: ComparisonDef[];

  if (customRange) {
    effectiveRange = customRangeToKPIRange(customRange.startDate, customRange.endDate);
    comparisonDefs = [
      { label: 'vs Previous Period', range: getPreviousCustomRange(customRange.startDate, customRange.endDate) },
    ];
  } else {
    // 1. Get current period range
    const currentRange = getPeriodRange(period);

    // 2. For year and month tabs, adjust range end to "end of today" for fair
    //    partial-period comparison (we compare against the same partial
    //    range in the comparison period)
    effectiveRange = currentRange;
    if (period === 'year' || period === 'month') {
      const now = getLondonNow();
      const todayEnd = londonMidnight(now.year, now.month, now.day);
      const tomorrowMidnight = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
      effectiveRange = {
        start: currentRange.start,
        end: formatMySQLDatetime(tomorrowMidnight),
      };
    }

    // 3. Get comparison definitions for this period tab
    comparisonDefs = getComparisonDefs(period);
  }

  // 4. Run current period + all comparisons in parallel for performance
  const [currentStats, ...comparisonStats] = await Promise.all([
    queryKPIForRange(effectiveRange, stores),
    ...comparisonDefs.map((def) => queryKPIForRange(def.range, stores)),
  ]);

  // 5. Build comparisons with percentage changes
  const comparisons = comparisonDefs.map((def, index) => {
    const prevStats = comparisonStats[index];
    return {
      label: def.label,
      ordersChange: calcPercentageChange(currentStats.totalOrders, prevStats.totalOrders),
      revenueChange: calcPercentageChange(currentStats.totalRevenue, prevStats.totalRevenue),
      aovChange: calcPercentageChange(currentStats.averageOrderValue, prevStats.averageOrderValue),
    };
  });

  const duration = Date.now() - startTime;
  logger.info(
    {
      period,
      totalOrders: currentStats.totalOrders,
      totalRevenue: currentStats.totalRevenue,
      comparisonCount: comparisons.length,
      durationMs: duration,
    },
    'KPI stats fetched from database',
  );

  return {
    period,
    totalOrders: currentStats.totalOrders,
    totalRevenue: Math.round(currentStats.totalRevenue * 100) / 100,
    averageOrderValue: Math.round(currentStats.averageOrderValue * 100) / 100,
    pendingOrders: currentStats.pendingOrders,
    comparisons,
  };
}
