/**
 * Deliveries grid per-row click actions — Map, Special, Assign Font, eBay,
 * Map-search candidates.
 *
 * Migration sources:
 *   - Map         → categories_controller.php::list_categories + save_product_model
 *   - Special     → product_quantities_controller.php::set_specials + save_specials
 *   - Assign Font → index_controller.php::assign_font + save_assigned_font
 *   - eBay        → ebay_products_controller.php::set_ebay_product
 *
 * Parity-preserving design choices:
 *   - All writes wrapped in Prisma transactions (legacy has none).
 *   - Cache contract honoured: targeted UPDATEs go through directUpdateGridRow,
 *     full rebuilds via requestGridRebuild.
 *   - stock_system_logs2 is the real audit table (legacy renamed in 2018).
 */

import { Prisma, prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { directUpdateGridRow, requestGridRebuild } from './stock-grid-cache';

const logger = createLogger('deliveries.grid-actions');

export class GridActionError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'GridActionError';
  }
}

// ---------------------------------------------------------------------------
// Map — ZC product mapping
// ---------------------------------------------------------------------------
//
// Legacy flow (CC:248-936):
//   1. Operator clicks M → modal lists candidate ZC products (by team/category).
//   2. Operator ticks one or more products + optionally checks "link quantity".
//   3. POST save_product_model:
//      - UPDATE products SET products_model = <productCode>, quantity_map=?, …
//      - INSERT product_lists_to_products (one row per checked products_id)
//      - INSERT product_lists_to_products_history (audit row)
//      - UPDATE product_lists SET map_status='1', quantity_map=?
//      - UPDATE stock_home_grid_lists SET map='Mapped'
//
// New flow:
//   POST /api/deliveries/grid/map
//   Body: { productCode, productIds: number[], linkQuantity: boolean }

export interface MapToZcInput {
  productCode: string;
  productIds: number[];
  linkQuantity: boolean;
}

export interface MapToZcResult {
  productCode: string;
  productsAffected: number;
  linkQuantity: boolean;
}

export interface MapCandidate {
  products_id: number;
  products_model: string | null;
  products_name: string | null;
  products_price: string | null;
  already_mapped: boolean;
}

/**
 * Legacy parity port of `CategoriesController::product_to_category()`
 * (`app/controllers/categories_controller.php:157-246`).
 *
 * Returns the candidate ZenCart products for a chosen category, in two
 * concatenated lists (mapped first, then the rest) — matching legacy:
 *
 *   A. products in the chosen category whose `products_model LIKE '%pcode%'`
 *      (already-mapped to this product code) — flagged `already_mapped: true`.
 *   B. the remainder of the category:
 *        - if A is non-empty → `products_model NOT LIKE '%pcode%' AND is_sticker = 0`
 *        - if A is empty    → `is_sticker = 0`
 *      flagged `already_mapped: false`.
 *
 * Result is `[...A, ...B]` per the legacy `array_merge($mapped_product_list,
 * $product_list)`. No team scoping (legacy has none here).
 *
 * `categoryId` is required — legacy is invoked from the dropdown change. With
 * no category picked, we return an empty list rather than dumping the entire
 * catalogue.
 */
export async function searchMapCandidates(
  productCode: string,
  opts: { categoryId?: number | null; limit?: number } = {}
): Promise<MapCandidate[]> {
  const { categoryId = null, limit = 500 } = opts;
  if (!categoryId) return [];

  const pcodeLike = `%${productCode}%`;

  // A. products in this category matching the product code (legacy lines 188-206).
  //    Sort: Product.products_model ASC, ProductsToCategory.products_id DESC.
  const mapped = await prisma.$queryRawUnsafe<
    Array<{
      products_id: number | bigint;
      products_model: string | null;
      products_name: string | null;
      products_price: string | null;
    }>
  >(
    `SELECT p.products_id, p.products_model, pd.products_name,
            CAST(p.products_price AS CHAR) AS products_price
       FROM products_to_categories ptc
       JOIN products p
         ON p.products_id = ptc.products_id
       LEFT JOIN products_description pd
         ON pd.products_id = ptc.products_id AND pd.language_id = 1
      WHERE ptc.categories_id = ?
        AND p.products_model LIKE ?
      ORDER BY p.products_model ASC, ptc.products_id DESC
      LIMIT ?`,
    categoryId,
    pcodeLike,
    limit
  );

  // B. the rest of the category (legacy lines 207-230).
  //    If A returned rows → exclude the pcode-matching products + non-sticker.
  //    Else → only the non-sticker filter (legacy returns the whole category).
  //    Sort: Product.products_model DESC, ProductsToCategory.products_id DESC.
  const restConditions: string[] = [`ptc.categories_id = ?`, `p.is_sticker = 0`];
  const restParams: unknown[] = [categoryId];
  if (mapped.length > 0) {
    restConditions.push(`p.products_model NOT LIKE ?`);
    restParams.push(pcodeLike);
  }
  restParams.push(limit);

  const rest = await prisma.$queryRawUnsafe<
    Array<{
      products_id: number | bigint;
      products_model: string | null;
      products_name: string | null;
      products_price: string | null;
    }>
  >(
    `SELECT p.products_id, p.products_model, pd.products_name,
            CAST(p.products_price AS CHAR) AS products_price
       FROM products_to_categories ptc
       JOIN products p
         ON p.products_id = ptc.products_id
       LEFT JOIN products_description pd
         ON pd.products_id = ptc.products_id AND pd.language_id = 1
      WHERE ${restConditions.join(' AND ')}
      ORDER BY p.products_model DESC, ptc.products_id DESC
      LIMIT ?`,
    ...restParams
  );

  const toRow = (r: {
    products_id: number | bigint;
    products_model: string | null;
    products_name: string | null;
    products_price: string | null;
  }, already_mapped: boolean): MapCandidate => ({
    products_id: Number(r.products_id),
    products_model: r.products_model,
    products_name: r.products_name,
    products_price: r.products_price,
    already_mapped,
  });

  return [
    ...mapped.map((r) => toRow(r, true)),
    ...rest.map((r) => toRow(r, false)),
  ];
}

/**
 * Legacy parity port of `CategoriesController::listcat()`
 * (`app/controllers/categories_controller.php:106-147`).
 *
 * Returns the FULL recursive category tree as a flat list, depth-first from
 * `parent_id = 0`, with three non-breaking spaces of indentation per level
 * (matches legacy `&nbsp;&nbsp;&nbsp;`).
 *
 * Strict legacy parity:
 *   - LEFT JOIN onto `categories_description` (category with no description
 *     still appears, with empty name) — legacy did not filter these out.
 *   - No `language_id` filter (legacy didn't filter; UKSS only has lang 1 so
 *     it's functionally identical, but we keep the broader join).
 *   - Sibling order is DB natural order (PK ascending). Legacy never sorted
 *     alphabetically — operators navigate by muscle memory.
 *   - Indentation uses real non-breaking-space characters so React renders
 *     the hierarchy without needing HTML-entity decoding.
 */
