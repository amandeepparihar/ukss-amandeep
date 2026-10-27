/**
 * Deliveries write-path Zod schemas.
 *
 * Migration source: see documentation/deliveries-write-path-plan.md §4. The
 * legacy endpoint (`product_quantities_controller::save_product`) accepts any
 * string for `column` and silently no-ops unknown values. We tighten the
 * whitelist: only `season`, `price`, and the 14 size-option columns the grid
 * actually emits are accepted; everything else returns 400.
 *
 * Per-column permission gating happens in the route handler (see
 * `deliveries.write.routes.ts`).
 */

import { z } from 'zod';

/**
 * Size-option ids the grid exposes. Mirrors apps/web/src/pages/deliveries/DeliveriesGrid.tsx
 * `SIZE_COLUMNS` plus `option_1641` which the read service still emits (spec
 * §6 notes it's never rendered as a column but is in the payload). Keeping
 * `option_1641` here means a future grid that does render the column can edit
 * it without an API change.
 */
export const EDITABLE_SIZE_OPTION_IDS = [
  1, 2, 3, 4, 5, 441, 442, 443, 444, 509, 623, 1640, 1641, 2701,
] as const;

const sizeOptionColumns = EDITABLE_SIZE_OPTION_IDS.map((n) => `option_${n}` as const);

export const DeliveryCellColumnSchema = z.union([
  z.literal('season'),
  z.literal('price'),
  z.literal('special_price'),
  ...sizeOptionColumns.map((c) => z.literal(c)),
]);
export type DeliveryCellColumn = z.infer<typeof DeliveryCellColumnSchema>;

/**
 * Cell value. The legacy model code splits on `#` and keeps the prefix
 * (`product_quantity.php:104-108`), so a comment suffix is allowed. We cap
 * length conservatively.
 */
export const DeliveryCellValueSchema = z.string().max(64);

export const DeliveryInlineEditBodySchema = z.object({
  productQuantitiesId: z.coerce.number().int().positive(),
  column: DeliveryCellColumnSchema,
  value: DeliveryCellValueSchema,
});
export type DeliveryInlineEditBody = z.infer<typeof DeliveryInlineEditBodySchema>;

/** Maps `column` → the permission string the user must hold. */
export const DELIVERY_CELL_COLUMN_PERMISSION: Record<DeliveryCellColumn, string> = (() => {
  const map: Record<string, string> = {
    season: 'deliveries:edit_season',
    price: 'deliveries:edit_price',
    // Reuses SET_SPECIAL_PRICE_AND_DEAL from deliveries.permissions.ts.
    special_price: 'deliveries:set_special',
  };
  for (const c of sizeOptionColumns) map[c] = 'deliveries:edit_quantities';
  return map as Record<DeliveryCellColumn, string>;
})();

// ---------------------------------------------------------------------------
// Image Added toggle (PATCH /api/deliveries/image-added/:productCode)
// ---------------------------------------------------------------------------

export const ImageAddedBodySchema = z.object({
  value: z.enum(['0', '1']),
});
export type ImageAddedBody = z.infer<typeof ImageAddedBodySchema>;

// ---------------------------------------------------------------------------
// Link / unlink quantity (POST /api/deliveries/link-quantity/:productCode)
// ---------------------------------------------------------------------------

export const LinkQuantityBodySchema = z.object({
  /** 'toggle' inverts current state — matches legacy single-endpoint UX. */
  action: z.enum(['link', 'unlink', 'toggle']).default('toggle'),
});
export type LinkQuantityBody = z.infer<typeof LinkQuantityBodySchema>;

// ---------------------------------------------------------------------------
// Common product-code path param
// ---------------------------------------------------------------------------

export const PRODUCT_CODE_REGEX = /^[A-Za-z0-9 _\-./]+$/;
export const ProductCodeParamSchema = z.object({
  productCode: z.string().trim().min(1).max(64).regex(PRODUCT_CODE_REGEX),
});
