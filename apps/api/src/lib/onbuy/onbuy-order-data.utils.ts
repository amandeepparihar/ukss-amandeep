/**
 * OnBuy Order Data Utilities
 *
 * Helper functions for parsing OnBuy API responses.
 * The main transformation logic lives in onbuy-order-service.ts.
 */

import type {
  OnBuyOrder,
  OnBuyOrdersListEnvelope,
} from '../../modules/onbuy/onbuy-api.types';

/**
 * Extract the order array from an OnBuy orders response.
 *
 * WHY: OnBuy responses wrap orders as `{ result: { results: [...] } }`, but in some
 * deployments the array surfaces directly under `results`. Handle both shapes
 * defensively so a wrapper change doesn't silently zero our fetch.
 */
export function extractOnBuyOrders(envelope: OnBuyOrdersListEnvelope | null | undefined): OnBuyOrder[] {
  if (!envelope) return [];
  if (envelope.result?.results && Array.isArray(envelope.result.results)) {
    return envelope.result.results;
  }
  if (Array.isArray(envelope.results)) {
    return envelope.results;
  }
  return [];
}

/**
 * Parse a numeric quantity from OnBuy's string-typed quantity field.
 * Returns 0 for invalid/missing values so the caller can skip the row.
 */
export function parseQuantity(value: unknown): number {
  if (value == null) return 0;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse a numeric price from OnBuy's string-typed price fields (e.g. "32.00").
 * Returns 0 for invalid/missing values to keep totals math safe.
 */
export function parsePrice(value: unknown): number {
  if (value == null) return 0;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}
