/**
 * Walmart order parsing helpers.
 *
 * Pure functions for translating Walmart API order shapes into the values our Stage 1+2
 * transform layer needs. Kept here (not in the service) so they can be unit-tested in isolation.
 *
 * Source: legacy SMS `marketplace_orders_controller.php:1698-1881`.
 */

import type { WalmartOrder, WalmartOrderLine } from '../../modules/walmart/walmart-api.types';

/**
 * Coerce the `quantity.amount` value (Walmart returns either a string or number) to a positive
 * integer. Returns 0 for invalid/missing values — callers should skip such lines.
 */
export function parseWalmartQuantity(amount: string | number | undefined): number {
  if (amount === undefined || amount === null) return 0;
  const n = typeof amount === 'string' ? parseInt(amount, 10) : Math.trunc(amount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Compute the order subtotal and tax across all lines, summing per-unit values during quantity
 * expansion (legacy pattern at `:1779-1780`).
 *
 * Uses `charges.charge[0]` only — additional entries (shipping, etc.) are ignored to match legacy.
 * `mo_shipping_total` is hardcoded `0` in our schema, so missing shipping aggregation is intentional.
 *
 * @returns subtotal, tax, and the currency code captured from the first line. `currency` may be
 *          `''` if the order has no lines (caller should treat that as a fatal error).
 */
export function sumWalmartOrderTotals(order: WalmartOrder): {
  subtotal: number;
  tax: number;
  currency: string;
} {
  let subtotal = 0;
  let tax = 0;
  let currency = '';

  for (const line of order.orderLines.orderLine) {
    const qty = parseWalmartQuantity(line.orderLineQuantity?.amount);
    if (qty <= 0) continue;

    const charge = line.charges?.charge?.[0];
    if (!charge) continue;

    const unitAmount = Number(charge.chargeAmount?.amount ?? 0);
    const unitTax = Number(charge.tax?.taxAmount?.amount ?? 0);

    // Sum per unit during the quantity expansion — exact legacy parity.
    for (let i = 0; i < qty; i++) {
      subtotal += unitAmount;
      tax += unitTax;
    }

    if (!currency && charge.chargeAmount?.currency) {
      currency = charge.chargeAmount.currency;
    }
  }

  return { subtotal, tax, currency };
}

/**
 * Convert Walmart's `orderDate` / `estimatedDeliveryDate` (Unix ms) to a `Date` instance, or
 * `undefined` if missing.
 */
export function walmartTimestampToDate(ms: number | undefined): Date | undefined {
  if (ms === undefined || ms === null) return undefined;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms);
}

/**
 * Pick the per-unit price for a single line. Used per-row during quantity expansion.
 *
 * NB: Walmart's `chargeAmount.amount` is per-unit. Each MOP row stores it directly — that's the
 * natural per-unit semantics, NOT a duplicated line total like OnBuy's `total_price`.
 */
export function walmartLineUnitPrice(line: WalmartOrderLine): number {
  return Number(line.charges?.charge?.[0]?.chargeAmount?.amount ?? 0);
}

/**
 * Pick the per-unit VAT for a single line. Used per-row during quantity expansion.
 */
export function walmartLineUnitVat(line: WalmartOrderLine): number | null {
  const v = line.charges?.charge?.[0]?.tax?.taxAmount?.amount;
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Get the line's reported status string (e.g. "Created", "Acknowledged"). Walmart returns this
 * inside an array — we always read index 0 (legacy `:1768`).
 */
export function walmartLineStatus(line: WalmartOrderLine): string | null {
  return line.orderLineStatuses?.orderLineStatus?.[0]?.status ?? null;
}
