import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { Card, CardContent } from '@/components/ui/card';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { SEMANTIC_COLORS } from '../lib/chart-theme';
import { formatCompact, formatPercent } from '../lib/chart-utils';
import type { OrderHealthResponse, ChartProps } from '../types';

// ─── Trend color logic ──────────────────────────────────────────────

/**
 * Determine sparkline color based on trend direction.
 * @param values   Time series values
 * @param inverted true for metrics where lower is better (rejection/return rate)
 */
function getTrendColor(values: number[], inverted: boolean): string {
  if (values.length < 2) return '#9ca3af'; // neutral gray
  const first = values[0];
  const last = values[values.length - 1];
  const improving = inverted ? last < first : last > first;
  return improving ? SEMANTIC_COLORS.success : SEMANTIC_COLORS.danger;
}

/**
 * Convert hex color to rgba with given alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Sparkline config builder ────────────────────────────────────────

function buildSparklineData(
  labels: string[],
  values: number[],
  color: string,
): ChartData<'line'> {
  return {
    labels,
    datasets: [
      {
        data: values,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        backgroundColor: hexToRgba(color, 0.1),
        tension: 0.4,
      },
    ],
  };
}

const sparklineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
};

// ─── KPI Card sub-component ─────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sparklineData: ChartData<'line'>;
}

function KpiCard({ label, value, sparklineData }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        <div className="h-[60px] mt-2">
          <Line data={sparklineData} options={sparklineOptions} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ─────────────────────────────────────────────────

interface OrderHealthChartProps extends ChartProps {
  granularity?: 'daily' | 'weekly' | 'monthly';
}

export function OrderHealthChart({ startDate, endDate, granularity = 'monthly' }: OrderHealthChartProps) {
  const params = useMemo(
    () => ({ startDate, endDate, granularity }),
    [startDate, endDate, granularity],
  );

  const { data, isLoading, isError, refetch } = useChartData<OrderHealthResponse>({
    endpoint: 'order-health',
    params,
  });

  const cards = useMemo(() => {
    if (!data) return null;

    const { summary, timeSeries } = data;
    const labels = timeSeries.map((t) => t.period);

    const totalValues = timeSeries.map((t) => t.totalProducts);
    const rejectionValues = timeSeries.map((t) => t.rejectionRate);
    const returnValues = timeSeries.map((t) => t.returnRate);
    const fulfillmentValues = timeSeries.map((t) => t.fulfillmentRate);

    const totalColor = getTrendColor(totalValues, false);
    const rejectionColor = getTrendColor(rejectionValues, true);
    const returnColor = getTrendColor(returnValues, true);
    const fulfillmentColor = getTrendColor(fulfillmentValues, false);

    return [
      {
        label: 'Total Ordered',
        value: formatCompact(summary.totalProductsOrdered),
        sparklineData: buildSparklineData(labels, totalValues, totalColor),
      },
      {
        label: 'Rejection Rate',
        value: formatPercent(summary.productsRejected.rate),
        sparklineData: buildSparklineData(labels, rejectionValues, rejectionColor),
      },
      {
        label: 'Return Rate',
        value: formatPercent(summary.productsReturned.rate),
        sparklineData: buildSparklineData(labels, returnValues, returnColor),
      },
      {
        label: 'Fulfillment Rate',
        value: formatPercent(summary.fulfillmentRate),
        sparklineData: buildSparklineData(labels, fulfillmentValues, fulfillmentColor),
      },
    ];
  }, [data]);

  const isEmpty = !data || data.timeSeries.length === 0;

  return (
    <ChartCard
      title="Order Health"
      description="Rejection, return, and fulfillment rates across all order statuses"
      className="lg:col-span-2"
      isLoading={isLoading}
      isError={isError}
      isEmpty={isEmpty}
      onRetry={() => refetch()}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards?.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={card.value}
            sparklineData={card.sparklineData}
          />
        ))}
      </div>
    </ChartCard>
  );
}

export default OrderHealthChart;