export async function listTeamCategories(): Promise<Array<{ id: number; name: string }>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      categories_id: number | bigint;
      parent_id: number | bigint;
      categories_name: string | null;
    }>
  >(
    // Legacy parity: LEFT JOIN with no `language_id` filter and DB natural
    // order (PK ascending). Legacy `CategoriesController::listcat` never
    // filtered by language, and a LEFT JOIN keeps categories that have no
    // matching `categories_description` row visible (with empty name) instead
    // of silently dropping them — matches what operators see on the legacy
    // dropdown.
    `SELECT c.categories_id, c.parent_id, cd.categories_name
       FROM categories c
       LEFT JOIN categories_description cd
         ON cd.categories_id = c.categories_id
      ORDER BY c.categories_id ASC`
  );

  // Group children by parent_id, then walk the tree depth-first from root (0).
  const childrenByParent = new Map<number, Array<{ id: number; name: string }>>();
  for (const r of rows) {
    const parentId = Number(r.parent_id);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId)!.push({
      id: Number(r.categories_id),
      name: r.categories_name ?? '',
    });
  }
  // Legacy preserves DB natural order at every level (no alphabetical sort).

  const result: Array<{ id: number; name: string }> = [];
  const walk = (parentId: number, indent: string) => {
    const kids = childrenByParent.get(parentId);
    if (!kids) return;
    for (const k of kids) {
      result.push({ id: k.id, name: indent + k.name });
      walk(k.id, indent + '   ');
    }
  };
  walk(0, '');
  return result;
}

/**
 * Map-dialog pre-fill resolver.
 *
 * Returns two pieces of information the Map dialog needs when it opens for a
 * given SMS product_code:
 *
 *   1. `defaultCategoryId` — the suggested default selection for the category
 *      dropdown. Derived from the team the SMS pcode belongs to, not from
 *      legacy's "first option in select" behaviour. We look up
 *      `product_lists.teams_id`, then `teams.team_name`, then find a category
 *      whose `categories_description.categories_name` matches that team name.
 *      Preference order when multiple matches exist:
 *        - `categories.team_category = '1'` first (the "real" team category)
 *        - then lowest `categories_id` (stable tiebreaker)
 *      If no match is found, `null` is returned and the dialog stays unselected.
 *      This is an intentional UX improvement over legacy — legacy auto-selected
 *      either the first already-mapped category OR the first category in the
 *      whole tree (which is usually a near-useless root). Operators asked for
 *      "the team we already know" instead.
 *
 *   2. `alreadyMappedCategoryIds` — strict legacy parity port of the
 *      `$mapped_category_list` block in
 *      `CategoriesController::list_categories()` (L77-100). Legacy finds the
 *      `products.products_id` whose `products_model` is an EXACT match to the
 *      SMS pcode (via `match_exact_product_code_hero_shirts`) and returns the
 *      list of categories that product is already linked to in
 *      `products_to_categories`. We surface these ids so the UI can badge them
 *      in the dropdown ("mapped" tag), matching the legacy yellow-highlight
 *      hint without having to render two visually separate lists.
 *
 * NOTE: This deliberately does NOT touch the existing `listTeamCategories` API
 * — that endpoint is shared by other consumers and kept strict-legacy. This
 * resolver is the only place team-based defaulting happens.
 */
export interface MapPrefill {
  defaultCategoryId: number | null;
  alreadyMappedCategoryIds: number[];
}

export async function resolveMapPrefill(productCode: string): Promise<MapPrefill> {
  if (!productCode) return { defaultCategoryId: null, alreadyMappedCategoryIds: [] };

  // (1) Team-based default category.
  //
  // product_lists → teams.team_name → categories_description.categories_name
  // (case-insensitive). Preference: team_category='1', then lowest categories_id.
  const defaultRow = await prisma.$queryRawUnsafe<
    Array<{ categories_id: number | bigint }>
  >(
    `SELECT c.categories_id
       FROM product_lists pl
       JOIN teams t ON t.teams_id = pl.teams_id
       JOIN categories_description cd
         ON LOWER(TRIM(cd.categories_name)) = LOWER(TRIM(t.team_name))
        AND cd.language_id = 1
       JOIN categories c ON c.categories_id = cd.categories_id
      WHERE pl.product_code = ?
      ORDER BY (c.team_category = '1') DESC, c.categories_id ASC
      LIMIT 1`,
    productCode
  );
  const defaultCategoryId = defaultRow[0]
    ? Number(defaultRow[0].categories_id)
    : null;

  // (2) Already-mapped categories — legacy `$mapped_category_list` parity.
  //
  // Legacy flow (CategoriesController::list_categories L42-100):
  //   a. products_model LIKE '%pcode%' → candidate products
  //   b. filter to the one whose model is an EXACT match for the pcode
  //      (match_exact_product_code_hero_shirts)
  //   c. read products_to_categories for that exact-match products_id
  //   d. group by categories_id → unique list
  //
  // We reuse the existing helper that ports the exact-match logic.
  const lookup = await findMappedProductIdsLegacy(prisma, productCode, {
    requireMapStatus: false,
    honourTshirtBlock: false,
  });
  let alreadyMappedCategoryIds: number[] = [];
  if (lookup.productIds.length > 0) {
    const placeholders = lookup.productIds.map(() => '?').join(',');
    const rows = await prisma.$queryRawUnsafe<
      Array<{ categories_id: number | bigint }>
    >(
      `SELECT DISTINCT categories_id
         FROM products_to_categories
        WHERE products_id IN (${placeholders})`,
      ...lookup.productIds
    );
    alreadyMappedCategoryIds = rows.map((r) => Number(r.categories_id));
  }

  return { defaultCategoryId, alreadyMappedCategoryIds };
}

/**
 * Shared legacy product-lookup gate.
 *
 * Three SMS grid actions (Set/Clear Special, eBay read) need to discover the
 * list of `products.products_id` that a SMS product_code maps to. Historically
 * the new code asked `product_lists_to_products WHERE status = 1`, but the
 * legacy storefront uses `products.products_model` (CSV column) as its source
 * of truth. Those two sources diverge in production — e.g. JM8378 has
 * `products_model = 'JM8378'` + `product_lists.map_status = 1` but ZERO rows
 * in `product_lists_to_products` — and the legacy view treats the product as
 * mapped while the join-table query said unmapped, so Specials silently
 * no-op'd and eBay SKUs disappeared from the dialog. This helper centralises
 * the legacy gate so the three call sites stay in lock-step.
 *
 * Steps (all from `product_quantities_controller::set_specials` legacy code at
 * `product_quantities_controller.php:3678-3794`):
 *   1. `SELECT product_lists_id, map_status FROM product_lists WHERE product_code = ?`
 *      → missing row, or (`requireMapStatus` && `map_status != 1`), short-circuits.
 *   2. `SELECT products_id, products_model, virtual_product_type_id
 *         FROM products WHERE products_model LIKE '%pcode%'` then a JS
 *      CSV-token match — `products_model` may be stored as `,ABC`, `ABC,`,
 *      `ABC,ABC-1` etc. Legacy (PQC:3787-3791) matches a token when
 *      `pmodel == pcode` OR `pmodel` contains `"-pcode"` OR `pmodel` contains
 *      `"pcode-"`, so e.g. a row stored as `AMCH789-1` still counts as a hit
 *      for code `AMCH789`. The earlier port did strict equality only, which
 *      silently excluded dash-adjacent variants from the Specials popup.
 *   3. If `honourTshirtBlock` and the first matched row has
 *      `virtual_product_type_id = 4`, returns `tshirtBlocked: true` —
 *      legacy PMS 53126 forbids setting a special price on t-shirt virtual
 *      products, and the dialog renders the dedicated message instead.
 */
