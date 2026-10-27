import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { MarketplacePerformance } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplaceBreakdownProps {
  startDate: string;
  endDate: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of stores to show in the bar chart to maintain readability. */
const MAX_CHART_BARS = 5;

/** Maximum number of rows shown in the table before "Show all" toggle. */
const MAX_TABLE_ROWS = 5;

/**
 * Color palette for bar chart bars.
 * Chosen for sufficient contrast and accessibility on both light and dark backgrounds.
 */
const BAR_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-GB');

/**
 * Compact currency formatter for Y-axis labels (e.g. "12.3k" instead of "12,345.00").
 */
function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `\u00A3${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `\u00A3${(value / 1_000).toFixed(1)}k`;
  return `\u00A3${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Sub-component: Sparkline
// ---------------------------------------------------------------------------

/**
 * Renders a tiny Recharts LineChart (no axes, no grid) as an inline sparkline
 * showing the 7-day revenue trend for a single store.
 */
function Sparkline({ data }: { data: number[] }) {
  const chartData = useMemo(
    () => data.map((value, index) => ({ index, value })),
    [data]
  );

  // All zeros or empty data: render a flat muted line
  const allZero = data.length === 0 || data.every((v) => v === 0);

  return (
    <div className="h-6 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={allZero ? '#9ca3af' : '#3b82f6'}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Custom Tooltip for BarChart
// ---------------------------------------------------------------------------

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: { storeName: string; revenue: number; orderCount: number; sharePercent: number };
  }>;
}

function BarChartTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0].payload;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <p className="text-sm font-medium">{item.storeName}</p>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p>Revenue: {currencyFormatter.format(item.revenue)}</p>
        <p>Orders: {numberFormatter.format(item.orderCount)}</p>
        <p>Share: {item.sharePercent.toFixed(1)}%</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function MarketplaceBreakdownSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 mt-1" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Marketplace Breakdown</CardTitle>
        <CardDescription>Revenue distribution by store/marketplace</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          No marketplace data available for the selected date range.
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error State
// ---------------------------------------------------------------------------

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Marketplace Breakdown</CardTitle>
        <CardDescription>Revenue distribution by store/marketplace</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <p>Unable to load marketplace data. Try refreshing.</p>
          <button
            type="button"
            onClick={onRetry}
            className="font-medium text-primary underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * MarketplaceBreakdown displays a bar chart of revenue by store/marketplace
 * and a summary table with orders, revenue, AOV, share percentage, and 7-day sparkline.
 *
 * Clicking a bar in the chart updates the global marketplace filter (URL search params)
 * so all dashboard sections reflect data for that single store.
 */
export function MarketplaceBreakdown({ startDate, endDate }: MarketplaceBreakdownProps) {
  const [, setSearchParams] = useSearchParams();
  const [showAllRows, setShowAllRows] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<MarketplacePerformance[]>({
    queryKey: ['sales-marketplace', startDate, endDate],
    queryFn: () =>
      api
        .get('/executive-dashboard/marketplace-breakdown', {
          params: { startDate, endDate },
        })
        .then((r) => r.data.data),
  });

  // Sort by revenue descending for chart display
  const sortedData = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => b.revenue - a.revenue);
  }, [data]);

  // For the chart, limit to top N stores for readability
  const chartData = useMemo(() => {
    return sortedData.slice(0, MAX_CHART_BARS);
  }, [sortedData]);

  /**
   * Handle bar click: update the global store filter in URL search params.
   * This triggers all dashboard sections that respect the store filter to update.
   */
  const handleBarClick = (storeId: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('stores', String(storeId));
      return next;
    });
  };

  // Loading state
  if (isLoading) {
    return <MarketplaceBreakdownSkeleton />;
  }

  // Error state (checked before empty — a failed fetch must never render as "no data")
  if (isError) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  // Empty state
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Marketplace Breakdown</CardTitle>
        <CardDescription>
          Revenue distribution by store/marketplace
          {sortedData.length > MAX_CHART_BARS && (
            <span className="ml-1">
              (top {MAX_CHART_BARS} shown in chart, all {sortedData.length} in table)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Bar Chart */}
        <div className="h-72 mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 20, left: 10, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="storeName"
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                height={70}
                interval={0}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={formatCompactCurrency}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <Tooltip content={<BarChartTooltip />} />
              <Bar
                dataKey="revenue"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.storeId}`}
                    fill={BAR_COLORS[index % BAR_COLORS.length]}
                    onClick={() => handleBarClick(entry.storeId)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store / Marketplace</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">AOV</TableHead>
              <TableHead className="text-right">% Share</TableHead>
              <TableHead className="text-center">7-Day Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No data available.
                </TableCell>
              </TableRow>
            ) : (
              (showAllRows ? sortedData : sortedData.slice(0, MAX_TABLE_ROWS)).map((store) => (
                <TableRow
                  key={store.storeId}
                  className="cursor-pointer"
                  onClick={() => handleBarClick(store.storeId)}
                >
                  <TableCell className="font-medium">{store.storeName}</TableCell>
                  <TableCell className="text-right">
                    {numberFormatter.format(store.orderCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {currencyFormatter.format(store.revenue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {currencyFormatter.format(store.averageOrderValue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {store.sharePercent.toFixed(1)}%
                  </TableCell>
                  <TableCell className="flex justify-center">
                    <Sparkline data={store.sparkline} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {sortedData.length > MAX_TABLE_ROWS && (
          <button
            type="button"
            onClick={() => setShowAllRows((prev) => !prev)}
            className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            {showAllRows
              ? 'Show less'
              : `Show all ${sortedData.length} marketplaces`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
