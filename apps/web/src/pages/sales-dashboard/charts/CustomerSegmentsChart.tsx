import { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { CHART_COLORS } from '../lib/chart-theme';
import { formatCurrency, formatCompact, formatPercent, formatPeriod } from '../lib/chart-utils';
import type { CustomerSegmentsResponse, ChartProps } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────

function computeMovingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((s, v) => s + v, 0) / window;
  });
}

// ─── Component ────────────────────────────────────────────────────────

export default function CustomerSegmentsChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<CustomerSegmentsResponse>({
    endpoint: 'customer-segments',
    params: { startDate, endDate, granularity: 'monthly' },
  });

  const chartData = useMemo<ChartData | null>(() => {
    if (!data?.timeSeries?.length) return null;

    const labels = data.timeSeries.map((t) => formatPeriod(t.period, 'monthly'));
    const repeatPcts = data.timeSeries.map((t) => t.repeatPercentage);
    const movingAvg = computeMovingAverage(repeatPcts, 3);

    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'New Customer Revenue',
          data: data.timeSeries.map((t) => t.newRevenue),
          backgroundColor: `${CHART_COLORS[0]}cc`,
          stack: 'revenue',
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'bar' as const,
          label: 'Repeat Customer Revenue',
          data: data.timeSeries.map((t) => t.repeatRevenue),
          backgroundColor: `${CHART_COLORS[2]}cc`,
          stack: 'revenue',
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line' as const,
          label: 'Repeat %',
          data: repeatPcts,
          borderColor: CHART_COLORS[4],
          backgroundColor: 'transparent',
          yAxisID: 'y1',
          pointRadius: 3,
          tension: 0.3,
          order: 1,
        },
        {
          type: 'line' as const,
          label: 'Repeat % (3m Avg)',
          data: movingAvg,
          borderColor: CHART_COLORS[4],
          backgroundColor: 'transparent',
          borderDash: [6, 3],
          yAxisID: 'y1',
          pointRadius: 0,
          tension: 0.3,
          order: 1,
        },
      ],
    };
  }, [data]);

  const chartOptions = useMemo<ChartOptions>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: { usePointStyle: true, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.parsed.y ?? 0;
              const yAxisID = (ctx.dataset as unknown as Record<string, unknown>).yAxisID;
              if (yAxisID === 'y1')
                return `${ctx.dataset.label}: ${formatPercent(val)}`;
              return `${ctx.dataset.label}: ${formatCurrency(val)}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          position: 'left' as const,
          title: { display: true, text: 'Revenue (\u00A3)' },
          ticks: { callback: (v) => formatCompact(Number(v)) },
        },
        y1: {
          position: 'right' as const,
          title: { display: true, text: 'Repeat %' },
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => `${v}%` },
        },
      },
    }),
    []
  );

  return (
    <ChartCard
      title="New vs Repeat Customers"
      description="Customer segment revenue with repeat rate trend"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.timeSeries?.length}
      onRetry={() => refetch()}
    >
      <div style={{ height: 350 }}>
        {chartData && <Chart type="bar" data={chartData} options={chartOptions} />}
      </div>
    </ChartCard>
  );
}