type MappedLookupOpts = {
  /** Require product_lists.map_status = 1 (Special dialog only). Default true. */
  requireMapStatus?: boolean;
  /** Treat virtual_product_type_id = 4 (t-shirt) as a distinct blocked state
   *  rather than a normal match. Default true for Special; eBay/Font don't
   *  need it. */
  honourTshirtBlock?: boolean;
};
type MappedLookupResult = {
  productListsId: number | null;
  productIds: number[];
  tshirtBlocked: boolean;
};
type RawQueryClient = {
  $queryRawUnsafe: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T>;
};
async function findMappedProductIdsLegacy(
  client: RawQueryClient,
  productCode: string,
  opts: MappedLookupOpts = {}
): Promise<MappedLookupResult> {
  const { requireMapStatus = true, honourTshirtBlock = true } = opts;

  // 1. product_lists gate.
  const plRows = await client.$queryRawUnsafe<
    Array<{ product_lists_id: number; map_status: number | bigint | null }>
  >(
    `SELECT product_lists_id, map_status FROM product_lists WHERE product_code = ? LIMIT 1`,
    productCode
  );
  const pl = plRows[0];
  if (!pl) return { productListsId: null, productIds: [], tshirtBlocked: false };
  if (requireMapStatus && Number(pl.map_status ?? 0) !== 1) {
    return { productListsId: pl.product_lists_id, productIds: [], tshirtBlocked: false };
  }

  // 2. products.products_model CSV-token match.
  const candidates = await client.$queryRawUnsafe<
    Array<{
      products_id: number | bigint;
      products_model: string | null;
      virtual_product_type_id: number | bigint | null;
    }>
  >(
    `SELECT products_id, products_model, virtual_product_type_id
       FROM products
      WHERE products_model LIKE ?`,
    `%${productCode}%`
  );
  const norm = candidates.map((r) => ({
    products_id: Number(r.products_id),
    products_model: String(r.products_model ?? ''),
    virtual_product_type_id: Number(r.virtual_product_type_id ?? 0),
    tokens: String(r.products_model ?? '')
      .split(',')
      .map((s) => s.trim()),
  }));

  // (a) Display list — legacy PQC:3787-3791. A product is included if any CSV
  // token equals pcode, contains `-pcode`, or contains `pcode-`. The dash
  // forms let variants like `AMCH789-1` still match the parent code
  // `AMCH789`.
  const matched = norm.filter((r) =>
    r.tokens.some(
      (pmodel) =>
        pmodel === productCode ||
        pmodel.indexOf('-' + productCode) !== -1 ||
        pmodel.indexOf(productCode + '-') !== -1
    )
  );

  // (b) Gate / t-shirt block — legacy PQC:3695-3707, 3720. `virtual_check` is
  // sourced only from STRICT CSV-token equality (no dash forms), and the
  // popup's t-shirt message hinges on that strict virtual_product_type_id.
  // If we sourced it from the broader list, a dash-variant child's type id
  // could spuriously trip the t-shirt branch (or hide it).
  const strictMatches = norm.filter((r) => r.tokens.includes(productCode));
  const strictVirtual =
    strictMatches.length > 0
      ? strictMatches[strictMatches.length - 1].virtual_product_type_id
      : null;

  if (matched.length === 0) {
    return { productListsId: pl.product_lists_id, productIds: [], tshirtBlocked: false };
  }

  if (honourTshirtBlock && strictVirtual === 4) {
    return { productListsId: pl.product_lists_id, productIds: [], tshirtBlocked: true };
  }
  // Legacy gate also requires SOME strict exact match (virtual_check != '').
  // Without it, the popup would fall through to "No Mapped Products Found".
  if (honourTshirtBlock && strictVirtual === null) {
    return { productListsId: pl.product_lists_id, productIds: [], tshirtBlocked: false };
  }

  return {
    productListsId: pl.product_lists_id,
    productIds: matched.map((m) => m.products_id),
    tshirtBlocked: false,
  };
}

/**
 * Returns the Special-dialog state for a product code. Mirrors legacy
 * `product_quantities_controller::set_specials` (PQC:3649-3939):
 *
 *   - Gates via `findMappedProductIdsLegacy` (Special enforces both
 *     `map_status = 1` and the t-shirt block).
 *   - For each mapped products_id, returns name + current special price + the
 *     four deal flags (Thursday Mega via products_to_categories category 3221,
 *     Black/Cyber/Mega Friday via `products` boolean columns).
 *   - For each mapped products_id, returns the per-size attributes row
 *     (legacy renders these in a per-product nested table).
 *   - Top-level startDate/endDate are seeded from the first row with a value
 *     (legacy `set_specials.ctp:9-17` loop).
 */
