import { useMemo } from 'react';
import { Scatter } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import type { InventoryQuadrantResponse, ChartProps } from '../types';

// ─── Constants ────────────────────────────────────────────────────────

const QUADRANT_COLORS = {
  'fast-movers-risk': { bg: 'rgba(239, 68, 68, 0.7)', zone: 'rgba(239, 68, 68, 0.05)' },
  healthy: { bg: 'rgba(34, 197, 94, 0.7)', zone: 'rgba(34, 197, 94, 0.05)' },
  'slow-stable': { bg: 'rgba(59, 130, 246, 0.7)', zone: 'rgba(59, 130, 246, 0.05)' },
  'dead-stock': { bg: 'rgba(245, 158, 11, 0.7)', zone: 'rgba(245, 158, 11, 0.05)' },
} as const;

const QUADRANT_LABELS = {
  'fast-movers-risk': 'Fast Movers at Risk',
  healthy: 'Healthy Stock',
  'slow-stable': 'Slow but Stable',
  'dead-stock': 'Dead Stock',
} as const;

type QuadrantKey = keyof typeof QUADRANT_COLORS;

// ─── Component ────────────────────────────────────────────────────────

export default function InventoryQuadrantChart({ startDate, endDate }: ChartProps) {
  const { data, isLoading, isError, refetch } = useChartData<InventoryQuadrantResponse>({
    endpoint: 'inventory-quadrant',
    params: { startDate, endDate },
  });

  const chartData = useMemo<ChartData<'scatter'> | null>(() => {
    if (!data?.products?.length) return null;

    const grouped: Record<QuadrantKey, Array<{ x: number; y: number; label: string }>> = {
      'fast-movers-risk': [],
      healthy: [],
      'slow-stable': [],
      'dead-stock': [],
    };

    for (const p of data.products) {
      const q = p.quadrant as QuadrantKey;
      if (grouped[q]) {
        grouped[q].push({
          x: p.turnoverRate,
          y: Math.min(p.daysOfStock, 365),
          label: p.productName,
        });
      }
    }

    return {
      datasets: (Object.keys(grouped) as QuadrantKey[]).map((quadrant) => ({
        label: QUADRANT_LABELS[quadrant],
        data: grouped[quadrant],
        backgroundColor: QUADRANT_COLORS[quadrant].bg,
        pointRadius: 4,
        pointHoverRadius: 6,
      })),
    };
  }, [data]);

  const chartOptions = useMemo<ChartOptions<'scatter'>>(() => {
    const t = data?.thresholds ?? { turnover: 2, stockDays: 60 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: { usePointStyle: true, padding: 12 },
        },
        tooltip: {
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
              const point = ctx.raw as { x: number; y: number; label: string };
              return `${point.label}: Turnover ${point.x.toFixed(1)}, ${point.y.toFixed(0)} days stock`;
            },
          },
        },
        annotation: {
          annotations: {
            turnoverLine: {
              type: 'line' as const,
              xMin: t.turnover,
              xMax: t.turnover,
              borderColor: '#9ca3af',
              borderWidth: 1,
              borderDash: [4, 4],
            },
            stockDaysLine: {
              type: 'line' as const,
              yMin: t.stockDays,
              yMax: t.stockDays,
              borderColor: '#9ca3af',
              borderWidth: 1,
              borderDash: [4, 4],
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Turnover Rate (annualized)' },
          min: 0,
        },
        y: {
          title: { display: true, text: 'Days of Stock Remaining' },
          min: 0,
        },
      },
    };
  }, [data]);

  const summary = data?.summary;

  return (
    <ChartCard
      title="Inventory Quadrant Matrix"
      description="Stock health by turnover rate vs days of stock"
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data?.products?.length}
      onRetry={() => refetch()}
    >
      <div>
        {summary && (
          <div className="mb-3 grid grid-cols-4 gap-2">
            <div
              className={`rounded-lg border p-2 text-center ${
                summary.fastMoversRisk > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'
              }`}
            >
              <p className="text-lg font-bold text-red-600">{summary.fastMoversRisk}</p>
              <p className="text-xs text-gray-500">Fast Movers at Risk</p>
            </div>
            <div className="rounded-lg border border-green-300 bg-green-50 p-2 text-center">
              <p className="text-lg font-bold text-green-600">{summary.healthy}</p>
              <p className="text-xs text-gray-500">Healthy Stock</p>
            </div>
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-2 text-center">
              <p className="text-lg font-bold text-blue-600">{summary.slowStable}</p>
              <p className="text-xs text-gray-500">Slow but Stable</p>
            </div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center">
              <p className="text-lg font-bold text-amber-600">{summary.deadStock}</p>
              <p className="text-xs text-gray-500">Dead Stock</p>
            </div>
          </div>
        )}
        <div style={{ height: 320 }}>
          {chartData && <Scatter data={chartData} options={chartOptions} />}
        </div>
      </div>
    </ChartCard>
  );
}
