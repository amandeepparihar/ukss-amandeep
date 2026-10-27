import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign, Clock, Package, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { KPIData } from '@admin/shared';

interface KPISummaryCardsProps {
  startDate: string;
  endDate: string;
  stores: number[];
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-GB');

/**
 * Renders a comparison badge showing percentage change.
 * Green with up arrow for positive, red with down arrow for negative, muted "N/A" for null.
 */
function ComparisonBadge({ change, label }: { change: number | null; label: string }) {
  if (change === null || change === undefined) {
    return (
      <span className="text-xs text-muted-foreground">N/A {label}</span>
    );
  }

  const isPositive = change > 0;
  const isZero = change === 0;

  if (isZero) {
    return (
      <span className="text-xs text-muted-foreground">
        0% {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {isPositive ? '+' : ''}
      {change.toFixed(1)}% {label}
    </span>
  );
}

/**
 * A single KPI metric card displaying a value, icon, and comparison indicator.
 */
function KPICard({
  title,
  value,
  icon,
  comparison,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  comparison: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="mt-1">{comparison}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton loading state for a single KPI card.
 */
function KPICardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

/**
 * Error state shown in place of the 4-card grid when the KPI query fails —
 * never falls back to a "0"/"£0.00" value, which would be indistinguishable
 * from a real zero-sales period.
 */
function KPICardsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6" />
        <p>Unable to load KPI summary. Try refreshing.</p>
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      </CardContent>
    </Card>
  );
}

/**
 * Executive KPI Summary Cards — headline revenue/orders/AOV/pending metrics
 * for the page-level date range, with period-over-period comparison.
 *
 * Unlike the ops-dashboard version this was adapted from, this component has
 * no internal period tabs: the executive dashboard has one page-level date
 * range control, and this component is driven entirely by startDate/endDate.
 */
export function KPISummaryCards({ startDate, endDate, stores }: KPISummaryCardsProps) {
  const { data, isLoading, isError, refetch } = useQuery<KPIData>({
    queryKey: ['sales-kpi', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/executive-dashboard/kpi', {
          params: {
            startDate,
            endDate,
            stores: stores.length > 0 ? stores.join(',') : undefined,
          },
        })
        .then((r) => r.data.data),
  });

  // Get the first comparison entry (primary "vs Previous Period" comparison)
  const primaryComparison = data?.comparisons?.[0];

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICardSkeleton />
        <KPICardSkeleton />
        <KPICardSkeleton />
        <KPICardSkeleton />
      </div>
    );
  }

  if (isError) {
    return <KPICardsErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KPICard
        title="Total Orders"
        value={numberFormatter.format(data?.totalOrders ?? 0)}
        icon={<ShoppingCart className="h-4 w-4" />}
        comparison={
          <ComparisonBadge
            change={primaryComparison?.ordersChange ?? null}
            label={primaryComparison?.label ?? ''}
          />
        }
      />
      <KPICard
        title="Total Revenue"
        value={currencyFormatter.format(data?.totalRevenue ?? 0)}
        icon={<DollarSign className="h-4 w-4" />}
        comparison={
          <ComparisonBadge
            change={primaryComparison?.revenueChange ?? null}
            label={primaryComparison?.label ?? ''}
          />
        }
      />
      <KPICard
        title="Average Order Value"
        value={currencyFormatter.format(data?.averageOrderValue ?? 0)}
        icon={<Package className="h-4 w-4" />}
        comparison={
          <ComparisonBadge
            change={primaryComparison?.aovChange ?? null}
            label={primaryComparison?.label ?? ''}
          />
        }
      />
      <KPICard
        title="Pending Orders"
        value={numberFormatter.format(data?.pendingOrders ?? 0)}
        icon={<Clock className="h-4 w-4" />}
        comparison={
          <span className="text-xs text-muted-foreground">
            Awaiting processing
          </span>
        }
      />
    </div>
  );
}
