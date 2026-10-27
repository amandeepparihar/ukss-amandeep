import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type {
  TrendResponse,
  TrendDataPoint,
  TrendInsight,
} from '@admin/shared';

/** Max stores to show in tooltip to prevent overflow */
const MAX_TOOLTIP_STORES = 5;

interface RevenueTrendChartProps {
  startDate: string;
  endDate: string;
  stores: number[];
  comparePrevious: boolean;
  onComparePreviousChange: (value: boolean) => void;
}

/**
 * Formats a GBP currency value for axis labels.
 * Uses compact notation for large values (e.g., 1.2k, 45k).
 */
function formatCurrencyAxis(value: number): string {
  if (value >= 1000) {
    return `\u00a3${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return `\u00a3${value.toFixed(0)}`;
}

/**
 * Formats a full GBP currency value for tooltips and insight banner.
 */
function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats a date string based on granularity for X-axis labels.
 * Daily: "Mon 24" format.
 * Weekly: "W09" format (ISO week number).
 */
function formatXAxisLabel(dateStr: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
  if (granularity === 'monthly') {
    // Expected format: YYYY-MM-01 (first of the month)
    const date = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }

  if (granularity === 'weekly') {
    // Expected format: "2026-W09" or similar YYYY-Www
    const weekMatch = dateStr.match(/W(\d{2})/);
    if (weekMatch) {
      return `W${weekMatch[1]}`;
    }
    return dateStr;
  }

  // Daily: parse YYYY-MM-DD and format as "Mon DD"
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return dateStr;
  }
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = dayNames[date.getUTCDay()];
  const dayOfMonth = date.getUTCDate();
  return `${dayOfWeek} ${dayOfMonth}`;
}

/**
 * Formats a date string for the insight banner display.
 */
function formatInsightDate(dateStr: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
  if (granularity === 'monthly') {
    const date = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  if (granularity === 'weekly') {
    const weekMatch = dateStr.match(/W(\d{2})/);
    if (weekMatch) {
      return `Week ${parseInt(weekMatch[1], 10)}`;
    }
    return dateStr;
  }

  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return dateStr;
  }
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Merges current and previous period data into a single array for Recharts.
 * Each element contains both current and previous period values keyed
 * by `prevRevenue` and `prevOrderCount`.
 */
function mergeWithPreviousPeriod(
  current: TrendDataPoint[],
  previous: TrendDataPoint[] | undefined
): Array<TrendDataPoint & { prevRevenue?: number; prevOrderCount?: number }> {
  if (!previous || previous.length === 0) {
    return current;
  }

  return current.map((point, index) => ({
    ...point,
    prevRevenue: previous[index]?.revenue,
    prevOrderCount: previous[index]?.orderCount,
  }));
}

/**
 * Custom tooltip component for the trend chart.
 * Shows date, revenue, order count, and per-store breakdown (top 5).
 */
function CustomTooltip({
  active,
  payload,
  label,
  granularity,
  comparePrevious,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: TrendDataPoint & { prevRevenue?: number; prevOrderCount?: number };
  }>;
  label?: string;
  granularity: 'daily' | 'weekly' | 'monthly';
  comparePrevious: boolean;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0]?.payload;
  if (!data) return null;

  const dateLabel = label ? formatInsightDate(String(label), granularity) : '';
  const storeBreakdown = data.breakdown || [];
  const sortedStores = [...storeBreakdown].sort((a, b) => b.revenue - a.revenue);
  const displayStores = sortedStores.slice(0, MAX_TOOLTIP_STORES);
  const remainingCount = sortedStores.length - displayStores.length;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="mb-2 text-sm font-semibold">{dateLabel}</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Revenue:</span>
          <span className="text-sm font-medium text-blue-600">
            {formatCurrencyFull(data.revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Orders:</span>
          <span className="text-sm font-medium text-emerald-600">
            {data.orderCount.toLocaleString()}
          </span>
        </div>

        {comparePrevious && data.prevRevenue !== undefined && (
          <>
            <div className="my-1 border-t" />
            <p className="text-xs font-medium text-muted-foreground">Previous Period</p>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">Revenue:</span>
              <span className="text-xs font-medium text-blue-400">
                {formatCurrencyFull(data.prevRevenue)}
              </span>
            </div>
            {data.prevOrderCount !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">Orders:</span>
                <span className="text-xs font-medium text-emerald-400">
                  {data.prevOrderCount.toLocaleString()}
                </span>
              </div>
            )}
          </>
        )}

        {displayStores.length > 0 && (
          <>
            <div className="my-1 border-t" />
            <p className="text-xs font-medium text-muted-foreground">By Store</p>
            {displayStores.map((store) => (
              <div
                key={store.storeName}
                className="flex items-center justify-between gap-4"
              >
                <span className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {store.storeName}
                </span>
                <span className="text-xs">
                  {formatCurrencyFull(store.revenue)} ({store.orderCount})
                </span>
              </div>
            ))}
            {remainingCount > 0 && (
              <p className="text-xs text-muted-foreground">
                +{remainingCount} more store{remainingCount > 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Renders the trend insight banner above the chart.
 * Shows direction arrow, trend message, and best/worst day highlights.
 */
function InsightBanner({
  insight,
  granularity,
}: {
  insight: TrendInsight;
  granularity: 'daily' | 'weekly' | 'monthly';
}) {
  const periodLabel = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

  const DirectionIcon =
    insight.direction === 'up'
      ? TrendingUp
      : insight.direction === 'down'
        ? TrendingDown
        : Minus;

  const directionColor =
    insight.direction === 'up'
      ? 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800'
      : insight.direction === 'down'
        ? 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800'
        : 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900 dark:border-gray-700';

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 ${directionColor}`}>
      <div className="flex items-center gap-2">
        <DirectionIcon className="h-4 w-4" />
        <span className="text-sm font-medium">{insight.message}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1">
          <Trophy className="h-3 w-3" />
          Best {periodLabel}:{' '}
          {formatInsightDate(insight.bestDay.date, granularity)} (
          {formatCurrencyFull(insight.bestDay.revenue)})
        </span>
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Lowest {periodLabel}:{' '}
          {formatInsightDate(insight.worstDay.date, granularity)} (
          {formatCurrencyFull(insight.worstDay.revenue)})
        </span>
      </div>
    </div>
  );
}

