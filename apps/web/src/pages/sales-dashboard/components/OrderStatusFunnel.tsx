/**
 * OrderStatusFunnel Component
 *
 * Displays the order processing pipeline as a horizontal bar chart funnel,
 * processing time metrics, and per-store shipped rate table. Cancelled
 * orders are shown as a separate metric outside the main funnel flow.
 *
 * @taskId 27
 */

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
  Cell,
} from 'recharts';
import { AlertTriangle, Clock, XCircle, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { OrderFunnel } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderStatusFunnelProps {
  startDate: string;
  endDate: string;
  stores: number[];
}

interface FunnelDataPoint {
  name: string;
  value: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Descending color palette for funnel stages (warm to cool) */
const FUNNEL_COLORS = {
  'Total Received': '#6366f1', // indigo-500
  Pending: '#f59e0b',         // amber-500
  Processing: '#3b82f6',      // blue-500
  Shipped: '#22c55e',         // green-500
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a nullable hours value to a display string.
 * Returns "N/A" for null values.
 */
function formatHours(hours: number | null): string {
  if (hours === null || hours === undefined) return 'N/A';
  return `${hours.toFixed(1)}h`;
}

/**
 * Returns the row background class based on shipped rate threshold.
 * < 60% = red, < 80% = amber, >= 80% = default
 */
function getShippedRateRowClass(rate: number): string {
  if (rate < 60) return 'bg-red-50 dark:bg-red-950/30';
  if (rate < 80) return 'bg-amber-50 dark:bg-amber-950/30';
  return '';
}

/**
 * Returns the badge variant for shipped rate.
 */
function getShippedRateBadgeVariant(rate: number): 'destructive' | 'warning' | 'success' {
  if (rate < 60) return 'destructive';
  if (rate < 80) return 'warning';
  return 'success';
}

/**
 * Formats a number with comma separators.
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Calculates percentage of a value relative to a total.
 * Returns 0 when total is 0 to avoid division by zero.
 */
function percentOf(value: number, total: number): string {
  if (total === 0) return '0.0';
  return ((value / total) * 100).toFixed(1);
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface CustomTooltipProps {
  active?: boolean;
  payload?: { value: number; payload: FunnelDataPoint }[];
  totalReceived: number;
}

function FunnelTooltip({ active, payload, totalReceived }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const pct = percentOf(item.value, totalReceived);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{item.payload.name}</p>
      <p className="text-sm text-muted-foreground">
        {formatNumber(item.value)} orders ({pct}%)
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FunnelChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-[85%]" />
      <Skeleton className="h-8 w-[60%]" />
      <Skeleton className="h-8 w-[30%]" />
      <Skeleton className="h-8 w-[70%]" />
    </div>
  );
}

function ProcessingTimeBadges({
  avgTimeToProcessingHours,
  avgTimeToShippedHours,
  avgTotalProcessingHours,
}: Pick<OrderFunnel, 'avgTimeToProcessingHours' | 'avgTimeToShippedHours' | 'avgTotalProcessingHours'>) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className="gap-1.5 px-3 py-1">
        <Clock className="h-3.5 w-3.5 text-blue-500" />
        Avg {formatHours(avgTimeToProcessingHours)} to Processing
      </Badge>
      <Badge variant="outline" className="gap-1.5 px-3 py-1">
        <Clock className="h-3.5 w-3.5 text-green-500" />
        Avg {formatHours(avgTimeToShippedHours)} to Shipped
      </Badge>
      <Badge variant="outline" className="gap-1.5 px-3 py-1">
        <Timer className="h-3.5 w-3.5 text-indigo-500" />
        Avg {formatHours(avgTotalProcessingHours)} Total
      </Badge>
    </div>
  );
}

function SeparateMetrics({
  cancelled,
  totalReceived,
}: {
  cancelled: number;
  totalReceived: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <XCircle className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium">{formatNumber(cancelled)}</p>
        <p className="text-xs text-muted-foreground">
          Cancelled ({percentOf(cancelled, totalReceived)}%)
        </p>
      </div>
    </div>
  );
}

function PerStoreTable({
  perStore,
}: {
  perStore: OrderFunnel['perStore'];
}) {
  if (!perStore || perStore.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No per-store data available for this period.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-medium">Shipped Rate by Store</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Store</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Shipped</TableHead>
            <TableHead className="text-right">Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {perStore.map((store) => (
            <TableRow
              key={store.storeId}
              className={cn(getShippedRateRowClass(store.shippedRate))}
            >
              <TableCell className="font-medium">{store.storeName}</TableCell>
              <TableCell className="text-right">{formatNumber(store.total)}</TableCell>
              <TableCell className="text-right">{formatNumber(store.shipped)}</TableCell>
              <TableCell className="text-right">
                <Badge variant={getShippedRateBadgeVariant(store.shippedRate)}>
                  {store.shippedRate.toFixed(1)}%
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function OrderStatusFunnel({ startDate, endDate, stores }: OrderStatusFunnelProps) {
  // ---- Data fetching ----
  const { data, isLoading, isError, error } = useQuery<OrderFunnel>({
    queryKey: ['order-funnel', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/sales-dashboard/order-funnel', {
          params: {
            startDate,
            endDate,
            stores: stores.join(','),
          },
        })
        .then((r) => r.data.data),
  });

  // ---- Prepare funnel chart data ----
  const funnelData = useMemo<FunnelDataPoint[]>(() => {
    if (!data) return [];
    return [
      { name: 'Total Received', value: data.totalReceived, color: FUNNEL_COLORS['Total Received'] },
      { name: 'Pending', value: data.pending, color: FUNNEL_COLORS['Pending'] },
      { name: 'Processing', value: data.processing, color: FUNNEL_COLORS['Processing'] },
      { name: 'Shipped', value: data.shipped, color: FUNNEL_COLORS['Shipped'] },
    ];
  }, [data]);

  // ---- Loading state ----
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order Status Funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FunnelChartSkeleton />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-7 w-40" />
          </div>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ---- Error state ----
  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order Status Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Failed to load order funnel data
              {error instanceof Error ? `: ${error.message}` : '.'}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Empty state ----
  if (data.totalReceived === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order Status Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No orders found for the selected period and stores.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Render ----
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Order Status Funnel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Horizontal Bar Chart */}
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={funnelData}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                content={
                  <FunnelTooltip totalReceived={data.totalReceived} />
                }
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                {funnelData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Processing Time Badges */}
        <ProcessingTimeBadges
          avgTimeToProcessingHours={data.avgTimeToProcessingHours}
          avgTimeToShippedHours={data.avgTimeToShippedHours}
          avgTotalProcessingHours={data.avgTotalProcessingHours}
        />

        {/* Cancelled Orders Metric */}
        <SeparateMetrics
          cancelled={data.cancelled}
          totalReceived={data.totalReceived}
        />

        {/* Per-Store Shipped Rate Table */}
        <PerStoreTable perStore={data.perStore} />
      </CardContent>
    </Card>
  );
}
