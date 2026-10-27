import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format, startOfQuarter, startOfYear, subMonths } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { KPISummaryCards } from './components/KPISummaryCards';
import { RevenueTrendChart } from './components/RevenueTrendChart';
import { MarketplaceBreakdown } from './components/MarketplaceBreakdown';

const formatDate = (d: Date): string => format(d, 'yyyy-MM-dd');

type PresetKey = 'thisQuarter' | 'thisYear' | 'last12Months';

const PRESETS: { key: PresetKey; label: string; getRange: () => { start: string; end: string } }[] = [
  {
    key: 'thisQuarter',
    label: 'This Quarter',
    getRange: () => ({ start: formatDate(startOfQuarter(new Date())), end: formatDate(new Date()) }),
  },
  {
    key: 'thisYear',
    label: 'This Year',
    getRange: () => ({ start: formatDate(startOfYear(new Date())), end: formatDate(new Date()) }),
  },
  {
    key: 'last12Months',
    label: 'Last 12 Months',
    getRange: () => ({ start: formatDate(subMonths(new Date(), 12)), end: formatDate(new Date()) }),
  },
];

function getDefaultRange() {
  return PRESETS.find((p) => p.key === 'last12Months')!.getRange();
}

function detectPreset(startDate: string, endDate: string): PresetKey | 'custom' {
  for (const preset of PRESETS) {
    const { start, end } = preset.getRange();
    if (start === startDate && end === endDate) return preset.key;
  }
  return 'custom';
}

/**
 * Tracks the oldest `dataUpdatedAt` across the given TanStack Query keys —
 * the conservative "last updated" timestamp for the page, so it never claims
 * fresher data than its stalest section actually has. Reads the query cache
 * directly rather than lifting each chart's query state into this page.
 */
function useLastUpdated(queryKeys: unknown[][]): Date | null {
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const keysSignature = JSON.stringify(queryKeys);

  useEffect(() => {
    const compute = () => {
      const timestamps = queryKeys
        .map((key) => queryClient.getQueryState(key)?.dataUpdatedAt)
        .filter((t): t is number => typeof t === 'number' && t > 0);
      setLastUpdated(timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null);
    };

    compute();
    const unsubscribe = queryClient.getQueryCache().subscribe(compute);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, keysSignature]);

  return lastUpdated;
}

export default function ExecutiveDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const defaults = getDefaultRange();
  const startDate = searchParams.get('startDate') || defaults.start;
  const endDate = searchParams.get('endDate') || defaults.end;
  const storesParam = searchParams.get('stores') || '';
  const stores = useMemo(
    () => (storesParam ? storesParam.split(',').map(Number).filter((n) => !isNaN(n)) : []),
    [storesParam],
  );

  const activePreset = detectPreset(startDate, endDate);
  const comparePrevious = searchParams.get('comparePrevious') === 'true';

  const setComparePrevious = useCallback(
    (value: boolean) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('comparePrevious', String(value));
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setDateRange = useCallback(
    (update: { startDate: string; endDate: string }) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('startDate', update.startDate);
        next.set('endDate', update.endDate);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const lastUpdated = useLastUpdated([
    ['sales-trends', startDate, endDate, stores, comparePrevious],
    ['sales-kpi', startDate, endDate, stores],
    ['sales-marketplace', startDate, endDate],
  ]);

  return (
    <div>
      <PageHeader
        title="Executive Dashboard"
        description="High-level sales performance summary for leadership review"
      />

      {/* Date Range Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              size="sm"
              className={cn(activePreset === preset.key && 'bg-accent text-accent-foreground')}
              onClick={() => {
                const range = preset.getRange();
                setDateRange({ startDate: range.start, endDate: range.end });
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="exec-start-date" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="exec-start-date"
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setDateRange({ startDate: e.target.value, endDate })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
          <label htmlFor="exec-end-date" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="exec-end-date"
            type="date"
            value={endDate}
            min={startDate}
            max={formatDate(new Date())}
            onChange={(e) => setDateRange({ startDate, endDate: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>

        {lastUpdated && (
          <span className="ml-auto text-xs text-muted-foreground">
            Last updated: {lastUpdated.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        )}
      </div>

      {/* KPI Summary */}
      <div className="mb-6">
        <KPISummaryCards startDate={startDate} endDate={endDate} stores={stores} />
      </div>

      {/* Revenue Trend + Marketplace Comparison */}
      <div className="grid grid-cols-1 gap-6">
        <RevenueTrendChart
          startDate={startDate}
          endDate={endDate}
          stores={stores}
          comparePrevious={comparePrevious}
          onComparePreviousChange={setComparePrevious}
        />
        <MarketplaceBreakdown startDate={startDate} endDate={endDate} />
      </div>
    </div>
  );
}
