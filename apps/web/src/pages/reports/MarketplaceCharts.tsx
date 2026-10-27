import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, BarElement } from 'chart.js';
import '@/pages/sales-dashboard/lib/chart-setup';
import type { MsBreakdownRow, MsDailyRow, MsHourlyRow } from './hooks/useMarketplaceSales';

ChartJS.register(BarElement); // chart-setup registers Line pieces; Bar needs BarElement

const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const lineOpts = { responsive: true, maintainAspectRatio: true, aspectRatio: 2.5,
  plugins: { legend: { position: 'top' as const } } };
const barOpts = { responsive: true, maintainAspectRatio: true, aspectRatio: 3, indexAxis: 'y' as const,
  plugins: { legend: { display: false } } };

export function MarketplaceCharts({ breakdown, daily, hourly, labels, selected }: {
  breakdown: MsBreakdownRow[]; daily: MsDailyRow[]; hourly: MsHourlyRow[]; labels: Record<string, string>; selected: string[];
}) {
  // Revenue bar: all channels, sorted desc (breakdown is already revenue-desc from the API)
  const revenueData = {
    labels: breakdown.map((b) => b.channel),
    datasets: [{ label: 'Revenue', data: breakdown.map((b) => b.revenue),
      backgroundColor: breakdown.map((_, i) => PALETTE[i % PALETTE.length]) }],
  };
  // Daily trend: x = sorted distinct days, one dataset per selected channel
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const dailyData = {
    labels: days,
    datasets: selected.map((site, i) => ({
      label: labels[site] ?? site,
      data: days.map((day) => daily.find((d) => d.day === day && d.orderSite === site)?.orders ?? 0),
      borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], tension: 0.3,
    })),
  };
  // Hourly average: x = 00..23, one dataset per selected channel
  const hourlyData = {
    labels: HOURS,
    datasets: selected.map((site, i) => ({
      label: labels[site] ?? site,
      data: HOURS.map((_, h) => hourly.find((r) => r.orderSite === site && r.hour === h)?.ordersAvg ?? 0),
      borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], tension: 0.3,
    })),
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1">Revenue by channel</p>
        <Bar data={revenueData} options={barOpts} />
      </div>
      <div>
        <p className="text-sm font-medium mb-1">Daily order trend</p>
        <Line data={dailyData} options={lineOpts} />
      </div>
      <div>
        <p className="text-sm font-medium mb-1">Average orders per hour</p>
        <Line data={hourlyData} options={lineOpts} />
      </div>
    </div>
  );
}