export interface SpecialStateSize {
  optionValueId: number;
  name: string;
  price: string;
  prefix: '+' | '-';
  startDate: string | null;
  endDate: string | null;
}
export interface SpecialStateProduct {
  productsId: number;
  productsName: string;
  productsModel: string;
  specialPrice: string;
  thursdayDeal: boolean;
  blackFridayDeal: boolean;
  cyberMondayDeal: boolean;
  megaFridayDeal: boolean;
  sizes: SpecialStateSize[];
}
export async function getSpecialState(productCode: string): Promise<{
  productCode: string;
  mappedProducts: number;
  tshirtBlocked: boolean;
  startDate: string | null;
  endDate: string | null;
  products: SpecialStateProduct[];
}> {
  const lookup = await findMappedProductIdsLegacy(prisma, productCode, {
    requireMapStatus: true,
    honourTshirtBlock: true,
  });
  if (lookup.tshirtBlocked) {
    return {
      productCode,
      mappedProducts: 0,
      tshirtBlocked: true,
      startDate: null,
      endDate: null,
      products: [],
    };
  }
  if (lookup.productIds.length === 0) {
    return {
      productCode,
      mappedProducts: 0,
      tshirtBlocked: false,
      startDate: null,
      endDate: null,
      products: [],
    };
  }

  const placeholders = lookup.productIds.map(() => '?').join(',');
  const fmtDate = (d: Date | string | null) => {
    if (d == null) return null;
    const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
    return s === '0000-00-00' ? null : s.slice(0, 10);
  };

  // 1. Per-product header + deal flags. Legacy reads the deals one-by-one
  //    (PQC:3766-3776); we batch.
  //
  // Thursday Mega Deal is a category-3221 membership in `products_to_categories`
  // (legacy doesn't use a column on `products`). The natural SELECT-list form
  // is `EXISTS(SELECT 1 FROM products_to_categories WHERE ... AND categories_id=3221)`,
  // but Prisma's MySQL driver returns that as a BigInt which can't be
  // JSON-serialised at the API boundary and the whole request 500s. A
  // `LEFT JOIN ... ptc.products_id IS NOT NULL` produces the same boolean
  // (PtC's PK is composite so at most one row matches) and avoids the BigInt
  // route entirely. JOIN form verified via Prisma probe.
  const productRows = await prisma.$queryRawUnsafe<
    Array<{
      products_id: number | bigint;
      products_model: string | null;
      products_name: string | null;
      black_friday_deal: number | bigint | null;
      cyber_monday_deal: number | bigint | null;
      mega_friday_deal: number | bigint | null;
      specials_new_products_price: string | null;
      specials_date_available: string | null;
      expires_date: string | null;
      thursday_in_cat: number | bigint | null;
    }>
  >(
    // Legacy PQC:3741-3744 joins `specials` on products_id with NO status
    // filter — disabled specials still surface their price/dates in the
    // popup so operators can re-activate or edit them. The earlier port
    // added `AND s.status = 1`, which suppressed pre-existing rows.
    //
    // Dates are pulled through DATE_FORMAT so Prisma never sees a raw DATE
    // column. Without this, rows with the legacy `0000-00-00` sentinel
    // (very common on disabled specials) crash the MySQL driver with
    // "Raw query failed. Code: N/A. Message: N/A". The cast also keeps the
    // wire format deterministic — we always get a `YYYY-MM-DD` string.
    `SELECT p.products_id, p.products_model,
            pd.products_name,
            p.black_friday_deal, p.cyber_monday_deal, p.mega_friday_deal,
            s.specials_new_products_price,
            DATE_FORMAT(s.specials_date_available, '%Y-%m-%d') AS specials_date_available,
            DATE_FORMAT(s.expires_date, '%Y-%m-%d') AS expires_date,
            (ptc.products_id IS NOT NULL) AS thursday_in_cat
       FROM products p
       LEFT JOIN products_description pd
              ON pd.products_id = p.products_id AND pd.language_id = 1
       LEFT JOIN specials s
              ON s.products_id = p.products_id
       LEFT JOIN products_to_categories ptc
              ON ptc.products_id = p.products_id AND ptc.categories_id = 3221
      WHERE p.products_id IN (${placeholders})`,
    ...lookup.productIds
  );

  // 2. Per-size attributes for every mapped product. Legacy filters by
  //    `products_options.products_options_name LIKE '%size%'` (PQC:3849).
  const sizeRows = await prisma.$queryRawUnsafe<
    Array<{
      products_id: number | bigint;
      products_options_values_id: number | bigint;
      products_options_values_name: string | null;
      products_options_values_sort_order: number | bigint | null;
      product_attribute_sale_price_all: string | null;
      price_prefix: string | null;
      attribute_sale_start_date: string | null;
      attribute_sale_end_date: string | null;
    }>
  >(
    // DATE_FORMAT cast for the same reason as productRows above —
    // products_attributes rows commonly carry `0000-00-00` sentinels
    // when a size has no sale window, and Prisma's DATE parser blows up
    // on those.
    `SELECT pa.products_id,
            pov.products_options_values_id,
            pov.products_options_values_name,
            pov.products_options_values_sort_order,
            pa.product_attribute_sale_price_all,
            pa.price_prefix,
            DATE_FORMAT(pa.attribute_sale_start_date, '%Y-%m-%d') AS attribute_sale_start_date,
            DATE_FORMAT(pa.attribute_sale_end_date, '%Y-%m-%d') AS attribute_sale_end_date
       FROM products_attributes pa
       JOIN products_options po
              ON po.products_options_id = pa.options_id AND po.language_id = 1
       JOIN products_options_values pov
              ON pov.products_options_values_id = pa.options_values_id
             AND pov.language_id = 1
      WHERE pa.products_id IN (${placeholders})
        AND po.products_options_name LIKE '%size%'
      ORDER BY pov.products_options_values_sort_order ASC,
               pov.products_options_values_id ASC`,
    ...lookup.productIds
  );

  const sizesByProduct = new Map<number, SpecialStateSize[]>();
  for (const r of sizeRows) {
    const pid = Number(r.products_id);
    const arr = sizesByProduct.get(pid) ?? [];
    const prefix = r.price_prefix === '+' ? '+' : '-';
    arr.push({
      optionValueId: Number(r.products_options_values_id),
      name: String(r.products_options_values_name ?? ''),
      price: String(r.product_attribute_sale_price_all ?? '0'),
      prefix,
      startDate: fmtDate(r.attribute_sale_start_date),
      endDate: fmtDate(r.attribute_sale_end_date),
    });
    sizesByProduct.set(pid, arr);
  }

  let seedStart: string | null = null;
  let seedEnd: string | null = null;
  const products: SpecialStateProduct[] = [];
  // Preserve the order of lookup.productIds so the UI is stable.
  const byId = new Map<number, typeof productRows[number]>();
  for (const r of productRows) byId.set(Number(r.products_id), r);
  for (const pid of lookup.productIds) {
    const r = byId.get(pid);
    if (!r) continue;
    const start = fmtDate(r.specials_date_available);
    const end = fmtDate(r.expires_date);
    if (seedStart == null && start) {
      seedStart = start;
      seedEnd = end;
    }
    products.push({
      productsId: pid,
      productsName: String(r.products_name ?? ''),
      productsModel: String(r.products_model ?? ''),
      specialPrice: String(r.specials_new_products_price ?? ''),
      thursdayDeal: Number(r.thursday_in_cat ?? 0) === 1,
      blackFridayDeal: Number(r.black_friday_deal ?? 0) === 1,
      cyberMondayDeal: Number(r.cyber_monday_deal ?? 0) === 1,
      megaFridayDeal: Number(r.mega_friday_deal ?? 0) === 1,
      sizes: sizesByProduct.get(pid) ?? [],
    });
  }

  return {
    productCode,
    mappedProducts: products.length,
    tshirtBlocked: false,
    startDate: seedStart,
    endDate: seedEnd,
    products,
  };
}

