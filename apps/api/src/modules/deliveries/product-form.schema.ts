/**
 * Add-SMS-Product form Zod schemas.
 *
 * Migration source: `create_edit_product_form.spec.md` + audit C.
 *
 * For phase 3 we ship Flow A only (`mappedProductId` empty → single-table
 * write to `sms_products_for_review`). Flow B is intentionally deferred per
 * documentation/deliveries-write-path-plan.md §6.2.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET — form load
// ---------------------------------------------------------------------------

export const ProductFormLoadQuerySchema = z.object({
  pcode: z.string().trim().min(1).max(64),
});
export type ProductFormLoadQuery = z.infer<typeof ProductFormLoadQuerySchema>;

// ---------------------------------------------------------------------------
// POST — submit (Flow A)
// ---------------------------------------------------------------------------

/**
 * Field set mirrors the legacy form action="submit_for_review" body. Used by
 * BOTH flows — Flow A reads a subset; Flow B reads the full set.
 *
 *  - `mappedProductId` is the discriminator.
 *  - `price<id>` / `prefix<id>` / `newExtraInfo_<i>` are dynamic per-attribute
 *    fields the legacy form emits. We accept them via a passthrough catch-all
 *    field `dynamicFields` so the JSON contract stays tidy.
 */
export const SubmitForReviewBodySchema = z.object({
  /** Discriminator. Must be empty/missing for Flow A. Non-empty → Flow B (not yet implemented). */
  mappedProductId: z.string().optional().default(''),

  /** Optional pre-order redirect override. */
  called_from: z.string().optional(),
  request_uri: z.string().optional(),

  // Core
  products_name: z.string().trim().min(1).max(255),
  teamzo_products_name: z.string().trim().max(255).optional().default(''),
  adults_products_model: z.string().trim().min(1).max(64),
  products_description: z.string().optional().default(''),

  products_price: z.coerce.number().nonnegative().optional().default(0),
  products_teamzo_price: z.coerce.number().nonnegative().optional().default(0),
  products_rrp_price: z.coerce.number().nonnegative().optional().default(0),

  manufacturers_id: z.coerce.number().int().nonnegative().optional().default(0),
  master_category: z.coerce.number().int().nonnegative().optional().default(0),
  products_type_id: z.coerce.number().int().nonnegative().optional().default(0),

  // Generic product-type drilldown. Up to ~4 levels in legacy form.
  product_type_id: z.coerce.number().int().nonnegative().optional(),
  product_type_id_1: z.coerce.number().int().nonnegative().optional(),
  product_type_id_2: z.coerce.number().int().nonnegative().optional(),
  product_type_id_3: z.coerce.number().int().nonnegative().optional(),
  product_type_id_4: z.coerce.number().int().nonnegative().optional(),

  // Categories
  category_menu: z.array(z.coerce.number().int().nonnegative()).optional().default([]),

  // Attributes — printing attribute ids (261 Name&Number, 5781 Shorts Numbers, 5762 Trainers).
  attribute: z.array(z.coerce.number().int().nonnegative()).optional().default([]),

  // Extra-info kids selects. Keys: 1=Size Guide, 2=Sleeve Length, 3=Color (multi),
  // 4=Name&Number setting, 5=Season, 6=Glove Type, 7=other, 8=Driver (auto-create).
  extra_info_kids_1: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_2: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_3: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_4: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_5: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_6: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  extra_info_kids_7: z.array(z.coerce.number().int().nonnegative()).optional().default([]),
  /** Driver: free text — auto-INSERTs new option (legacy footgun, preserved). */
  extra_info_kids_8: z.array(z.string().max(255)).optional().default([]),

  /** Sleeve patches — array of option ids. */
  extra_info_kids_sleeve_patch: z
    .array(z.coerce.number().int().nonnegative())
    .optional()
    .default([]),

  // Personalisation
  player1: z.string().trim().max(64).optional().default(''),
  player2: z.string().trim().max(64).optional().default(''),
  player3: z.string().trim().max(64).optional().default(''),

  // Size group helpers
  products_options_id: z.coerce.number().int().nonnegative().optional().default(0),
  sms_size_group_id: z.coerce.number().int().nonnegative().optional().default(0),
  // Season sort order, sourced from `seasons.sort`. Legacy assigns NEGATIVE
  // sort values to newer seasons so they sort to the top, so this must NOT be
  // constrained to non-negative (prod season 2026-2027 has sort = -20).
  season_sort_order: z.coerce.number().int().optional().default(0),

  // Pre-own archive flow (PMS 130032)
  create_football: z.string().optional(),
  football_kits_id: z.coerce.number().int().nonnegative().optional(),
  league: z.coerce.number().int().nonnegative().optional(),
  team_dropdown: z.coerce.number().int().nonnegative().optional(),

  // ----- Flow B-only fields ------------------------------------------------
  // Audited at add_sms_products_controller.php:3514-4277. These are accepted
  // but ignored on Flow A.

  /** training_wear categories (legacy: training_wear[] form field). The magic
   *  value `2282` triggers the price261 override path. */
  training_wear: z.array(z.coerce.number().int().nonnegative()).optional().default([]),

  /** training[] — additional training-wear category list. Audit C.3 says
   *  Flow B drops `justAnotherInputBox_*` extras; this is the carry-through. */
  training: z.array(z.coerce.number().int().nonnegative()).optional().default([]),

  /** team_custom_kit group id */
  grp_id: z.coerce.number().int().nonnegative().optional(),
  /** team_custom_kit size id */
  kids_size_group_dropdown: z.coerce.number().int().nonnegative().optional(),

  /** Other Flow B controls. */
  hot_product: z.union([z.string(), z.number(), z.boolean()]).optional()
    .transform((v) => (v === '1' || v === 1 || v === true || v === 'on' ? 1 : 0)),
  products_copa: z.coerce.number().int().nonnegative().optional().default(0),
  products_toffs: z.coerce.number().int().nonnegative().optional().default(0),

  /** Per-attribute price overrides keyed by attribute id (e.g. `price261`).
   *  This object is what the legacy form emits as `price<id>` fields. */
  attributePrices: z.record(z.string(), z.string()).optional().default({}),
  /** Per-attribute prefix string. Legacy `prefix<id>`. */
  attributePrefixes: z.record(z.string(), z.string()).optional().default({}),

  /** Per-attribute size mappings — legacy `sizesid<attrId>`. */
  attributeSizes: z.record(z.string(), z.coerce.number()).optional().default({}),

  /** newExtraInfo_<typeId> free-text additions. Legacy auto-INSERTs into
   *  product_extra_info_type_options. Preserved as a footgun (audit C.5.b). */
  newExtraInfo: z.record(z.string(), z.string()).optional().default({}),

  /** Sleeve patch per-row price overrides. Legacy `price_sleeve_patch_<id>` +
   *  `price_sleeve_patch_option_value_id_<id>`. */
  sleevePatchPrices: z.record(z.string(), z.string()).optional().default({}),
});
export type SubmitForReviewBody = z.infer<typeof SubmitForReviewBodySchema>;
