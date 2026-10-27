import { Page } from '@playwright/test';

export interface Mismatch {
  field: string;
  zencValue: string;
  stock2Value: string;
  orderId?: number;
  category?: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface ComparisonResult {
  orderId?: number;
  category?: string;
  matches: number;
  mismatches: Mismatch[];
  skipped: string[];
}

/**
 * Extract trimmed text content from a single element.
 * Returns empty string if element not found.
 */
export async function extractTextContent(page: Page, selector: string): Promise<string> {
  try {
    const element = page.locator(selector).first();
    const isVisible = await element.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) return '';
    const text = await element.textContent({ timeout: 3000 });
    return (text || '').trim();
  } catch {
    return '';
  }
}

/**
 * Extract all text values from elements matching a selector.
 */
export async function extractAllTexts(page: Page, selector: string): Promise<string[]> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 5000 }).catch(() => null);
    const elements = page.locator(selector);
    const count = await elements.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await elements.nth(i).textContent({ timeout: 3000 });
      texts.push((text || '').trim());
    }
    return texts;
  } catch {
    return [];
  }
}

/**
 * Extract table data as a 2D array of cell text content.
 * Each row is an array of strings.
 */
export async function extractTableData(
  page: Page,
  tableSelector: string,
  rowSelector: string,
  cellSelector: string
): Promise<string[][]> {
  try {
    await page.waitForSelector(tableSelector, { state: 'visible', timeout: 10000 });
    const rows = page.locator(`${tableSelector} ${rowSelector}`);
    const rowCount = await rows.count();
    const data: string[][] = [];

    for (let i = 0; i < rowCount; i++) {
      const cells = rows.nth(i).locator(cellSelector);
      const cellCount = await cells.count();
      const rowData: string[] = [];
      for (let j = 0; j < cellCount; j++) {
        const text = await cells.nth(j).textContent({ timeout: 3000 });
        rowData.push((text || '').trim());
      }
      data.push(rowData);
    }
    return data;
  } catch {
    return [];
  }
}

/**
 * Extract background color of an element.
 */
export async function extractBgColor(page: Page, selector: string): Promise<string> {
  try {
    const element = page.locator(selector).first();
    const isVisible = await element.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) return '';
    return await element.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.backgroundColor || '';
    });
  } catch {
    return '';
  }
}

/**
 * Extract inline style background color from element.
 */
export async function extractInlineBgColor(page: Page, selector: string): Promise<string> {
  try {
    const element = page.locator(selector).first();
    return await element.evaluate((el) => {
      return (el as HTMLElement).style.backgroundColor || '';
    });
  } catch {
    return '';
  }
}

/**
 * Compare two values and create a mismatch entry if different.
 * Normalizes whitespace and casing for comparison.
 */
export function compareValues(
  field: string,
  zencValue: string,
  stock2Value: string,
  severity: Mismatch['severity'] = 'major'
): Mismatch | null {
  const normalizedZenc = normalizeValue(zencValue);
  const normalizedStock2 = normalizeValue(stock2Value);

  if (normalizedZenc === normalizedStock2) return null;

  return {
    field,
    zencValue: zencValue || '(empty)',
    stock2Value: stock2Value || '(empty)',
    severity,
  };
}

/**
 * Compare numeric values with tolerance.
 */
export function compareNumericValues(
  field: string,
  zencValue: string,
  stock2Value: string,
  tolerance: number = 0,
  severity: Mismatch['severity'] = 'major'
): Mismatch | null {
  const zencNum = parseFloat(zencValue.replace(/[^0-9.\-]/g, '')) || 0;
  const stock2Num = parseFloat(stock2Value.replace(/[^0-9.\-]/g, '')) || 0;

  if (Math.abs(zencNum - stock2Num) <= tolerance) return null;

  return {
    field,
    zencValue: zencValue || '(empty)',
    stock2Value: stock2Value || '(empty)',
    severity,
  };
}

/**
 * Normalize a value for comparison:
 * - trim whitespace
 * - collapse multiple spaces
 * - lowercase
 * - remove trailing zeros from decimals
 */
