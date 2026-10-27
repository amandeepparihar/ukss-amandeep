import { Line } from 'react-chartjs-2';
// chart-setup registers CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend
// — all components required for a Line chart. Import for side-effect only.
import '@/pages/sales-dashboard/lib/chart-setup';
import type { HourlyRow } from './hooks/useHourlyReport';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c'];

export function lastNDays<T extends { day: string }>(rows: T[], n: number): T[] {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(-n);
}

export function HourlyComparisonChart({ rows }: { rows: HourlyRow[] }) {
  const recent = lastNDays(rows, 5);
  const hourVal = (row: HourlyRow, h: number) =>
    Number((row as Record<string, string | number>)[`h${String(h).padStart(2, '0')}`] ?? 0);

  const dayDatasets = recent.map((row, i) => ({
    label: row.day,
    data: HOURS.map((_, h) => hourVal(row, h)),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length],
    tension: 0.3,
  }));

  // Average orders per hour across the displayed days — a dashed reference
  // baseline to compare each day's curve against.
  const avgDataset = {
    label: 'Average',
    data: HOURS.map((_, h) =>
      recent.length
        ? Math.round((recent.reduce((s, row) => s + hourVal(row, h), 0) / recent.length) * 10) / 10
        : 0,
    ),
    borderColor: '#111827',
    backgroundColor: '#111827',
    borderDash: [6, 4],
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.3,
  };

  const data = { labels: HOURS, datasets: [...dayDatasets, avgDataset] };
  const options = {
    responsive: true,
    // Default Line-chart aspectRatio is 2 (height = width / 2). 2.5 makes the
    // chart 20% shorter (width / 2.5 = 0.8 × previous height) at any width.
    maintainAspectRatio: true,
    aspectRatio: 2.5,
    plugins: { legend: { position: 'top' as const } },
    scales: {
      x: { title: { display: true, text: 'Hour' } },
      y: { title: { display: true, text: 'Orders' }, beginAtZero: true },
    },
  };
  return (
    <div>
      <Line data={data} options={options} />
      {rows.length > 5 && (
        <p className="text-xs text-muted-foreground mt-1">
          Showing last 5 of {rows.length} days.
        </p>
      )}
    </div>
  );
}
