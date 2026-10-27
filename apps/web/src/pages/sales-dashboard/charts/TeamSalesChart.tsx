/**
 * Team Sales — Stacked Area Chart
 *
 * Top 5 teams by revenue. Event overlays as shaded bands with one
 * vertical label per period (the primary event for that month).
 */

import { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import { useChartData } from '../lib/useChartData';
import { ChartCard } from '../lib/ChartCard';
import { getChartColor } from '../lib/chart-theme';
import { formatCurrency, formatPeriod, createTooltipConfig } from '../lib/chart-utils';
import type { TeamSalesResponse, SalesEvent } from '../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TeamSalesChartProps {
  startDate: string;
  endDate: string;
  events?: SalesEvent[];
  showEventOverlay?: boolean;
}

// ─── Event overlay helpers ─────────────────────────────────────────────

const CAT_BG: Record<string, string> = {
  sporting: 'rgba(59, 130, 246, 0.08)',
  retail: 'rgba(249, 115, 22, 0.08)',
  commercial: 'rgba(249, 115, 22, 0.08)',
  cultural: 'rgba(139, 92, 246, 0.08)',
  weather: 'rgba(34, 197, 94, 0.08)',
  global: 'rgba(59, 130, 246, 0.08)',
  continental: 'rgba(139, 92, 246, 0.08)',
  domestic: 'rgba(107, 114, 128, 0.06)',
};
const CAT_BORDER: Record<string, string> = {
  sporting: 'rgba(59, 130, 246, 0.25)',
  retail: 'rgba(249, 115, 22, 0.25)',
  commercial: 'rgba(249, 115, 22, 0.25)',
  cultural: 'rgba(139, 92, 246, 0.25)',
  weather: 'rgba(34, 197, 94, 0.25)',
  global: 'rgba(59, 130, 246, 0.25)',
  continental: 'rgba(139, 92, 246, 0.25)',
  domestic: 'rgba(107, 114, 128, 0.2)',
};
const CAT_TEXT: Record<string, string> = {
  sporting: 'rgba(37, 99, 235, 0.7)',
  retail: 'rgba(194, 65, 12, 0.7)',
  commercial: 'rgba(194, 65, 12, 0.7)',
  cultural: 'rgba(124, 58, 237, 0.7)',
  weather: 'rgba(22, 163, 74, 0.7)',
  global: 'rgba(37, 99, 235, 0.7)',
  continental: 'rgba(124, 58, 237, 0.7)',
  domestic: 'rgba(107, 114, 128, 0.7)',
};

/**
 * Pick one event per period, preferring shorter (more specific) events
 * over season-long ones. This ensures Black Friday, Christmas etc.
 * appear instead of being eclipsed by year-long league events.
 */
function buildEventAnnotations(
  events: SalesEvent[],
  periods: string[],
): Record<string, any> | undefined {
  if (!events.length || !periods.length) return undefined;

  // Sort events by duration (shortest first) so specific events
  // like "Black Friday" beat "Premier League 2025-26"
  const sorted = [...events]
    .filter((e) => e.eventCategory && e.eventStartDate && e.eventEndDate)
    .map((e) => {
      const start = new Date(e.eventStartDate!).getTime();
      const end = new Date(e.eventEndDate!).getTime();
      return { evt: e, duration: end - start };
    })
    .sort((a, b) => a.duration - b.duration);

  const used = new Set<string>(); // event names already labeled
  const annotations: Record<string, any> = {};
  const maxIdx = periods.length - 1;

  // Skip the last period — not enough room for vertical text at the edge
  const lastIdx = periods.length - 1;
  for (let p = 0; p < lastIdx; p++) {
    const month = periods[p];

    // Find shortest unused event covering this month
    for (const { evt } of sorted) {
      if (used.has(evt.eventName)) continue;

      const sm = evt.eventStartDate?.slice(0, 7);
      const em = evt.eventEndDate?.slice(0, 7);
      if (month >= sm && month <= em) {
        used.add(evt.eventName);
        const cat = evt.eventCategory!.toLowerCase();

        // Truncate long names to ~25 chars
        const name =
          evt.eventName.length > 25
            ? evt.eventName.slice(0, 24) + '…'
            : evt.eventName;

        // Clip box to chart bounds
        const xMin = Math.max(p - 0.4, -0.5);
        const xMax = Math.min(p + 0.4, maxIdx + 0.5);

        annotations[`evt_${p}`] = {
          type: 'box',
          xMin,
          xMax,
          backgroundColor: CAT_BG[cat] ?? 'rgba(107, 114, 128, 0.06)',
          borderColor: CAT_BORDER[cat] ?? 'rgba(107, 114, 128, 0.2)',
          borderWidth: 1,
          label: {
            display: true,
            content: name,
            rotation: 270,
            position: 'center',
            backgroundColor: 'transparent',
            color: CAT_TEXT[cat] ?? 'rgba(107, 114, 128, 0.7)',
            font: { size: 9 },
            padding: 0,
          },
        };
        break; // only one event per period
      }
    }
  }

  return Object.keys(annotations).length ? annotations : undefined;
}

