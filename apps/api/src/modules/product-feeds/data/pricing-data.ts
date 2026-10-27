/**
 * Product Feeds - Pricing Data Loaders
 *
 * Loads the active salemaker sales, weekend offers, and per-product
 * deal lookups used by `processors/pricing-engine.ts`.
 *
 * PHP source:
 *   - `ukss-feed/price_functions.php::checkSale()`
 *   - `ukss-feed/price_functions.php::checkWeekend10()`
 *   - `ukss-feed/price_functions.php::checkDeals()`
 */

import { prisma } from '../../../lib/prisma.js';
import type { ActiveSale, WeekendOffer, DealRow } from '../product-feeds.types.js';

/**
 * Active salemaker sales -- status=1 and within the start/end date range.
 * "0001-01-01" is treated as "open-ended" by the PHP original.
 *
 * Mirrors: price_functions.php:checkSale()
 */
export async function loadActiveSales(): Promise<ActiveSale[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      sale_deduction_value: string | number;
      sale_deduction_type: number;
      sale_categories_all: string | null;
      sortorder_to_exclude: string | null;
      sale_pricerange_from: string | number;
      sale_pricerange_to: string | number;
    }>
  >`
    SELECT
      sale_deduction_value,
      sale_deduction_type,
      sale_categories_all,
      sortorder_to_exclude,
      sale_pricerange_from,
      sale_pricerange_to
    FROM salemaker_sales
    WHERE sale_status = '1'
      AND (sale_date_start <= NOW() OR sale_date_start = '0001-01-01')
      AND (sale_date_end   >= NOW() OR sale_date_end   = '0001-01-01')
  `;

  return rows.map((r) => ({
    sale_deduction_value: Number(r.sale_deduction_value),
    sale_deduction_type: Number(r.sale_deduction_type),
    sale_categories_all: r.sale_categories_all ?? '',
    sortorder_to_exclude: r.sortorder_to_exclude ?? '',
    sale_pricerange_from: Number(r.sale_pricerange_from),
    sale_pricerange_to: Number(r.sale_pricerange_to),
  }));
}

/**
 * Active weekend 10% offers -- status=1 and current time within start/end.
 *
 * Mirrors: price_functions.php:checkWeekend10()
 */
export async function loadWeekendOffers(): Promise<WeekendOffer[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: number; exclude_categories: string | null }>
  >`
    SELECT id, exclude_categories
    FROM weekend_offer_10_percent
    WHERE status = '1'
      AND start_date <= NOW()
      AND end_date   >  NOW()
  `;

  return rows.map((r) => ({
    id: Number(r.id),
    exclude_categories: r.exclude_categories ?? '',
  }));
}

/**
 * Per-product deals lookup.
 *
 * Returns the discounted price (base minus best discount), respecting the
 * priority order DAILY > WEEKLY > PERMANENT. Returns `null` when no deal
 * applies (caller falls through to salemaker / specials / base price).
 *
 * Mirrors: price_functions.php:checkDeals()
 */
export async function checkDeals(
  productId: number,
  teamId: number | null,
  productPrice: number,
): Promise<number | null> {
  const deals = await prisma.$queryRaw<DealRow[]>`
    SELECT deal_type, discount_type, discount_value
    FROM deals_management
    WHERE is_active = 1
      AND (
        (deal_target_type = 'CATEGORY' AND target_id = ${teamId})
        OR (deal_target_type = 'PRODUCT' AND target_id = ${productId})
      )
  `;

  if (deals.length === 0) {
    return null;
  }

  // Best discount per deal_type (matching PHP max-per-type behaviour).
  const bestByType: Record<string, number> = {};
  for (const deal of deals) {
    const type = String(deal.deal_type).toUpperCase();
    const value = Number(deal.discount_value);
    const discount =
      deal.discount_type === 'PERCENT' ? (productPrice * value) / 100 : value;

    if (bestByType[type] === undefined || discount > bestByType[type]) {
      bestByType[type] = discount;
    }
  }

  // Priority order: DAILY > WEEKLY > PERMANENT (first match wins).
  for (const type of ['DAILY', 'WEEKLY', 'PERMANENT'] as const) {
    if (bestByType[type] !== undefined) {
      return Number((productPrice - bestByType[type]).toFixed(4));
    }
  }

  return null;
}
