import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { SEMANTIC_COLORS } from '../lib/chart-theme';
import { formatCurrency, formatCompact, createTooltipConfig } from '../lib/chart-utils';
import { Card, CardContent } from '@/components/ui/card';
import type { PersonalisationResponse, SalesEvent } from '../types';

interface PersonalisationChartProps {
  startDate: string;
  endDate: string;
  events?: SalesEvent[];
}

export function PersonalisationChart({ startDate, endDate }: PersonalisationChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<PersonalisationResponse>({
    endpoint: 'personalisation',
    params: { startDate, endDate, granularity: 'monthly' },
  });

  const isEmpty =
    !data ||
    (data.summary.personalised.totalRevenue === 0 &&
      data.summary.nonPersonalised.totalRevenue === 0);

  const chartData = useMemo<ChartData<'doughnut'>>(() => {
    if (!data) {
      return { labels: [], datasets: [{ data: [] }] };
    }
    return {
      labels: ['Personalised', 'Non-Personalised'],
      datasets: [
        {
          data: [
            data.summary.personalised.totalRevenue,
            data.summary.nonPersonalised.totalRevenue,
          ],
          backgroundColor: [
            SEMANTIC_COLORS.personalised,
            SEMANTIC_COLORS.nonPersonalised,
          ],
          borderColor: ['#ffffff', '#ffffff'],
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };
  }, [data]);

  // Center text rendered as HTML overlay — canvas plugins draw on the same
  // layer as tooltips so they always bleed through.

  const options = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            padding: 16,
          },
        },
        tooltip: {
          ...createTooltipConfig(),
          callbacks: {
            label(ctx: TooltipItem<'doughnut'>) {
              if (!data) return '';
              const segment =
                ctx.label === 'Personalised'
                  ? data.summary.personalised
                  : data.summary.nonPersonalised;
              return [
                `Revenue: ${formatCurrency(segment.totalRevenue)}`,
                `Units Sold: ${formatCompact(segment.totalUnitsSold)}`,
                `Avg Price: ${formatCurrency(
                  segment.totalUnitsSold > 0
                    ? segment.totalRevenue / segment.totalUnitsSold
                    : 0
                )}`,
              ];
            },
          },
        },
      },
    }),
    [data]
  );

  return (
    <ChartCard
      title="Personalisation vs Non-Personalisation"
      description="Revenue split between personalised and standard products"
      isLoading={isLoading}
      isError={isError}
      isEmpty={isEmpty}
      onRetry={() => refetch()}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* Donut chart */}
        <div className="flex-shrink-0 mx-auto md:mx-0" style={{ width: 220, height: 220 }}>
          <Doughnut data={chartData} options={options} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 flex-1">
          <KpiCard
            label="Personalisation Rate"
            value={`${data?.summary.personalised.percentageOfTotal.toFixed(1) ?? '0.0'}%`}
            color={SEMANTIC_COLORS.personalised}
          />
          <KpiCard
            label="Personalised Revenue"
            value={formatCurrency(data?.summary.personalised.totalRevenue ?? 0)}
            color={SEMANTIC_COLORS.personalised}
          />
          <KpiCard
            label="Non-Personalised Revenue"
            value={formatCurrency(data?.summary.nonPersonalised.totalRevenue ?? 0)}
            color={SEMANTIC_COLORS.nonPersonalised}
          />
          <KpiCard
            label="Price Premium"
            value={formatCurrency(data?.personalisationPremium ?? 0)}
            color={SEMANTIC_COLORS.personalised}
          />
        </div>
      </div>
    </ChartCard>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card className="border-l-4" style={{ borderLeftColor: color }}>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default PersonalisationChart;