function normalizeValue(value: string): string {
  return (value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/**
 * Take comparison screenshots of both pages.
 */
export async function takeComparisonScreenshots(
  zencPage: Page,
  stock2Page: Page,
  name: string,
  outputDir: string = 'e2e/comparison/screenshots'
): Promise<{ zenc: string; stock2: string }> {
  const zencPath = `${outputDir}/zenc-${name}.png`;
  const stock2Path = `${outputDir}/stock2-${name}.png`;

  await zencPage.screenshot({ path: zencPath, fullPage: true });
  await stock2Page.screenshot({ path: stock2Path, fullPage: true });

  return { zenc: zencPath, stock2: stock2Path };
}

/**
 * Build a formatted mismatch report for logging/GitHub issues.
 */
export function buildMismatchReport(result: ComparisonResult): string {
  const lines: string[] = [];

  if (result.orderId) {
    lines.push(`## Order: #${result.orderId} (${result.category || 'unknown'})`);
  }
  lines.push(`**Matches:** ${result.matches} | **Mismatches:** ${result.mismatches.length} | **Skipped:** ${result.skipped.length}`);
  lines.push('');

  if (result.mismatches.length > 0) {
    lines.push('### Mismatches');
    lines.push('');
    lines.push('| Field | Zenc Value | Stock2 Value | Severity |');
    lines.push('|-------|-----------|-------------|----------|');
    for (const m of result.mismatches) {
      lines.push(`| ${m.field} | ${m.zencValue} | ${m.stock2Value} | ${m.severity} |`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(`### Skipped Fields: ${result.skipped.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Log a comparison result with color-coded output.
 */
export function logComparisonResult(result: ComparisonResult): void {
  const prefix = result.orderId ? `Order #${result.orderId}` : 'Comparison';

  if (result.mismatches.length === 0) {
    console.log(`✓ ${prefix}: All ${result.matches} fields match`);
  } else {
    console.log(`✗ ${prefix}: ${result.mismatches.length} mismatches out of ${result.matches + result.mismatches.length} fields`);
    for (const m of result.mismatches) {
      console.log(`  [${m.severity}] ${m.field}: zenc="${m.zencValue}" vs stock2="${m.stock2Value}"`);
    }
  }
}

/**
 * Wait for a page to finish loading dynamic content.
 * Useful after navigation or filter changes.
 */
export async function waitForStableContent(page: Page, timeout: number = 5000): Promise<void> {
  // Wait for network to be idle
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  // Small buffer for any JS rendering
  await page.waitForTimeout(500);
}

/**
 * Extract a number from text like "Ship By Today(42)" or "Displaying 1 to 20 (of 250)".
 */
export function extractNumberFromText(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a "Displaying X to Y (of Z)" pagination string to extract total count.
 */
export function parsePaginationTotal(text: string): number | null {
  // Matches "of 40080)" or "of 40080 orders)" etc.
  return extractNumberFromText(text, /of\s+(\d+)/i);
}

/**
 * Parse tab text like "Ship By Today(42)" or "Ship By Today42" to extract count.
 * Stock2 uses Badge components that render as "LabelN" without parens.
 */
export function parseTabCount(text: string): number | null {
  // First try parenthesized format: "Ship By Today(42)"
  const parenMatch = extractNumberFromText(text, /\((\d+)\)\s*$/);
  if (parenMatch !== null) return parenMatch;

  // Then try trailing number format: "Ship By Today42"
  const trailingMatch = extractNumberFromText(text, /[a-z]\s*(\d+)\s*$/i);
  return trailingMatch;
}

/**
 * Normalize color values (hex/rgb) to a consistent rgb format for comparison.
 */
export function normalizeColor(color: string): string {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return '';

  // Already rgb/rgba
  if (color.startsWith('rgb')) return color.replace(/\s/g, '');

  // Convert hex to rgb
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgb(${r},${g},${b})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgb(${r},${g},${b})`;
  }

  return color;
}
