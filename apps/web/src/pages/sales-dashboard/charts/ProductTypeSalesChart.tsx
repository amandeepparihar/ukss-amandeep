/**
 * Product Type Sales — Doughnut Chart
 *
 * Shows revenue breakdown by product type as a donut chart.
 * Top 8 types shown individually; remaining types grouped as "Other".
 */

import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { getChartColor } from '../lib/chart-theme';
import { formatCurrency, formatCompact, formatPercent } from '../lib/chart-utils';
import type { ProductTypeSalesResponse, ProductTypeSalesSummary, ChartProps } from '../types';

const OTHER_COLOR = '#9ca3af'; // gray-400
const MAX_SEGMENTS = 8;

export default function ProductTypeSalesChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<ProductTypeSalesResponse>({
    endpoint: 'product-type-sales',
    params: { startDate, endDate },
  });

  const isEmpty = !data || !data.summary || data.summary.length === 0;

  const { chartData, summaryLookup } = useMemo(() => {
    if (!data?.summary?.length) {
      return {
        chartData: null,
        summaryLookup: new Map<string, ProductTypeSalesSummary>(),
      };
    }

    // Already sorted by totalRevenue desc from API
    const sorted = [...data.summary];
    const top = sorted.slice(0, MAX_SEGMENTS);
    const rest = sorted.slice(MAX_SEGMENTS);

    const labels: string[] = top.map((t) => t.typeName);
    const values: number[] = top.map((t) => t.totalRevenue);
    const colors: string[] = top.map((_, i) => getChartColor(i));

    // Build lookup for tooltip details
    const lookup = new Map<string, ProductTypeSalesSummary>();
    for (const item of top) {
      lookup.set(item.typeName, item);
    }

    // Aggregate "Other" segment
    if (rest.length > 0) {
      const otherRevenue = rest.reduce((sum, t) => sum + t.totalRevenue, 0);
      const otherUnits = rest.reduce((sum, t) => sum + t.totalUnitsSold, 0);
      const otherOrders = rest.reduce((sum, t) => sum + t.totalOrders, 0);
      const totalRevenue = data.summary.reduce((sum, t) => sum + t.totalRevenue, 0);
      const otherPct = totalRevenue > 0
        ? Math.round((otherRevenue / totalRevenue) * 10000) / 100
        : 0;

      labels.push('Other');
      values.push(otherRevenue);
      colors.push(OTHER_COLOR);

      lookup.set('Other', {
        typeId: -1,
        typeName: 'Other',
        totalOrders: otherOrders,
        totalUnitsSold: otherUnits,
        totalRevenue: otherRevenue,
        percentageOfTotal: otherPct,
      });
    }

    const cd: ChartData<'doughnut'> = {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };

    return { chartData: cd, summaryLookup: lookup };
  }, [data]);

  const options = useMemo<ChartOptions<'doughnut'>>(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right' as const,
          labels: {
            usePointStyle: true,
            padding: 16,
            font: { size: 12 },
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
              const typeName = ctx.label ?? '';
              const entry = summaryLookup.get(typeName);
              if (!entry) return typeName;

              const lines: string[] = [];
              lines.push(`Revenue: ${formatCurrency(entry.totalRevenue)}`);
              lines.push(`Units: ${formatCompact(entry.totalUnitsSold)}`);
              lines.push(`Share: ${formatPercent(entry.percentageOfTotal)}`);
              return lines;
            },
          },
        },
      },
    };
  }, [summaryLookup]);

  return (
    <ChartCard
      title="Product Type Sales"
      description="Revenue breakdown by product type"
      isLoading={isLoading}
      isError={isError}
      isEmpty={isEmpty}
      onRetry={() => refetch()}
    >
      <div style={{ height: 350 }}>
        {chartData && <Doughnut data={chartData} options={options} />}
      </div>
    </ChartCard>
  );
}
