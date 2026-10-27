import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { GeographicData } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeographicBreakdownProps {
  startDate: string;
  endDate: string;
  stores: number[];
}

interface ChartItem {
  country: string;
  orderCount: number;
  revenue: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of countries to display individually in the chart. */
const MAX_BARS = 10;

/** Bar fill colour (indigo-500). */
const BAR_COLOR = '#6366f1';

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

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface GeoTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: ChartItem;
  }>;
  totalOrders: number;
}

function GeoTooltip({ active, payload, totalOrders }: GeoTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0].payload;
  const pct = totalOrders > 0 ? (item.orderCount / totalOrders) * 100 : 0;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <p className="text-sm font-medium">{item.country}</p>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p>Orders: {numberFormatter.format(item.orderCount)}</p>
        <p>Revenue: {currencyFormatter.format(item.revenue)}</p>
        <p>Share: {pct.toFixed(1)}%</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function GeographicBreakdown({
  startDate,
  endDate,
  stores,
}: GeographicBreakdownProps) {
  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<GeographicData[]>({
    queryKey: ['sales-geographic', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/sales-dashboard/geographic', {
          params: { startDate, endDate, stores: stores.join(',') },
        })
        .then((r) => r.data.data),
  });

  // Build chart data: top 10 by orderCount, aggregate the rest into "Others".
  const { chartData, totalOrders } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [] as ChartItem[], totalOrders: 0 };
    }

    const sorted = [...data].sort((a, b) => b.orderCount - a.orderCount);
    const total = sorted.reduce((sum, d) => sum + d.orderCount, 0);

    if (sorted.length <= MAX_BARS) {
      return { chartData: sorted, totalOrders: total };
    }

    const top = sorted.slice(0, MAX_BARS);
    const rest = sorted.slice(MAX_BARS);

    const othersOrderCount = rest.reduce((sum, d) => sum + d.orderCount, 0);
    const othersRevenue = rest.reduce((sum, d) => sum + d.revenue, 0);

    const result: ChartItem[] = [...top];

    // Only add "Others" if there are actual orders in the remaining countries
    if (othersOrderCount > 0) {
      result.push({
        country: 'Others',
        orderCount: othersOrderCount,
        revenue: othersRevenue,
      });
    }

    return { chartData: result, totalOrders: total };
  }, [data]);

  // ---- Loading state ----
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <Skeleton className="h-6 w-56" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ---- Error state ----
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Geographic Sales Distribution</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Failed to load geographic data
              {error instanceof Error ? `: ${error.message}` : '.'}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Empty state ----
  if (!data || data.length === 0 || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Geographic Sales Distribution</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No geographic data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Chart ----
  // Calculate dynamic height: each bar needs ~36px, minimum 200px
  const chartHeight = Math.max(200, chartData.length * 36 + 40);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Geographic Sales Distribution</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="country"
                tick={{ fontSize: 11 }}
                width={100}
                className="text-muted-foreground"
              />
              <Tooltip
                content={<GeoTooltip totalOrders={totalOrders} />}
              />
              <Bar
                dataKey="orderCount"
                fill={BAR_COLOR}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
