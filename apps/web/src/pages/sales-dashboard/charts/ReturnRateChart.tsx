import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { CHART_COLORS, SEMANTIC_COLORS } from '../lib/chart-theme';
import { formatPercent, formatPeriod } from '../lib/chart-utils';
import type { ReturnRateResponse, ChartProps } from '../types';

// ─── Reason color mapping ────────────────────────────────────────────

const REASON_COLORS: Record<string, string> = {
  'Too Small': CHART_COLORS[0],
  'Too Big': CHART_COLORS[1],
  'Not as Expected': CHART_COLORS[3],
  'Faulty': CHART_COLORS[4],
  'Wrong Item': CHART_COLORS[5],
  'Multiple Size': CHART_COLORS[6],
  'Other': CHART_COLORS[7],
  'Unknown': CHART_COLORS[8],
};

function getReasonColor(reason: string): string {
  return REASON_COLORS[reason] ?? CHART_COLORS[8];
}

// ─── Main component ─────────────────────────────────────────────────

export default function ReturnRateChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<ReturnRateResponse>({
    endpoint: 'return-rate',
    params: { startDate, endDate },
  });

  // ─── Bar chart data (horizontal stacked) ─────────────────────────

  const barData = useMemo<ChartData<'bar'> | null>(() => {
    if (!data?.byType?.length) return null;
    const top5 = data.byType.slice(0, 5);

    // Collect all unique reasons across displayed types
    const allReasons = [
      ...new Set(top5.flatMap((t) => t.reasons.map((r) => r.reason))),
    ];

    return {
      labels: top5.map(
        (t) => t.typeName + (t.exceedsThreshold ? ' \u26A0' : ''),
      ),
      datasets: allReasons.map((reason) => ({
        label: reason,
        data: top5.map((t) => {
          const r = t.reasons.find((rr) => rr.reason === reason);
          return r ? r.percentage : 0;
        }),
        backgroundColor: getReasonColor(reason),
      })),
    };
  }, [data]);

  const barOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y' as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: { usePointStyle: true, padding: 8, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${formatPercent(ctx.parsed.x ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          max: 100,
          title: { display: true, text: 'Return Rate %' },
        },
        y: { stacked: true },
      },
    }),
    [],
  );

  // ─── Trend line data ──────────────────────────────────────────────

  const trendData = useMemo<ChartData<'line'> | null>(() => {
    if (!data?.trend?.length) return null;
    return {
      labels: data.trend.map((t) => formatPeriod(t.period, 'monthly')),
      datasets: [
        {
          label: 'Return Rate',
          data: data.trend.map((t) => t.returnRate),
          borderColor: SEMANTIC_COLORS.danger,
          backgroundColor: `${SEMANTIC_COLORS.danger}33`,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    };
  }, [data]);

  const trendOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Return Rate: ${formatPercent(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        y: {
          min: 0,
          ticks: { callback: (v) => `${v}%` },
        },
      },
    }),
    [],
  );

  // ─── Alert badge ──────────────────────────────────────────────────

  const alertCount =
    data?.byType?.filter((t) => t.exceedsThreshold).length ?? 0;

  return (
    <ChartCard
      title="Return Rate by Product Type"
      description="Top product types by return rate with reasons"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.byType?.length}
      onRetry={() => refetch()}
      actions={
        alertCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {alertCount} above {data?.alertThreshold ?? 15}%
          </span>
        ) : undefined
      }
    >
      <div>
        <div style={{ height: 220 }}>
          {barData && <Bar data={barData} options={barOptions} />}
        </div>
        <p className="mt-3 mb-1 text-xs font-medium text-gray-500">
          Monthly Trend
        </p>
        <div style={{ height: 120 }}>
          {trendData && <Line data={trendData} options={trendOptions} />}
        </div>
      </div>
    </ChartCard>
  );
}
