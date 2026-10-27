/**
 * Daily Revenue Heatmap
 *
 * GitHub-style calendar heatmap showing revenue intensity by day.
 * Uses cal-heatmap library. Supports optional year-over-year comparison.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import CalHeatmap from 'cal-heatmap';
import 'cal-heatmap/cal-heatmap.css';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { formatCurrency } from '../lib/chart-utils';
import type { DailyRevenueResponse, ChartProps } from '../types';

export default function DailyRevenueHeatmap({ startDate, endDate }: ChartProps) {
  const calRef = useRef<HTMLDivElement>(null);
  const calInstance = useRef<CalHeatmap | null>(null);
  const [showPriorYear, setShowPriorYear] = useState(false);

  const params = useMemo(
    () => ({
      startDate,
      endDate,
      comparePriorYear: showPriorYear ? 'true' : 'false',
    }),
    [startDate, endDate, showPriorYear],
  );

  const { data, isLoading, isError, refetch } = useChartData<DailyRevenueResponse>({
    endpoint: 'daily-revenue',
    params,
  });

  // Compute max revenue for color scale
  const maxRevenue = useMemo(() => {
    if (!data?.current?.length) return 1000;
    return Math.max(...data.current.map((d) => d.revenue), 1);
  }, [data]);

  useEffect(() => {
    if (!calRef.current || !data?.current?.length) return;

    // Clean up previous instance
    if (calInstance.current) {
      calInstance.current.destroy();
      calInstance.current = null;
    }

    const cal = new CalHeatmap();
    calInstance.current = cal;

    // Transform data to cal-heatmap format: [{date, value}]
    const calData = data.current.map((d) => ({
      date: d.date,
      value: d.revenue,
    }));

    const startDateObj = new Date(startDate);

    cal.paint({
      itemSelector: calRef.current,
      data: {
        source: calData,
        x: 'date',
        y: 'value',
      },
      date: {
        start: startDateObj,
        locale: 'en',
      },
      range: Math.min(
        12,
        Math.ceil(
          (new Date(endDate).getTime() - startDateObj.getTime()) /
            (30 * 24 * 60 * 60 * 1000),
        ) + 1,
      ),
      domain: {
        type: 'month',
        label: { text: 'MMM', position: 'top' },
      },
      subDomain: {
        type: 'day',
        width: 12,
        height: 12,
        radius: 2,
      },
      scale: {
        color: {
          range: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
          interpolate: 'hsl',
          type: 'linear',
          domain: [0, maxRevenue],
        },
      },
    });

    return () => {
      if (calInstance.current) {
        calInstance.current.destroy();
        calInstance.current = null;
      }
    };
  }, [data, startDate, endDate, maxRevenue]);

  const toggleButton = (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={showPriorYear}
        onChange={(e) => setShowPriorYear(e.target.checked)}
        className="rounded border-gray-300"
      />
      Compare Prior Year
    </label>
  );

  // Build prior year summary if available
  const priorYearInfo = useMemo(() => {
    if (!showPriorYear || !data?.current?.length || !data?.priorYear?.length)
      return null;
    const currentTotal = data.current.reduce((s, d) => s + d.revenue, 0);
    const priorTotal = data.priorYear.reduce((s, d) => s + d.revenue, 0);
    const yoyChange =
      priorTotal > 0
        ? ((currentTotal - priorTotal) / priorTotal) * 100
        : 0;
    return { currentTotal, priorTotal, yoyChange };
  }, [data, showPriorYear]);

  return (
    <ChartCard
      title="Daily Revenue Heatmap"
      description="Revenue intensity by day"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.current?.length}
      onRetry={() => refetch()}
      actions={toggleButton}
      className="lg:col-span-2"
    >
      <div>
        {priorYearInfo && (
          <div className="mb-3 flex gap-4 text-sm text-gray-600">
            <span>Current: {formatCurrency(priorYearInfo.currentTotal)}</span>
            <span>
              Prior Year: {formatCurrency(priorYearInfo.priorTotal)}
            </span>
            <span
              className={
                priorYearInfo.yoyChange >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }
            >
              YoY: {priorYearInfo.yoyChange >= 0 ? '+' : ''}
              {priorYearInfo.yoyChange.toFixed(1)}%
            </span>
          </div>
        )}
        <div ref={calRef} style={{ minHeight: 160, overflow: 'auto' }} />
      </div>
    </ChartCard>
  );
}