/**
 * Revenue Trend Chart component for the Sales Dashboard.
 *
 * Displays an area/line chart with dual Y-axes:
 * - Left axis: Revenue in GBP
 * - Right axis: Order count
 *
 * Features:
 * - Trend insight banner showing direction, best/worst day
 * - Compare to Previous Period toggle with dashed overlay lines
 * - Adaptive X-axis labels based on granularity (daily/weekly)
 * - Detailed hover tooltip with per-store breakdown
 */
export function RevenueTrendChart({
  startDate,
  endDate,
  stores,
  comparePrevious,
  onComparePreviousChange,
}: RevenueTrendChartProps) {
  const { data, isLoading, isError, error, refetch } = useQuery<TrendResponse>({
    queryKey: ['sales-trends', startDate, endDate, stores, comparePrevious],
    queryFn: () =>
      api
        .get('/executive-dashboard/trends', {
          params: {
            startDate,
            endDate,
            stores: stores.join(','),
            comparePrevious,
          },
        })
        .then((r) => r.data.data),
  });

  const granularity = data?.granularity ?? 'daily';

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return mergeWithPreviousPeriod(data.data, comparePrevious ? data.previousPeriod : undefined);
  }, [data, comparePrevious]);

  const xAxisTickFormatter = useCallback(
    (value: string) => formatXAxisLabel(value, granularity),
    [granularity]
  );

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Revenue & Orders Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[350px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Revenue & Orders Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[350px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-8 w-8" />
            <p className="text-sm">
              {error instanceof Error ? error.message : 'Unable to load trend data. Try refreshing.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty data state
  const hasData = chartData.length > 0;
  const isSinglePoint = chartData.length === 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Revenue & Orders Trend</CardTitle>
        <div className="flex items-center gap-2">
          <Switch
            id="compare-previous"
            checked={comparePrevious}
            onCheckedChange={onComparePreviousChange}
          />
          <Label htmlFor="compare-previous" className="cursor-pointer text-sm">
            Compare to Previous Period
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        {/* Trend Insight Banner */}
        {data?.insight && (
          <InsightBanner insight={data.insight} granularity={granularity} />
        )}

        {/* Chart */}
        {!hasData ? (
          <div className="flex h-[350px] items-center justify-center text-muted-foreground">
            <p className="text-sm">No data available for the selected period.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />

              <XAxis
                dataKey="date"
                tickFormatter={xAxisTickFormatter}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />

              {/* Left Y-axis: Revenue (GBP) */}
              <YAxis
                yAxisId="revenue"
                orientation="left"
                tickFormatter={formatCurrencyAxis}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={65}
              />

              {/* Right Y-axis: Order Count */}
              <YAxis
                yAxisId="orders"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={45}
              />

              <Tooltip
                content={
                  <CustomTooltip
                    granularity={granularity}
                    comparePrevious={comparePrevious}
                  />
                }
              />

              <Legend />

              {/* Primary revenue area */}
              <Area
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                name="Revenue (£)"
                stroke="#3b82f6"
                fill="url(#revenueGradient)"
                strokeWidth={2}
                dot={isSinglePoint ? { r: 4, fill: '#3b82f6' } : false}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />

              {/* Primary order count line */}
              <Line
                yAxisId="orders"
                type="monotone"
                dataKey="orderCount"
                name="Orders"
                stroke="#10b981"
                strokeWidth={2}
                dot={isSinglePoint ? { r: 4, fill: '#10b981' } : false}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />

              {/* Previous period overlay lines (dashed) */}
              {comparePrevious && data?.previousPeriod && data.previousPeriod.length > 0 && (
                <>
                  <Line
                    yAxisId="revenue"
                    type="monotone"
                    dataKey="prevRevenue"
                    name="Prev Revenue (£)"
                    stroke="#93c5fd"
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="orders"
                    type="monotone"
                    dataKey="prevOrderCount"
                    name="Prev Orders"
                    stroke="#6ee7b7"
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
