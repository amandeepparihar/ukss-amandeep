// Chart color palettes and design tokens for Sales Dashboard V2

/**
 * 12 categorical colors with good contrast for multi-series charts.
 * Hex values — use `getChartColor()` when you need RGBA with alpha.
 */
export const CHART_COLORS = [
  '#3b82f6', // blue-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#84cc16', // lime-500
  '#a855f7', // purple-500
] as const;

/**
 * Semantic colors for domain-specific dimensions.
 */
export const SEMANTIC_COLORS = {
  male: '#3b82f6',          // blue-500
  female: '#f43f5e',        // rose-500
  unisex: '#8b5cf6',        // violet-500
  unspecified: '#9ca3af',   // gray-400
  personalised: '#14b8a6',  // teal-500
  nonPersonalised: '#9ca3af', // gray-400
  success: '#22c55e',       // green-500
  danger: '#ef4444',        // red-500
} as const;

/**
 * Parse a hex color string into [r, g, b].
 */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

/**
 * Return an RGBA string from the categorical palette.
 * `index` wraps automatically if it exceeds the palette length.
 */
export function getChartColor(index: number, alpha = 1): string {
  const hex = CHART_COLORS[index % CHART_COLORS.length];
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Theme tokens (align with Shadcn CSS variables) ──────────────────

/** Grid lines — subtle, low contrast */
export const GRID_COLOR = '#e5e7eb';

/** Axis / tick border color */
export const BORDER_COLOR = '#e5e7eb';
