import './lib/chart-setup';

import { useState, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useChartData } from './lib/useChartData';
import type { SalesEvent } from './types';

const TeamSalesChart = lazy(() => import('./charts/TeamSalesChart'));
const GenderSalesChart = lazy(() => import('./charts/GenderSalesChart'));
const PersonalisationChart = lazy(() => import('./charts/PersonalisationChart'));
const ProductTypeSalesChart = lazy(() => import('./charts/ProductTypeSalesChart'));
const OrderHealthChart = lazy(() => import('./charts/OrderHealthChart'));
// const DailyRevenueHeatmap = lazy(() => import('./charts/DailyRevenueHeatmap'));
const RevenueDayHourChart = lazy(() => import('./charts/RevenueDayHourChart'));
const CustomerSegmentsChart = lazy(() => import('./charts/CustomerSegmentsChart'));
const ReturnRateChart = lazy(() => import('./charts/ReturnRateChart'));
const InventoryQuadrantChart = lazy(() => import('./charts/InventoryQuadrantChart'));
const GeoRevenueMap = lazy(() => import('./charts/GeoRevenueMap'));

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export default function SalesDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [showEventOverlay, setShowEventOverlay] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const defaults = getDefaultDateRange();
  const startDate = searchParams.get('startDate') || defaults.startDate;
  const endDate = searchParams.get('endDate') || defaults.endDate;
  const dateParams = { startDate, endDate };

  const setDateRange = useCallback(
    (update: Partial<{ startDate: string; endDate: string }>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (update.startDate) next.set('startDate', update.startDate);
        if (update.endDate) next.set('endDate', update.endDate);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  // Fetch events for overlay
  const eventsQuery = useChartData<SalesEvent[]>({
    endpoint: 'events',
    params: dateParams,
  });

  // Refresh ALL dashboard charts by invalidating all sales-dashboard queries
  // with noCache to bust the server-side Redis cache
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Fetch each active endpoint with noCache to bust Redis cache
      const endpoints = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['sales-dashboard'] })
        .map((q) => q.queryKey[1] as string)
        .filter((v, i, a) => a.indexOf(v) === i);

      await Promise.all(
        endpoints.map(async (endpoint) => {
          const noCacheParams = new URLSearchParams({ ...dateParams, noCache: 'true' });
          try {
            await api.get(`/sales-dashboard/${endpoint}?${noCacheParams.toString()}`);
          } catch {
            // individual endpoint failures shouldn't block others
          }
        }),
      );

      // Now invalidate all cached queries so they refetch with fresh data
      await queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, dateParams]);

  return (
    <div>
      <PageHeader
        title="Sales Dashboard"
        description="Sales analytics overview with trends, breakdowns, and event overlays"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      />

      {/* Global Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="start-date">Start Date</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setDateRange({ startDate: e.target.value })}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="end-date">End Date</Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setDateRange({ endDate: e.target.value })}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <Switch
            id="event-overlay"
            checked={showEventOverlay}
            onCheckedChange={setShowEventOverlay}
          />
          <Label htmlFor="event-overlay">Event Overlays</Label>
        </div>
      </div>

      {/* Chart Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={null}>
          <TeamSalesChart
            startDate={startDate}
            endDate={endDate}
            events={eventsQuery.data ?? []}
            showEventOverlay={showEventOverlay}
          />
        </Suspense>

        <Suspense fallback={null}>
          <ProductTypeSalesChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <GenderSalesChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <PersonalisationChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <OrderHealthChart startDate={startDate} endDate={endDate} />
        </Suspense>

        {/* ─── V2 Charts ──────────────────────────────────────────── */}

        {/* <Suspense fallback={null}>
          <DailyRevenueHeatmap startDate={startDate} endDate={endDate} />
        </Suspense> */}

        <Suspense fallback={null}>
          <RevenueDayHourChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <CustomerSegmentsChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <ReturnRateChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <InventoryQuadrantChart startDate={startDate} endDate={endDate} />
        </Suspense>

        <Suspense fallback={null}>
          <GeoRevenueMap startDate={startDate} endDate={endDate} />
        </Suspense>

      </div>
    </div>
  );
}
