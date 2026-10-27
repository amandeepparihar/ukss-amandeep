/**
 * Shared configuration parsing utilities for marketplace adapters.
 */

/**
 * Parse comma-separated number string into array.
 * Used by marketplace configs to parse env vars like FRUUGO_EXCLUDED_MANUFACTURER_IDS.
 */
export function parseNumberArray(value: string | undefined): number[] {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Parse comma-separated string into array.
 * Used by marketplace configs to parse env vars like FRUUGO_KIDS_SIZE_GUIDES.
 */
export function parseStringArray(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