// ─── Component ─────────────────────────────────────────────────────────

export default function TeamSalesChart({
  startDate,
  endDate,
  events,
  showEventOverlay,
}: TeamSalesChartProps) {
  const [league, setLeague] = useState<string | undefined>(undefined);
  const [continent, setContinent] = useState<string | undefined>(undefined);

  const params = useMemo(() => {
    const p: Record<string, string> = {
      startDate,
      endDate,
      topN: '5',
      granularity: 'monthly',
    };
    if (league) p.league = league;
    if (continent) p.continent = continent;
    return p;
  }, [startDate, endDate, league, continent]);

  const { data, isLoading, isError, refetch } = useChartData<TeamSalesResponse>({
    endpoint: 'team-sales',
    params,
  });

  const leaguesQuery = useChartData<string[]>({
    endpoint: 'team-sales/leagues',
    params: {},
  });

  const continentsQuery = useChartData<string[]>({
    endpoint: 'team-sales/continents',
    params: {},
  });

  const isEmpty = !data || !data.summary || data.summary.length === 0;

  const rawPeriods = useMemo(
    () => data?.timeSeries?.map((ts) => ts.period) ?? [],
    [data],
  );

  const chartData = useMemo<ChartData<'line'> | null>(() => {
    if (!data?.timeSeries?.length || !data?.summary?.length) return null;

    const labels = data.timeSeries.map((ts) => formatPeriod(ts.period, 'monthly'));
    const datasets = data.summary.map((team, index) => ({
      label: team.teamName,
      data: data.timeSeries.map((ts) => {
        const entry = ts.teams.find((t) => t.teamId === team.teamId);
        return entry?.revenue ?? 0;
      }),
      backgroundColor: getChartColor(index, 0.3),
      borderColor: getChartColor(index, 1),
      borderWidth: 1.5,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
    }));

    return { labels, datasets };
  }, [data]);

  const visibleEvents = useMemo(() => {
    if (!showEventOverlay || !events?.length || !rawPeriods.length) return [];
    return events.filter((evt) => {
      if (!evt.eventCategory) return false;
      const sm = evt.eventStartDate?.slice(0, 7);
      const em = evt.eventEndDate?.slice(0, 7);
      return rawPeriods.some((p) => p >= sm && p <= em);
    });
  }, [events, showEventOverlay, rawPeriods]);

  const options = useMemo<ChartOptions<'line'>>(() => {
    const annotations = showEventOverlay
      ? buildEventAnnotations(visibleEvents, rawPeriods)
      : undefined;

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 45 },
        },
        y: {
          stacked: true,
          ticks: { callback: (value) => formatCurrency(Number(value)) },
          grid: { color: '#e5e7eb' },
        },
      },
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            padding: 12,
            font: { size: 11 },
            boxWidth: 8,
          },
        },
        tooltip: {
          ...createTooltipConfig(formatCurrency),
          filter(item: any) { return (item.parsed?.y ?? 0) > 0; },
        } as any,
        annotation: annotations ? { clip: true, annotations } : undefined,
      },
    };
  }, [visibleEvents, showEventOverlay, rawPeriods]);

  const filterControls = (
    <>
      <Select
        value={league ?? '__all__'}
        onValueChange={(v) => setLeague(v === '__all__' ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="All Leagues" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Leagues</SelectItem>
          {(leaguesQuery.data ?? []).map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={continent ?? '__all__'}
        onValueChange={(v) => setContinent(v === '__all__' ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="All Continents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Continents</SelectItem>
          {(continentsQuery.data ?? []).map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <ChartCard
      title="Team Sales"
      description="Revenue by team/club over time"
      isLoading={isLoading}
      isError={isError}
      isEmpty={isEmpty}
      actions={filterControls}
      onRetry={() => refetch()}
    >
      <div style={{ height: 400 }}>
        {chartData && <Line data={chartData} options={options} />}
      </div>
    </ChartCard>
  );
}