export async function applyMapToZc(
  input: MapToZcInput,
  smsUserId: number
): Promise<MapToZcResult> {
  const { productCode, productIds, linkQuantity } = input;
  if (!productCode) throw new GridActionError('productCode required', 'INVALID_INPUT');
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new GridActionError('at least one productId required', 'NO_PRODUCTS');
  }

  return prisma.$transaction(async (tx) => {
    const plRows = await tx.$queryRawUnsafe<
      Array<{ product_lists_id: number; teams_id: number; quantity_map: number }>
    >(
      `SELECT product_lists_id, teams_id, quantity_map FROM product_lists WHERE product_code = ? LIMIT 1`,
      productCode
    );
    const pl = plRows[0];
    if (!pl) throw new GridActionError('product_lists row not found', 'PL_NOT_FOUND', 404);

    const productListsId = pl.product_lists_id;
    let totalSmsQty = 0;
    if (linkQuantity) {
      const sumRow = await tx.$queryRawUnsafe<Array<{ total: number | bigint | null }>>(
        `SELECT CAST(COALESCE(SUM(quantity), 0) AS SIGNED) AS total
           FROM product_quantities WHERE product_lists_id = ?`,
        productListsId
      );
      totalSmsQty = Number(sumRow[0]?.total ?? 0);
    }

    let affected = 0;
    for (const productsId of productIds) {
      // 1. UPDATE products — append product_code into products_model (legacy
      //    storefront uses CSV semantics so multiple SMS codes can map to one).
      //    Also pull products_quantity so the history row records the
      //    pre-update ZC stock — legacy reads it from this same row at this
      //    same point (categories_controller.php:435).
      const existing = await tx.$queryRawUnsafe<
        Array<{ products_model: string | null; products_quantity: number | bigint | null }>
      >(
        `SELECT products_model, products_quantity FROM products WHERE products_id = ? LIMIT 1`,
        productsId
      );
      const currentModel = existing[0]?.products_model ?? '';
      const currentZcQty = Number(existing[0]?.products_quantity ?? 0);
      const csvModel = currentModel
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!csvModel.includes(productCode)) csvModel.push(productCode);
      await tx.$executeRawUnsafe(
        `UPDATE products SET products_model = ?, quantity_map = ?,
                             products_quantity = ?, products_last_modified = NOW()
          WHERE products_id = ?`,
        csvModel.join(','),
        linkQuantity ? 1 : 0,
        linkQuantity ? totalSmsQty : 0,
        productsId
      );
      // Mirror to new_products.
      await tx.$executeRawUnsafe(
        `UPDATE new_products SET products_model = ?, quantity_map = ?, products_last_modified = NOW()
          WHERE products_id = ?`,
        csvModel.join(','),
        linkQuantity ? 1 : 0,
        productsId
      );

      // 2. product_lists_to_products UPSERT.
      const link = await tx.$queryRawUnsafe<Array<{ product_lists_to_products_id: number }>>(
        `SELECT product_lists_to_products_id
           FROM product_lists_to_products
          WHERE product_lists_id = ? AND products_id = ?
          LIMIT 1`,
        productListsId,
        productsId
      );
      if (link[0]) {
        await tx.$executeRawUnsafe(
          `UPDATE product_lists_to_products
              SET status = 1, sms_quantity = ?, modified_date = NOW()
            WHERE product_lists_to_products_id = ?`,
          totalSmsQty,
          link[0].product_lists_to_products_id
        );
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO product_lists_to_products
             (product_lists_id, product_code, products_id, zc_quantity, sms_quantity, status)
           VALUES (?, ?, ?, 0, ?, 1)`,
          productListsId,
          productCode,
          productsId,
          totalSmsQty
        );
      }

      // 3. History row (best-effort — table may not exist on every env).
      //    zc_quantity reads from the pre-update products.products_quantity
      //    to match legacy (categories_controller.php:435). Previously
      //    hardcoded to 0, which lost audit fidelity.
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO product_lists_to_products_histories
             (product_lists_id, products_id, product_code, sms_quantity, zc_quantity,
              status, action, sms_users_id, created)
           VALUES (?, ?, ?, ?, ?, 1, 'map', ?, NOW())`,
          productListsId,
          productsId,
          productCode,
          totalSmsQty,
          currentZcQty,
          smsUserId
        );
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'history insert skipped (schema mismatch)');
      }
      affected++;
    }

    // 4. product_lists.map_status + quantity_map.
    await tx.$executeRawUnsafe(
      `UPDATE product_lists
          SET map_status = 1, quantity_map = ?, modified = NOW()
        WHERE product_lists_id = ?`,
      linkQuantity ? 1 : 0,
      productListsId
    );

    // 5. stock_home_grid_lists cache patch.
    await directUpdateGridRow({
      set: { map: 'Mapped', quantity_map: linkQuantity ? 1 : 0 },
      where: { byProductCode: productCode },
      callerTag: 'deliveries/grid-actions/map',
    }, tx);

    logger.info(
      { productCode, productIds, linkQuantity, smsUserId, affected },
      'Map action committed'
    );
    return { productCode, productsAffected: affected, linkQuantity };
  });
}

// ---------------------------------------------------------------------------
// Special — set special price + dates (full legacy parity)
// ---------------------------------------------------------------------------
//
// Mirrors `product_quantities_controller::save_specials` (PQC:3941-4262):
//   - Per mapped products_id: INSERT/UPDATE `specials` with shared start/end
//     date and that row's individual price.
//   - UPDATE products.products_price_sorter; UPDATE new_products.specials_*.
//   - Toggle the four deal flags: products_to_categories (id=3221) for
//     Thursday Mega; products.{black_friday_deal,cyber_monday_deal,
//     mega_friday_deal} for the other three.
//   - For each posted (productsId, optionValueId) pair, UPDATE
//     products_attributes (sale price + price_prefix + sale dates).
//   - UPDATE product_lists.special + dates; cache write.
//   - If a row's price is empty ⇒ DELETE that specials row (legacy
//     PQC:4168-4177).

export interface SetSpecialSizeInput {
  optionValueId: number;
  price: number | null;
  prefix: '+' | '-';
  startDate: string;
  endDate: string;
}
export interface SetSpecialProductInput {
  productsId: number;
  /** Empty / null means "clear this product's specials row" (legacy parity). */
  price: number | null;
  thursdayDeal: boolean;
  blackFridayDeal: boolean;
  cyberMondayDeal: boolean;
  megaFridayDeal: boolean;
  sizes: SetSpecialSizeInput[];
}
export interface SetSpecialInput {
  productCode: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD' or '0001-01-01' for open-ended
  products: SetSpecialProductInput[];
}

export interface SetSpecialResult {
  productCode: string;
  productsAffected: number;
}

