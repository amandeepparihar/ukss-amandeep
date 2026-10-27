import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { getChartColor } from '../lib/chart-theme';
import { formatCurrency, formatCompact } from '../lib/chart-utils';
import type { RevenueDayHourResponse, ChartProps } from '../types';

// ─── Component ────────────────────────────────────────────────────────

export default function RevenueDayHourChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<RevenueDayHourResponse>({
    endpoint: 'revenue-day-hour',
    params: { startDate, endDate },
  });

  // ── Day-of-week chart (horizontal bar) ─────────────────────────────

  const dayChartData = useMemo<ChartData<'bar'> | null>(() => {
    if (!data?.byDay?.length) return null;
    return {
      labels: data.byDay.map((d) => d.dayName),
      datasets: [
        {
          label: 'Avg Revenue',
          data: data.byDay.map((d) => d.avgRevenue),
          backgroundColor: data.byDay.map((_, i) => getChartColor(i, 0.8)),
          borderColor: data.byDay.map((_, i) => getChartColor(i)),
          borderWidth: 1,
        },
      ],
    };
  }, [data]);

  const dayOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y' as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Avg: ${formatCurrency(ctx.parsed.x ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { callback: (v) => formatCompact(Number(v)) },
        },
      },
    }),
    [],
  );

  // ── Hour-of-day chart (vertical bar) ───────────────────────────────

  const hourChartData = useMemo<ChartData<'bar'> | null>(() => {
    if (!data?.byHour?.length) return null;
    return {
      labels: data.byHour.map((h) => `${h.hour}:00`),
      datasets: [
        {
          label: 'Avg Revenue',
          data: data.byHour.map((h) => h.avgRevenue),
          backgroundColor: getChartColor(0, 0.7),
          borderColor: getChartColor(0),
          borderWidth: 1,
        },
      ],
    };
  }, [data]);

  const hourOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Avg: ${formatCurrency(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: { callback: (v) => formatCompact(Number(v)) },
        },
      },
    }),
    [],
  );

  return (
    <ChartCard
      title="Revenue by Day & Hour"
      description="Average revenue distribution"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.byDay?.length && !data?.byHour?.length}
      onRetry={() => refetch()}
      className="lg:col-span-2"
    >
      <div className="flex gap-4" style={{ height: 300 }}>
        <div className="flex-1">
          <p className="mb-1 text-xs font-medium text-gray-500">By Day of Week</p>
          {dayChartData && <Bar data={dayChartData} options={dayOptions} />}
        </div>
        <div className="flex-1">
          <p className="mb-1 text-xs font-medium text-gray-500">By Hour of Day</p>
          {hourChartData && <Bar data={hourChartData} options={hourOptions} />}
        </div>
      </div>
    </ChartCard>
  );
}
