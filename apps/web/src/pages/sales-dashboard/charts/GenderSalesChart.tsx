import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import type { Chart, Plugin, ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { SEMANTIC_COLORS } from '../lib/chart-theme';
import { formatCurrency, formatCompact, formatPercent } from '../lib/chart-utils';
import type { GenderSalesResponse, ChartProps } from '../types';

// ─── Gender color map ─────────────────────────────────────────────────

const GENDER_COLORS: Record<string, string> = {
  Male: SEMANTIC_COLORS.male,
  Female: SEMANTIC_COLORS.female,
  Unisex: SEMANTIC_COLORS.unisex,
  Unspecified: SEMANTIC_COLORS.unspecified,
};

function getGenderColor(gender: string): string {
  return GENDER_COLORS[gender] ?? SEMANTIC_COLORS.unspecified;
}

// ─── Center text plugin ───────────────────────────────────────────────

const centerTextPlugin: Plugin<'doughnut'> = {
  id: 'centerText',
  afterDraw(chart: Chart<'doughnut'>) {
    const { ctx, width, height } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || meta.data.length === 0) return;

    // Calculate total revenue from the raw data
    const dataset = chart.data.datasets[0];
    if (!dataset?.data) return;
    const total = (dataset.data as number[]).reduce((sum, val) => sum + val, 0);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = width / 2;
    const centerY = height / 2;

    // Total revenue value
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = getComputedStyle(chart.canvas).color || '#111';
    ctx.fillText(formatCompact(total), centerX, centerY - 10);

    // Label
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#6b7280'; // gray-500
    ctx.fillText('Total Revenue', centerX, centerY + 12);

    ctx.restore();
  },
};

// ─── Component ────────────────────────────────────────────────────────

export default function GenderSalesChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<GenderSalesResponse>({
    endpoint: 'gender-sales',
    params: { startDate, endDate },
  });

  const chartData = useMemo<ChartData<'doughnut'> | null>(() => {
    if (!data?.summary?.length) return null;

    return {
      labels: data.summary.map((s) => s.gender),
      datasets: [
        {
          data: data.summary.map((s) => s.totalRevenue),
          backgroundColor: data.summary.map((s) => getGenderColor(s.gender)),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 8,
        },
      ],
    };
  }, [data]);

  const chartOptions = useMemo<ChartOptions<'doughnut'>>(() => {
    const summaryMap = new Map(
      (data?.summary ?? []).map((s) => [s.gender, s])
    );

    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            padding: 16,
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(255, 255, 255, 1)',
          titleColor: '#1f2937',
          bodyColor: '#374151',
          borderColor: '#e5e7eb',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          usePointStyle: true,
          callbacks: {
            label(ctx) {
              const gender = ctx.label ?? '';
              const entry = summaryMap.get(gender);
              if (!entry) return gender;

              const lines = [
                ` Units: ${entry.totalUnitsSold.toLocaleString()}`,
                ` Revenue: ${formatCurrency(entry.totalRevenue)}`,
                ` Share: ${formatPercent(entry.percentageOfTotal)}`,
              ];
              return lines;
            },
          },
        },
      },
    };
  }, [data]);

  return (
    <ChartCard
      title="Gender Sales"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.summary?.length}
      onRetry={() => refetch()}
    >
      <div style={{ height: 300, position: 'relative' }}>
        {chartData && (
          <Doughnut
            data={chartData}
            options={chartOptions}
            plugins={[centerTextPlugin]}
          />
        )}
      </div>
    </ChartCard>
  );
}