export async function applySetSpecial(
  input: SetSpecialInput,
  smsUserId: number
): Promise<SetSpecialResult> {
  const { productCode, startDate, endDate, products } = input;
  if (!productCode) throw new GridActionError('productCode required', 'INVALID_INPUT');
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(startDate) || !ymd.test(endDate)) {
    throw new GridActionError('startDate and endDate must be YYYY-MM-DD', 'INVALID_DATE');
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw new GridActionError('No products supplied.', 'NO_PRODUCTS', 400);
  }

  // Legacy stores '0001-01-01' from the UI as '0000-00-00' (PQC:3989, 4127-4128
  // — open-ended specials), so flip once here and reuse.
  const dbEndDate = endDate === '0001-01-01' ? '0000-00-00' : endDate;

  return prisma.$transaction(async (tx) => {
    const lookup = await findMappedProductIdsLegacy(tx, productCode, {
      requireMapStatus: true,
      honourTshirtBlock: true,
    });
    if (lookup.productListsId == null) {
      throw new GridActionError('product_lists row not found', 'PL_NOT_FOUND', 404);
    }
    if (lookup.tshirtBlocked) {
      throw new GridActionError(
        'You cannot set special price for Tshirt Virtual type product.',
        'TSHIRT_BLOCKED',
        400
      );
    }
    if (lookup.productIds.length === 0) {
      throw new GridActionError('No mapped products found.', 'NO_MAPPED_PRODUCTS', 400);
    }

    // Restrict submitted products to the mapped set — guard against
    // forged products_id values.
    const mapped = new Set(lookup.productIds);
    const submitted = products.filter((p) => mapped.has(p.productsId));
    if (submitted.length === 0) {
      throw new GridActionError('No mapped products in payload.', 'NO_MAPPED_PRODUCTS', 400);
    }

    let priced = 0;
    let topRowPrice: number | null = null;

    for (const p of submitted) {
      const productsId = p.productsId;
      const hasPrice = p.price != null && Number.isFinite(p.price) && p.price > 0;

      if (hasPrice) {
        priced++;
        if (topRowPrice == null) topRowPrice = p.price as number;

        const existing = await tx.$queryRawUnsafe<Array<{ specials_id: number }>>(
          `SELECT specials_id FROM specials WHERE products_id = ? LIMIT 1`,
          productsId
        );
        if (existing[0]) {
          await tx.$executeRawUnsafe(
            `UPDATE specials
                SET specials_new_products_price = ?,
                    specials_last_modified = NOW(),
                    expires_date = ?,
                    date_status_change = NOW(),
                    status = 1,
                    specials_date_available = ?
              WHERE specials_id = ?`,
            p.price,
            dbEndDate,
            startDate,
            existing[0].specials_id
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO specials
               (products_id, specials_new_products_price, specials_date_added,
                specials_last_modified, expires_date, date_status_change,
                status, specials_date_available)
             VALUES (?, ?, NOW(), NOW(), ?, NOW(), 1, ?)`,
            productsId,
            p.price,
            dbEndDate,
            startDate
          );
        }

        // products row: price sorter + deal bits (legacy PQC:4039,4061-4075).
        await tx.$executeRawUnsafe(
          `UPDATE products
              SET products_price_sorter = ?,
                  black_friday_deal = ?,
                  cyber_monday_deal = ?,
                  mega_friday_deal = ?,
                  products_last_modified = NOW()
            WHERE products_id = ?`,
          p.price,
          p.blackFridayDeal ? 1 : 0,
          p.cyberMondayDeal ? 1 : 0,
          p.megaFridayDeal ? 1 : 0,
          productsId
        );

        await tx.$executeRawUnsafe(
          `UPDATE new_products
              SET specials_price = ?, specials_status = 'Special',
                  products_last_modified = NOW()
            WHERE products_id = ?`,
          p.price,
          productsId
        );
      } else {
        // Empty price ⇒ delete the special (legacy PQC:4168-4177).
        await tx.$executeRawUnsafe(
          `DELETE FROM specials WHERE products_id = ?`,
          productsId
        );
        await tx.$executeRawUnsafe(
          `UPDATE products
              SET products_price_sorter = products_price,
                  black_friday_deal = ?,
                  cyber_monday_deal = ?,
                  mega_friday_deal = ?,
                  products_last_modified = NOW()
            WHERE products_id = ?`,
          p.blackFridayDeal ? 1 : 0,
          p.cyberMondayDeal ? 1 : 0,
          p.megaFridayDeal ? 1 : 0,
          productsId
        );
        await tx.$executeRawUnsafe(
          `UPDATE new_products
              SET specials_status = 'Not Special', specials_price = NULL,
                  products_last_modified = NOW()
            WHERE products_id = ?`,
          productsId
        );
      }

      // Thursday Mega Deal — category 3221 INSERT-if-absent
      // (legacy PQC:3993-4003,4220-4231).
      if (p.thursdayDeal) {
        const exists = await tx.$queryRawUnsafe<Array<{ products_id: number }>>(
          `SELECT products_id FROM products_to_categories
            WHERE products_id = ? AND categories_id = 3221 LIMIT 1`,
          productsId
        );
        if (exists.length === 0) {
          await tx.$executeRawUnsafe(
            `INSERT INTO products_to_categories (products_id, categories_id)
             VALUES (?, 3221)`,
            productsId
          );
        }
      } else {
        // Unchecked → remove the category link so the storefront stops
        // including this product in the Thursday Mega Deals list.
        await tx.$executeRawUnsafe(
          `DELETE FROM products_to_categories
            WHERE products_id = ? AND categories_id = 3221`,
          productsId
        );
      }

      // Per-size attributes (legacy PQC:4180-4196).
      for (const sz of p.sizes) {
        if (sz.price == null || !Number.isFinite(sz.price)) continue;
        const prefix = sz.prefix === '+' ? '+' : '-';
        const sStart = ymd.test(sz.startDate) ? sz.startDate : '0000-00-00';
        const sEnd = !ymd.test(sz.endDate) || sz.endDate === '0001-01-01'
          ? '0000-00-00'
          : sz.endDate;
        await tx.$executeRawUnsafe(
          `UPDATE products_attributes
              SET product_attribute_sale_price_all = ?,
                  price_prefix = ?,
                  attribute_sale_start_date = ?,
                  attribute_sale_end_date = ?
            WHERE products_id = ? AND options_values_id = ?`,
          sz.price,
          prefix,
          sStart,
          sEnd,
          productsId,
          sz.optionValueId
        );
      }
    }

    // product_lists shared dates + the top-level special flag (legacy
    // PQC:4090-4096). Only set special=1 when at least one priced row exists.
    await tx.$executeRawUnsafe(
      `UPDATE product_lists
          SET special = ?, special_start_date = ?, special_end_date = ?, modified = NOW()
        WHERE product_lists_id = ?`,
      priced > 0 ? 1 : 0,
      startDate,
      dbEndDate,
      lookup.productListsId
    );

    // Cache write — use the top-of-table priced row, mirroring legacy
    // setGridSpecial behaviour which uses the loop's price variable.
    await directUpdateGridRow({
      set: {
        special: priced > 0 ? 1 : 0,
        special_price: topRowPrice != null ? String(topRowPrice) : null,
        special_start_date: startDate,
        special_expiry_date: dbEndDate,
      },
      where: { byProductListsId: lookup.productListsId },
      callerTag: 'deliveries/grid-actions/special',
    }, tx);

    logger.info(
      { productCode, priced, total: submitted.length, startDate, endDate, smsUserId },
      'Special set'
    );
    return { productCode, productsAffected: priced };
  });
}

export async function applyClearSpecial(
  productCode: string,
  smsUserId: number
): Promise<{ productCode: string }> {
  if (!productCode) throw new GridActionError('productCode required', 'INVALID_INPUT');
  return prisma.$transaction(async (tx) => {
    // Legacy parity: clear is idempotent, so we don't require map_status = 1
    // and we don't honour the t-shirt block — operators must always be able
    // to remove a stale special. See JM8378 RCA / `findMappedProductIdsLegacy`.
    const lookup = await findMappedProductIdsLegacy(tx, productCode, {
      requireMapStatus: false,
      honourTshirtBlock: false,
    });
    if (lookup.productListsId == null) {
      throw new GridActionError('product_lists row not found', 'PL_NOT_FOUND', 404);
    }
    const pl = { product_lists_id: lookup.productListsId };
    const links = lookup.productIds.map((products_id) => ({ products_id }));
    for (const { products_id } of links) {
      await tx.$executeRawUnsafe(`DELETE FROM specials WHERE products_id = ?`, products_id);
      // Legacy parity (PQC:2810-2811, 2861-2875):
      //   - `products`: reset products_price_sorter back to products_price.
      //     There is no specials_price / specials_status column here.
      //   - `new_products.specials_status` = 'Not Special' (string),
      //     specials_price = NULL.
      await tx.$executeRawUnsafe(
        `UPDATE products
            SET products_price_sorter = products_price,
                products_last_modified = NOW()
          WHERE products_id = ?`,
        products_id
      );
      await tx.$executeRawUnsafe(
        `UPDATE new_products
            SET specials_status = 'Not Special', specials_price = NULL,
                products_last_modified = NOW()
          WHERE products_id = ?`,
        products_id
      );
    }
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET special = 0,
                                 special_start_date = '0000-00-00',
                                 special_end_date = '0000-00-00',
                                 modified = NOW()
        WHERE product_lists_id = ?`,
      pl.product_lists_id
    );
    await directUpdateGridRow({
      set: {
        special: 0,
        special_price: null,
        special_start_date: '0000-00-00',
        special_expiry_date: '0000-00-00',
      },
      where: { byProductListsId: pl.product_lists_id },
      callerTag: 'deliveries/grid-actions/special-clear',
    }, tx);
    logger.info({ productCode, smsUserId }, 'Special cleared');
    return { productCode };
  });
}

// ---------------------------------------------------------------------------
// Assign Font
// ---------------------------------------------------------------------------
//
// Legacy (IC:1358-1498):
//   - Reset all product_quantities.font_name to NULL for the product_lists_id.
//   - Apply font_name per size (multiple sizes can share a font).
//   - Toggle product_lists.font_assigned 'yes'/'no'.
//   - Cache patch via setGridFontAssigned.

export interface AssignFontInput {
  productCode: string;
  assignments: Array<{ fontName: string; sizeIds: number[] }>;
}

export interface AssignFontResult {
  productCode: string;
  fontAssigned: 'yes' | 'no';
  rowsTouched: number;
}

export async function applyAssignFont(
  input: AssignFontInput,
  smsUserId: number
): Promise<AssignFontResult> {
  const { productCode, assignments } = input;
  if (!productCode) throw new GridActionError('productCode required', 'INVALID_INPUT');

  return prisma.$transaction(async (tx) => {
    const plRows = await tx.$queryRawUnsafe<Array<{ product_lists_id: number }>>(
      `SELECT product_lists_id FROM product_lists WHERE product_code = ? LIMIT 1`,
      productCode
    );
    const pl = plRows[0];
    if (!pl) throw new GridActionError('product_lists row not found', 'PL_NOT_FOUND', 404);

    // Reset all
    await tx.$executeRawUnsafe(
      `UPDATE product_quantities SET font_name = NULL WHERE product_lists_id = ?`,
      pl.product_lists_id
    );

    let touched = 0;
    for (const a of assignments) {
      const fontName = (a.fontName ?? '').trim();
      if (!fontName) continue;
      for (const sizeId of a.sizeIds) {
        const upd = await tx.$executeRawUnsafe(
          `UPDATE product_quantities SET font_name = ?
            WHERE product_lists_id = ? AND size_id = ?`,
          fontName,
          pl.product_lists_id,
          sizeId
        );
        touched += Number(upd) || 0;
      }
    }

    const fontAssigned: 'yes' | 'no' = touched > 0 ? 'yes' : 'no';
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET font_assigned = ?, modified = NOW()
        WHERE product_lists_id = ?`,
      fontAssigned,
      pl.product_lists_id
    );

    await directUpdateGridRow({
      set: { assign_font: fontAssigned },
      where: { byProductListsId: pl.product_lists_id },
      callerTag: 'deliveries/grid-actions/assign-font',
    }, tx);

    logger.info({ productCode, fontAssigned, touched, smsUserId }, 'Assign font applied');
    return { productCode, fontAssigned, rowsTouched: touched };
  });
}

export async function getAssignFontState(productCode: string): Promise<{
  productCode: string;
  rows: Array<{ size_id: number; size_name: string; font_name: string | null }>;
}> {
  // Read existing per-size font assignments. Joins through
  // product_quantities → products_options_values_to_products_options →
  // products_options_values to get the size label.
  //
  // Legacy parity: `index_controller.php:1162-1174` does NOT apply a
  // `quantity > 0` filter, so zero-quantity sizes are still visible in the
  // dialog (legacy may assign fonts in advance of stock arriving).
  const rows = await prisma.$queryRawUnsafe<
    Array<{ size_id: number; size_name: string | null; font_name: string | null }>
  >(
    `SELECT pq.size_id,
            pov.products_options_values_name AS size_name,
            pq.font_name
       FROM product_lists pl
       JOIN product_quantities pq ON pq.product_lists_id = pl.product_lists_id
       LEFT JOIN products_options_values_to_products_options povtpo
              ON povtpo.products_options_values_to_products_options_id = pq.size_id
       LEFT JOIN products_options_values pov
              ON pov.products_options_values_id = povtpo.products_options_values_id
      WHERE pl.product_code = ?
      GROUP BY pq.size_id`,
    productCode
  );
  return {
    productCode,
    rows: rows.map((r) => ({
      size_id: r.size_id,
      size_name: r.size_name ?? `size ${r.size_id}`,
      font_name: r.font_name,
    })),
  };
}

// ---------------------------------------------------------------------------
// Font catalogue search — powers the searchable dropdown in the Assign Fonts
// dialog. Reads the legacy `fonts` table (column `font_name`).
//
// The dropdown calls this on every keystroke. Server-side LIKE keeps the
// payload small (limit 50) so the dropdown stays snappy on large catalogues.
// ---------------------------------------------------------------------------

export async function searchFonts(
  query: string,
  limit = 50
): Promise<Array<{ font_name: string }>> {
  const q = query.trim();
  // Escape user input for LIKE — % and _ are wildcards that should be
  // treated as literals when typed in the search box.
  const escaped = q.replace(/[\\%_]/g, '\\$&');
  // When the query is empty, return the first N alphabetical fonts so the
  // dropdown isn't blank on first open. Matches the typesense facet UX.
  const rows = q
    ? await prisma.$queryRawUnsafe<Array<{ font_name: string }>>(
        `SELECT DISTINCT font_name FROM fonts
          WHERE font_name LIKE ? ESCAPE '\\\\'
          ORDER BY font_name ASC
          LIMIT ?`,
        `%${escaped}%`,
        limit
      )
    : await prisma.$queryRawUnsafe<Array<{ font_name: string }>>(
        `SELECT DISTINCT font_name FROM fonts
          WHERE font_name IS NOT NULL AND font_name <> ''
          ORDER BY font_name ASC
          LIMIT ?`,
        limit
      );
  return rows.filter((r) => r.font_name);
}

// ---------------------------------------------------------------------------
// eBay flag (simple toggle for now — full per-SKU flow is large, deferred)
// ---------------------------------------------------------------------------
//
// Legacy `set_ebay_product` updates `on_marketplace.available_ebay_product_variation`
// per SKU and runs a cache rebuild. The MVP here exposes a per-SKU toggle.

export interface SetEbayInput {
  productCode: string;
  skuStates: Array<{ pa_sku: string; sentToEbay: 'yes' | 'no'; stockLevel?: number }>;
}

export interface SetEbayResult {
  productCode: string;
  updated: number;
}

export async function applySetEbay(
  input: SetEbayInput,
  smsUserId: number
): Promise<SetEbayResult> {
  const { productCode, skuStates } = input;
  if (!productCode) throw new GridActionError('productCode required', 'INVALID_INPUT');
  if (!skuStates?.length) return { productCode, updated: 0 };

  // Pre-resolve the product_lists row outside the transaction so we can fire
  // the cache rebuild after commit. The product_lists lookup is read-only
  // and not part of the write transaction.
  const plRows = await prisma.$queryRawUnsafe<Array<{ product_lists_id: number }>>(
    `SELECT product_lists_id FROM product_lists WHERE product_code = ? LIMIT 1`,
    productCode
  );
  const productListsId = plRows[0]?.product_lists_id ?? null;

  const result = await prisma.$transaction(async (tx) => {
    let updated = 0;
    for (const { pa_sku, sentToEbay, stockLevel } of skuStates) {
      // Legacy parity (ebay_products_controller.php:3066-3083):
      //   - When sentToEbay='yes': also set mark_for_ebay='manually'.
      //   - When sentToEbay='no':  zero out stock and omit mark_for_ebay.
      // The new code previously always wrote 'manually' regardless, which
      // caused unsent SKUs to re-enter the eBay sync queue on the next run.
      const setManually = sentToEbay === 'yes';
      const upd = await tx.$executeRawUnsafe(
        setManually
          ? `UPDATE on_marketplace
                SET available_ebay_product_variation = ?,
                    ebay_stock_level = ?,
                    mark_for_ebay = 'manually'
              WHERE pa_sku = ?`
          : `UPDATE on_marketplace
                SET available_ebay_product_variation = ?,
                    ebay_stock_level = ?
              WHERE pa_sku = ?`,
        sentToEbay,
        setManually ? (stockLevel ?? 0) : 0,
        pa_sku
      );
      updated += Number(upd) || 0;
    }

    // Legacy parity (ebay_products_controller.php:3087-3102): write the
    // product-level aggregate to product_feeds.available_ebay_products —
    // 'yes' if any SKU was sent, 'no' if none. Storefront product listings
    // read from this column, not from per-SKU on_marketplace rows.
    const aggregate = skuStates.some((s) => s.sentToEbay === 'yes') ? 'yes' : 'no';
    const skuPlaceholders = skuStates.map(() => '?').join(',');
    const productIdRows = await tx.$queryRawUnsafe<Array<{ products_id: number | bigint }>>(
      `SELECT DISTINCT products_id FROM products_attributes WHERE pa_sku IN (${skuPlaceholders})`,
      ...skuStates.map((s) => s.pa_sku)
    );
    for (const { products_id } of productIdRows) {
      await tx.$executeRawUnsafe(
        `UPDATE product_feeds SET available_ebay_products = ? WHERE pf_product_id = ?`,
        aggregate,
        Number(products_id)
      );
    }

    logger.info({ productCode, updated, smsUserId, aggregate }, 'eBay state updated');
    return { productCode, updated };
  });

  // Legacy parity (ebay_products_controller.php:3105-3119): mirror the
  // `addStockGridList()` invocation so the deliveries grid reflects eBay
  // state on the next read. Done outside the write transaction so a
  // rebuild failure doesn't roll back the actual eBay writes.
  if (productListsId != null) {
    try {
      await requestGridRebuild([productListsId], 'deliveries/grid-actions/ebay');
    } catch (e) {
      logger.warn(
        { err: (e as Error).message, productListsId },
        'grid rebuild after eBay save failed — legacy 30-min cron will heal'
      );
    }
  }

  return result;
}

export async function getEbayState(productCode: string): Promise<{
  productCode: string;
  rows: Array<{
    pa_sku: string;
    size_name: string | null;
    available_ebay_product_variation: 'yes' | 'no' | null;
    ebay_stock_level: number | null;
  }>;
}> {
  // Legacy parity: discover the products via products.products_model CSV
  // match instead of the product_lists_to_products join — same JM8378 issue
  // as Specials. eBay doesn't gate on map_status or t-shirt type, so both
  // options are off (mirrors `ebay_products_controller.php:3036`, which
  // reads from `ProductFeedVariation` keyed off the manufacturer part
  // number and is not coupled to the join table either).
  const lookup = await findMappedProductIdsLegacy(prisma, productCode, {
    requireMapStatus: false,
    honourTshirtBlock: false,
  });
  if (lookup.productIds.length === 0) {
    return { productCode, rows: [] };
  }
  const placeholders = lookup.productIds.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      pa_sku: string;
      size_name: string | null;
      available_ebay_product_variation: 'yes' | 'no' | null;
      ebay_stock_level: number | null;
    }>
  >(
    `SELECT pa.pa_sku,
            pov.products_options_values_name AS size_name,
            om.available_ebay_product_variation,
            om.ebay_stock_level
       FROM products_attributes pa
       LEFT JOIN products_options_values pov
              ON pov.products_options_values_id = pa.options_values_id
       LEFT JOIN on_marketplace om ON om.pa_sku = pa.pa_sku
      WHERE pa.products_id IN (${placeholders})
      GROUP BY pa.pa_sku`,
    ...lookup.productIds
  );
  return { productCode, rows };
}

// Tell TS the unused tx-typed import is intentional (Prisma.TransactionClient may
// be removed by tree shaking otherwise).
type _ensureTx = Prisma.TransactionClient;
