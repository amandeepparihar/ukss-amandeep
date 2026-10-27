/**
 * Database date formatting utilities.
 *
 * MySQL DATETIME columns in this codebase are timezone-naive — they are raw
 * calendar dates/times, NOT UTC timestamps. We force UTC display so the
 * browser's local timezone never shifts the date.
 *
 * Example: ship_by_date stores "2024-06-27 23:59:59". Without forcing UTC,
 * a browser in BST (UTC+1) would display "28/06/2024" — the wrong date.
 * With formatDbDate() it always displays "27/06/2024".
 */

/** Format a database DATETIME as a date string (e.g., "27/06/2024"). */
export function formatDbDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

/** Format a database DATETIME as a date+time string (e.g., "27/06/2024, 23:59:59"). */
export function formatDbDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' });
}

/**
 * Format a database DATETIME as a long date string matching Zenc's PHP date('l j F, Y') format.
 * Example: "Thursday 27 June, 2024" (date only — no time component).
 * Used for datePurchased and shipByDate on the order edit page.
 */
export function formatDbLongDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${weekday} ${day} ${month}, ${year}`;
}

/** Format a database DATETIME as YYYY/MM/DD (matches PHP date("Y/m/d")). */
export function formatYMD(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/**
 * Format a database DATETIME as a SQL-style datetime string (e.g., "2024-06-27 13:05:44").
 * Matches Zenc's display of lastScanDate.
 */
export function formatDbSqlDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}
