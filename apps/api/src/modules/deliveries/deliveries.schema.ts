/**
 * Deliveries module Zod schemas.
 *
 * Migration source: legacy IndexController::new_stock (CakePHP).
 * Spec: new_stock_grid.spec.md §3 (URL & routing) and §5 (filter mapping).
 *
 * Phase 1 is read-only — these schemas only validate input for the grid query
 * and dropdown endpoints; no write/edit schemas are defined yet.
 */

import { z } from 'zod';

// Whitelist for the productcode filter — alphanumerics plus the punctuation the
// legacy product code format uses (dash, dot, slash, space).
const PRODUCT_CODE_REGEX = /^[A-Za-z0-9 _\-./]+$/;

/**
 * Spec §5.1: "Filter By" dropdown.
 *  0 / unset = no filter
 *  1 = Recently Arrived and Unmapped
 *  2 = Products With Images
 *  3 = Unmapped with Image URL
 */
export const DeliverySortSchema = z.enum(['0', '1', '2', '3']).default('0');
export type DeliverySort = z.infer<typeof DeliverySortSchema>;

/**
 * Spec §5.2: "Filter By UKSS Price" dropdown — only honoured when sort ∈ {1,2,3}.
 *  0 / unset = no filter
 *  1 = product codes WITH a UKSS price uploaded
 *  2 = product codes WITHOUT a UKSS price uploaded
 */
export const UkssPriceStatusSchema = z.enum(['0', '1', '2']).default('0');
export type UkssPriceStatus = z.infer<typeof UkssPriceStatusSchema>;

export const DeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  sort: DeliverySortSchema,
  ukss_price_upload_status: UkssPriceStatusSchema,

  // Spec §3: legacy default is "1" — the controller forces it when missing.
  remove_duplicate_product_code: z.enum(['0', '1']).default('1'),

  // Spec §5.4: 0 = no filter.
  team_id: z.coerce.number().int().nonnegative().default(0),

  // Country of origin filter (product_lists.country_of_origin_id). 0 = no filter.
  country_of_origin_id: z.coerce.number().int().nonnegative().default(0),

  // Spec §4 step 10: exact product code match.
  productcode: z
    .string()
    .trim()
    .max(64)
    .regex(PRODUCT_CODE_REGEX)
    .optional(),

  // Stock-home-grid consolidation filters (additive AND on top of the above).
  // archive=1 -> out-of-stock rows only (s.quantity = 0).
  archive: z.enum(['0', '1']).default('0'),
  // special=1 -> specials whose window starts this week or later (planning view,
  // distinct from the per-row isSpecialActive display flag).
  special: z.enum(['0', '1']).default('0'),
  // Free-text search on product name.
  keyword: z.string().trim().max(100).optional(),
  // Team-name initial filter (A-Z). Builder uppercases it and joins `teams`.
  letter: z.string().trim().max(1).optional(),

  // ORDER BY mode. 'recent' (default) preserves existing deliveries ordering;
  // 'season' mirrors the stock-home-grid season sort.
  order_mode: z.enum(['recent', 'season']).default('recent'),
});
export type DeliveryListQuery = z.infer<typeof DeliveryListQuerySchema>;