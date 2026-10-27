// Chart.js utility functions — formatters, tooltip config, event annotations
import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import type { SalesEvent, Granularity } from '../types';

// ─── Number formatters ──────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

const compactFmt = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Format a number as GBP currency, e.g. "£1,234.56"
 */
export function formatCurrency(value: number): string {
  return currencyFmt.format(value);
}

/**
 * Compact number formatting, e.g. "1.2K", "3.4M"
 */
export function formatCompact(value: number): string {
  return compactFmt.format(value);
}

/**
 * Format as percentage with 1 decimal, e.g. "42.5%"
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ─── Period formatter ────────────────────────────────────────────────

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a period string based on granularity.
 * - monthly:  "2025-01" → "Jan 2025"
 * - weekly:   "2025-W12" → "W12 2025"
 * - daily:    "2025-03-15" → "15 Mar"
 */
export function formatPeriod(period: string, granularity: Granularity): string {
  switch (granularity) {
    case 'monthly': {
      const [year, month] = period.split('-');
      const monthIdx = parseInt(month, 10) - 1;
      return `${monthNames[monthIdx] ?? month} ${year}`;
    }
    case 'weekly': {
      // Expect "2025-W12" or similar
      const match = period.match(/(\d{4})-?W(\d+)/i);
      if (match) return `W${match[2]} ${match[1]}`;
      return period;
    }
    case 'daily': {
      const parts = period.split('-');
      if (parts.length === 3) {
        const monthIdx = parseInt(parts[1], 10) - 1;
        return `${parseInt(parts[2], 10)} ${monthNames[monthIdx] ?? parts[1]}`;
      }
      return period;
    }
    default:
      return period;
  }
}

// ─── Tooltip config ──────────────────────────────────────────────────

/**
 * Shared Chart.js tooltip options with consistent styling.
 * Optionally pass a `formatFn` to format the tooltip value label.
 */
export function createTooltipConfig(
  formatFn?: (value: number) => string
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    enabled: true,
    backgroundColor: 'rgba(255, 255, 255, 1)',
    titleColor: '#1f2937',
    bodyColor: '#374151',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    cornerRadius: 6,
    padding: 10,
    boxPadding: 4,
    bodySpacing: 4,
    titleSpacing: 4,
    usePointStyle: true,
  };

  if (formatFn) {
    config.callbacks = {
      label(ctx: { dataset: { label?: string }; parsed: { y?: number } }) {
        const label = ctx.dataset.label ?? '';
        const val = ctx.parsed?.y ?? 0;
        return `${label}: ${formatFn(val)}`;
      },
    };
  }

  return config;
}

// ─── Event annotations ──────────────────────────────────────────────

/** Semi-transparent palette for event category bands */
const EVENT_CATEGORY_COLORS: Record<string, string> = {
  sporting: 'rgba(59, 130, 246, 0.08)',   // blue
  retail: 'rgba(249, 115, 22, 0.08)',      // orange
  cultural: 'rgba(139, 92, 246, 0.08)',    // violet
  weather: 'rgba(34, 197, 94, 0.08)',      // green
};

const EVENT_BORDER_COLORS: Record<string, string> = {
  sporting: 'rgba(59, 130, 246, 0.3)',
  retail: 'rgba(249, 115, 22, 0.3)',
  cultural: 'rgba(139, 92, 246, 0.3)',
  weather: 'rgba(34, 197, 94, 0.3)',
};

const EVENT_LABEL_COLORS: Record<string, string> = {
  sporting: '#2563eb',
  retail: '#c2410c',
  cultural: '#7c3aed',
  weather: '#16a34a',
};

/**
 * Convert SalesEvent[] into chartjs-plugin-annotation box annotation configs.
 * Maps event dates to label indices on a category x-axis.
 *
 * @param events     Array of SalesEvent
 * @param periods    Raw period strings from the API (e.g. ["2025-01", "2025-02", ...])
 * @param granularity The chart granularity to determine period matching
 */
export function createEventAnnotations(
  events: SalesEvent[],
  periods: string[] = [],
  granularity: Granularity = 'monthly',
): AnnotationOptions[] {
  if (!periods.length) return [];

  return events
    .filter((evt) => evt.eventCategory)
    .map((evt) => {
      const startIdx = findPeriodIndex(evt.eventStartDate, periods, granularity);
      const endIdx = findPeriodIndex(evt.eventEndDate, periods, granularity);

      // Skip events outside the chart range entirely
      if (startIdx === -1 && endIdx === -1) return null;

      const xMin = startIdx >= 0 ? startIdx - 0.4 : 0;
      const xMax = endIdx >= 0 ? endIdx + 0.4 : periods.length - 1;

      const cat = evt.eventCategory.toLowerCase();

      return {
        type: 'box' as const,
        xMin,
        xMax,
        backgroundColor: EVENT_CATEGORY_COLORS[cat] ?? 'rgba(107, 114, 128, 0.08)',
        borderColor: EVENT_BORDER_COLORS[cat] ?? 'rgba(107, 114, 128, 0.3)',
        borderWidth: 1,
      };
    })
    .filter(Boolean) as AnnotationOptions[];
}

/**
 * Find the index in periods array that contains the given date.
 * For monthly: "2025-06-14" matches period "2025-06"
 * For weekly:  matches the week start that contains the date
 * For daily:   exact match on "2025-06-14"
 */
function findPeriodIndex(date: string, periods: string[], granularity: Granularity): number {
  if (!date) return -1;
  const d = date.slice(0, 10); // normalize to YYYY-MM-DD

  switch (granularity) {
    case 'monthly': {
      const ym = d.slice(0, 7); // "2025-06"
      return periods.findIndex((p) => p === ym);
    }
    case 'daily':
      return periods.findIndex((p) => p === d);
    case 'weekly': {
      // periods are week-start dates like "2025-06-09"
      // find the period whose week contains this date
      const dt = new Date(d).getTime();
      for (let i = 0; i < periods.length; i++) {
        const weekStart = new Date(periods[i]).getTime();
        const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
        if (dt >= weekStart && dt < weekEnd) return i;
      }
      return -1;
    }
    default:
      return -1;
  }
}

/** Get the solid label color for an event category */
export function getEventCategoryColor(category: string): string {
  return EVENT_LABEL_COLORS[category?.toLowerCase()] ?? '#6b7280';
}

