/**
 * Add-SMS-Product form services.
 *
 * Phase 3 scope:
 *  - `loadCreateEditProductForm` — GET form pre-fill (audit A.2 + A.3).
 *  - `submitForReview` — POST submit. Dispatches on `mappedProductId`:
 *      • empty  → Flow A: single-table write to `sms_products_for_review`.
 *      • present → Flow B: `editProduct`, the full 14-table edit of an
 *        already-mapped product (see `editProduct` below + §6.2 of the plan).
 *
 * Flow B IS live (it backs the "edit a mapped product" UI path,
 * CreateEditProductFormPage `isFlowB`). It is transactional and parameterised,
 * but it preserves a destructive legacy quirk: kit/attribute mappings are
 * DELETEd then conditionally re-INSERTed, so a Flow B save that omits grp_id /
 * attribute selections WIPES the existing rows. See the editProduct banner.
 * Source plan: documentation/deliveries-write-path-plan.md §6.2.
 *
 * The form-load reduces the legacy ~29 read sites (audit A.2) to a small set
 * of batched queries by:
 *  - Folding the `product_extra_info_type_options` N+1 (legacy L3439) into a
 *    single join + group_concat.
 *  - Reading `pre_save_sms_code_product_data` once instead of twice.
 *  - Dropping the dead-query at legacy L3323.
 */

import { Prisma, prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { config } from '../../config';
import { directUpdateGridRow } from './stock-grid-cache';
import type { SubmitForReviewBody } from './product-form.schema';

const logger = createLogger('deliveries.product-form');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ProductFormPreFill {
  productCode: string;
  /** Resolved when a mapped products row exists for this product code. */
  mappedProductId: number | null;
  /** Pre-save freelancer snapshot (Flow A pre-fill source). */
  preSave: PreSaveSnapshot | null;
  /** Mapped product fields (Flow B pre-fill source). */
  mapped: MappedProductSnapshot | null;
  /** Snapshot of a previously-submitted `sms_products_for_review` row, if any.
   *  Lets the form re-open with the user's last-entered values intact —
   *  legacy doesn't do this (it always rebuilds from product_lists), but the
   *  user explicitly asked for it so manual edits aren't lost on reopen. */
  reviewSnapshot: ReviewSnapshot | null;
  /** Season + barcode + product_name from product_lists join.
   *  Also exposes `manufacturers_id` / `product_type` so the form can fall
   *  back to product_lists when the pcode hasn't been pre-saved or mapped yet
   *  (e.g. fresh deliveries codes that only exist in product_lists). */
  productList: {
    productName: string;
    season: string;
    seasonSort: number;
    barcode: string | null;
    manufacturersId: number | null;
    productType: number | null;
    teamsId: number | null;
    /** Parsed `product_lists.products_attributes` JSON. The deliveries feed
     *  stores legacy form values as e.g. `{"team":"Manchester United",
     *  "season":"2026-2027","color":"Red","sleeve_length":"Short Sleeve",
     *  "gender":"Male","age_group":"adult","size_guide":"Adults",...}`.
     *  Used as a name-match fallback when the pcode has no row in
     *  pre_save_sms_code_product_data and no mapping to new_products — the
     *  KC4908 case where every extra-info dropdown would otherwise be blank. */
    productAttributes: Record<string, string> | null;
  } | null;
  /** Dropdowns. */
  dropdowns: FormDropdowns;
  /** Mandatory-yellow-highlight: fields with a pre-save value uploaded. */
  prefilledMandatoryFields: string[];
  /** Hero-shirt queue state (0/1/2). */
  heroShirtQueue: number;
  /**
   * Single size group resolved via the legacy chain for this product code:
   *   stock_home_grid_lists.size_id
   *     → manufacturers_sizes_to_default_sizes.default_options_values_id
   *     → products_options_values_to_products_options.products_options_id
   * Falls back to pre_save_sms_code_product_data.pscpd_products_options_id.
   * `null` when no size group can be resolved — the React form then shows the
   * full size attribute list as a safety net.
   */
  sizeAttributesForPcode: FormDropdowns['sizeAttributes'][number] | null;
  /**
   * povtpo ids that should be pre-checked under the resolved size group.
   *
   * Legacy logic: every row in `manufacturers_sizes_to_default_sizes` carries
   * a `default_selected_size` flag tying a manufacturers_options_values_id
   * (= povtpo PK) to a `sms_size_groups_id` (e.g. 21 = "Adidas Adult Shirts").
   * The pcode's size group is looked up via `stock_home_grid_lists.size_id`
   * → that row's `sms_size_groups_id`. All povtpos with `default_selected_size
   * = 1` in that group are pre-checked. The remaining povtpos for the same
   * `manufacturers_options_id` (= "Adidas Size" group) render unchecked.
   *
   * Empty array when the pcode has no size_id or no sms_size_groups_id is
   * resolvable (Flow A pre-save row absent + no stock_home_grid_lists entry).
   */
  defaultSelectedSizeAttrs: number[];
  /**
   * Server-resolved names for the typesense-backed fields. The frontend
   * combobox value props are strings, so resolving these here lets the form
   * render pre-populated tags without needing client-side id→name lookups
   * against the cached dropdowns list (which can miss).
   */
  preSelectedNames: {
    manufacturer: string | null;
    teamCategory: string | null;
    season: string | null;
    sizeGuide: string | null;
    sleeveLength: string | null;
    gloveType: string | null;
    ageGroup: string | null;
    gender: string | null;
    productTypeAttribute: string | null;
    driver: string | null;
    nameNumberSetting: string | null;
    colors: string[];
  };
}

export interface PreSaveSnapshot {
  pscpd_id: number;
  pscpd_code: string;
  pscpd_cost_price: string | null;
  pscpd_title: string | null;
  // NB: the real column is `pscpd_teamzo_product_title` (verified against
  // INFORMATION_SCHEMA on staging). Earlier draft used `pscpd_teamzo_title`,
  // which 500'd the form load.
  pscpd_teamzo_product_title: string | null;
  pscpd_size_guide: number | null;
  pscpd_sleeve_length: number | null;
  pscpd_season_id: number | null;
  pscpd_colour: string | null;
  pscpd_type: number | null;
  pscpd_manufacturers_id: number | null;
  pscpd_category_id: number | null;
  pscpd_price: string | null;
  pscpd_teamzo_price: string | null;
  pscpd_rrp_price: string | null;
  pscpd_printing: string | null;
  pscpd_patch: string | null;
  /** Player suggestions live in three discrete columns, not a serialised list. */
  pscpd_player1: string | null;
  pscpd_player2: string | null;
  pscpd_player3: string | null;
  pscpd_hero_shirt_queue: number | null;
  pscpd_products_options_id: number | null;
  pscpd_sms_size_groups_id: number | null;
}

export interface MappedProductSnapshot {
  products_id: number;
  products_model: string | null;
  products_name: string | null;
  products_description: string | null;
  products_price: string | null;
  products_rrp_price: string | null;
  manufacturers_id: number | null;
  master_categories_id: number | null;
  products_type: number | null;
  teamzo_name: string | null;
  selectedAttributes: Array<{
    options_id: number;
    options_values_id: number;
    options_values_price: string | null;
  }>;
  categoryIds: number[];
  extraInfo: Array<{ tId: number; oid: number }>;
  teamCustomKit: { groupname_id: number; size_id: number } | null;
}

/**
 * Subset of `sms_products_for_review` columns we re-hydrate the form from on
 * reopen. Numeric ids (manufacturer / season / size_guide etc.) are resolved
 * to names client-side via the loaded dropdowns payload, exactly like the
 * other pre-fill sources. CSV columns are kept as-is — the client splits.
 */
export interface ReviewSnapshot {
  spr_id: number;
  product_name: string | null;
  teamzo_product_name: string | null;
  product_description: string | null;
  product_price: string | null;
  teamzo_price: string | null;
  rrp_price: string | null;
  product_manufacturer: number | null;
  master_category_id: number | null;
  /** product_types.type_id — the top-level Product Type. */
  products_type: number | null;
  /** product_extra_info_type_options.oid (type 5 = Season). Legacy stores
   *  the OID here, not seasons.seasons_id — the review form re-renders the
   *  Season dropdown from product_extra_info_type_options. See
   *  add_sms_products_controller.php L5638. */
  product_season: number | null;
  season_sort_order: number | null;
  /** extra_info OID for type 1 (size guide). */
  product_sizeguide: number | null;
  /** CSV of extra_info OIDs (type 3, colors). */
  product_color: string | null;
  /** CSV of attribute ids: printing checkboxes (261/5781/5762) AND povtpo ids
   *  of selected sizes. */
  is_printing: string | null;
  /** Comma-joined player1,player2,player3 (legacy CSV). */
  players_name: string | null;
  /** Saved image filename(s) — useful for the form to know an image is on
   *  file even before re-upload. */
  product_image: string | null;
  product_additional_images: string | null;
  /** Legacy CSV `<option_value_id>:<price>,…`. */
  sleeve_patch: string | null;
  /** OID for type 2 (sleeve length). */
  sleeve_length: string | null;
  /** OID for Glove Type. */
  glove_type: number | null;
  /** OID for Driver. */
  driver: number | null;
  /** products_options_id (e.g. 72 = Adidas Size). */
  product_size_option_id: number | null;
  /** CSV of products_options_values_id. */
  product_size_option_value_ids: string | null;
  sms_size_groups_id: number | null;
  /** Categories selected under master_category_id, stored as
   *  `#cat#,#cat#,...` per legacy L5510. */
  product_categories: string | null;
}

export interface FormDropdowns {
  leagues: Array<{ id: number; name: string }>;
  genericProductTypes: Array<{ id: number; name: string }>;
  productTypes: Array<{ id: number; name: string }>;
  manufacturers: Array<{ id: number; name: string }>;
  teamCategories: Array<{ id: number; name: string }>;
  trainingWearCategories: Array<{ id: number; name: string }>;
  teamGroups: Array<{ id: number; name: string }>;
  /** product_extra_info_type id → options. Folded N+1. */
  extraInfoTypes: Array<{
    id: number;
    name: string;
    options: Array<{ oid: number; option_name: string }>;
  }>;
  /** Sleeve patch values with default price. */
  sleevePatches: Array<{
    products_options_values_to_products_options_id: number;
    products_options_values_name: string;
    options_values_price: string;
  }>;
  /** Printing-style attribute rows (Name&Number 261, Shorts Numbers 5781, Trainers 5762, etc.).
   *  These are the attribute ids that appear as checkboxes on the legacy form. */
  printingAttributes: Array<{
    products_options_values_to_products_options_id: number;
    products_options_values_name: string;
    default_price: string;
    options_id: number;
  }>;
  /** Available size attributes grouped by options_id (e.g. Adults, Boys, Kids).
   *  Legacy reads `products_options LIKE '%size%'` and renders one block per. */
  sizeAttributes: Array<{
    options_id: number;
    options_name: string;
    values: Array<{
      products_options_values_to_products_options_id: number;
      products_options_values_id: number;
      products_options_values_name: string;
      default_price: string;
    }>;
  }>;
  /** Sub-categories under each master/team category (PMS 130032 secondary list).
   *  We expose the full list and the React form filters by master_category. */
  subCategoriesByParent: Array<{
    parent_id: number;
    categories_id: number;
    categories_name: string;
  }>;
}

// ---------------------------------------------------------------------------
// Form load
// ---------------------------------------------------------------------------

// Column list verified against INFORMATION_SCHEMA.COLUMNS on staging
// (ukssmain.pre_save_sms_code_product_data). Per CLAUDE.md rule #6, never
// assume column names — change here only after re-running the schema query.
const PRE_SAVE_FIELDS = `
  pscpd_id, pscpd_code, pscpd_cost_price, pscpd_title, pscpd_teamzo_product_title,
  pscpd_size_guide, pscpd_sleeve_length, pscpd_season_id, pscpd_colour,
  pscpd_type, pscpd_manufacturers_id, pscpd_category_id, pscpd_price,
  pscpd_teamzo_price, pscpd_rrp_price, pscpd_printing, pscpd_patch,
  pscpd_player1, pscpd_player2, pscpd_player3,
  pscpd_hero_shirt_queue, pscpd_products_options_id,
  pscpd_sms_size_groups_id
`;

export async function loadCreateEditProductForm(
  productCode: string
): Promise<ProductFormPreFill> {
  // Independent reads — fire in parallel. Mapped snapshot + hero-shirt-queue
  // can only start once we know `mappedProductId`, but that resolution itself
  // is independent of preSave / productList / dropdowns and runs alongside.
  const [preSave, productList, mappedProductId, dropdowns, reviewSnapshot] =
    await Promise.all([
      loadPreSave(productCode),
      loadProductList(productCode),
      resolveMappedProductId(productCode),
      loadFormDropdowns(),
      loadReviewSnapshot(productCode),
    ]);

  const [mapped, mappedHeroQueue] = mappedProductId
    ? await Promise.all([
        loadMappedSnapshot(mappedProductId),
        loadHeroShirtQueue(mappedProductId),
      ])
    : [null, null];

  const heroShirtQueue =
    mappedProductId != null ? mappedHeroQueue ?? 0 : preSave?.pscpd_hero_shirt_queue ?? 0;

  const prefilledMandatoryFields = computeMandatoryHighlightList(preSave);

  const sizeGroupId = await resolveProductSizeGroupId(productCode, preSave);
  const sizeAttributesForPcode = sizeGroupId
    ? dropdowns.sizeAttributes.find((g) => g.options_id === sizeGroupId) ?? null
    : null;

  const defaultSelectedSizeAttrs =
    sizeGroupId != null
      ? await resolveDefaultSelectedSizeAttrs(productCode, sizeGroupId, preSave)
      : [];

  const preSelectedNames = resolvePreSelectedNames({
    preSave,
    mapped,
    reviewSnapshot,
    productList,
    dropdowns,
  });

  return {
    productCode,
    mappedProductId,
    preSave,
    mapped,
    reviewSnapshot,
    productList,
    dropdowns,
    prefilledMandatoryFields,
    heroShirtQueue: Number(heroShirtQueue ?? 0),
    sizeAttributesForPcode,
    defaultSelectedSizeAttrs,
    preSelectedNames,
  };
}

async function loadReviewSnapshot(
  productCode: string
): Promise<ReviewSnapshot | null> {
  // Read the latest sms_products_for_review row for the pcode so the form can
  // re-hydrate the user's previously-submitted values on reopen. Columns are
  // a subset of the full schema — anything the form can't round-trip (e.g.
  // age_group / gender, which never make it to SPR columns) is skipped here.
  return await safeQuery(
    'reviewSnapshot',
    async () => {
      const rows = await prisma.$queryRawUnsafe<ReviewSnapshot[]>(
        `SELECT spr_id, product_name, teamzo_product_name, product_description,
                product_price, teamzo_price, rrp_price,
                product_manufacturer, master_category_id, products_type,
                product_season, season_sort_order, product_sizeguide,
                product_color, is_printing, players_name,
                product_image, product_additional_images,
                sleeve_patch, sleeve_length, glove_type, driver,
                product_size_option_id, product_size_option_value_ids,
                sms_size_groups_id, product_categories
           FROM sms_products_for_review
          WHERE product_code = ?
          ORDER BY spr_id DESC
          LIMIT 1`,
        productCode
      );
      return rows[0] ?? null;
    },
    null
  );
}

/**
 * Resolve which povtpo ids should be pre-checked in the Attributes size grid.
 *
 * Legacy precedent: rows in `manufacturers_sizes_to_default_sizes` carry a
 * `default_selected_size` flag tying a `manufacturers_options_values_id` (=
 * the povtpo PK) to a `sms_size_groups_id` (e.g. 21 = "Adidas Adult Shirts").
 * Path:
 *   1. `stock_home_grid_lists.size_id` for the pcode → look that up as
 *      `manufacturers_sizes_to_default_sizes.manufacturers_options_values_id`
 *      to discover the row's `sms_size_groups_id`. This works even when the
 *      pcode only has stock under a single size (KC4908 only has size 4432
 *      in stock_home_grid_lists, but the row's group still resolves the rest
 *      of the Adidas Adult Shirts sizes).
 *   2. Fall back to `pre_save_sms_code_product_data.pscpd_sms_size_groups_id`
 *      if no stock row exists.
 *   3. Return every `manufacturers_options_values_id` in that sms_size_group
 *      where `default_selected_size = 1` AND `manufacturers_options_id =
 *      sizeGroupId` (the parent options_id, e.g. 72 Adidas Size).
 *
 * Empty array when no group can be resolved — the form then renders all
 * sizes unchecked.
 */
async function resolveDefaultSelectedSizeAttrs(
  productCode: string,
  sizeGroupId: number,
  preSave: PreSaveSnapshot | null
): Promise<number[]> {
  return await safeQuery(
    'defaultSelectedSizeAttrs',
    async () => {
      // Step 1: resolve sms_size_groups_id.
      let smsSizeGroupsId: number | null = null;

      const sizeRows = await prisma.$queryRawUnsafe<
        Array<{ size_id: number | null }>
      >(
        `SELECT size_id FROM stock_home_grid_lists WHERE product_code = ? LIMIT 1`,
        productCode
      );
      const sizeId = sizeRows[0]?.size_id;
      if (sizeId) {
        const groupRows = await prisma.$queryRawUnsafe<
          Array<{ sms_size_groups_id: number | null }>
        >(
          `SELECT sms_size_groups_id
             FROM manufacturers_sizes_to_default_sizes
            WHERE manufacturers_options_values_id = ?
            LIMIT 1`,
          sizeId
        );
        smsSizeGroupsId = groupRows[0]?.sms_size_groups_id ?? null;
      }

      if (!smsSizeGroupsId && preSave?.pscpd_sms_size_groups_id) {
        smsSizeGroupsId = Number(preSave.pscpd_sms_size_groups_id) || null;
      }

      if (!smsSizeGroupsId) return [];

      // Step 2: list pre-selected povtpo ids in that group.
      const rows = await prisma.$queryRawUnsafe<
        Array<{ povtpo_id: number }>
      >(
        `SELECT manufacturers_options_values_id AS povtpo_id
           FROM manufacturers_sizes_to_default_sizes
          WHERE sms_size_groups_id = ?
            AND manufacturers_options_id = ?
            AND default_selected_size = 1`,
        smsSizeGroupsId,
        sizeGroupId
      );
      return rows.map((r) => Number(r.povtpo_id)).filter((n) => Number.isFinite(n));
    },
    []
  );
}

/**
 * Resolve the products_options_id ("size group", e.g. "Adidas Size") that was
 * chosen at product creation. Mirrors legacy `add_sms_products_controller.php`
 * L3389-3416.
 *
 * Legacy reads `stock_home_grid_lists.size_id` and uses it **directly** as
 * `products_options_values_to_products_options_id` (the junction-table PK) in
 * the second lookup. The check against `manufacturers_sizes_to_default_sizes`
 * exists only as a sanity gate — `default_options_values_id` is fetched and
 * never used in the resolution.
 *
 * Earlier port mistakenly used `default_options_values_id` as the lookup
 * value against `products_options_values_id` (a different column on povtpo),
 * which for KC4908 resolved to options_id=1 (generic "Size") instead of 72
 * (Adidas Size). End result: the Attributes section rendered every size from
 * a catch-all group instead of just the manufacturer's sizes.
 */
async function resolveProductSizeGroupId(
  productCode: string,
  preSave: PreSaveSnapshot | null
): Promise<number | null> {
  return await safeQuery('sizeGroupForPcode', async () => {
    const sizeRows = await prisma.$queryRawUnsafe<Array<{ size_id: number | null }>>(
      `SELECT size_id FROM stock_home_grid_lists WHERE product_code = ? LIMIT 1`,
      productCode
    );
    const sizeId = sizeRows[0]?.size_id;
    if (sizeId) {
      const manfRows = await prisma.$queryRawUnsafe<
        Array<{ manufacturers_sizes_to_default_sizes_id: number | null }>
      >(
        `SELECT manufacturers_sizes_to_default_sizes_id
           FROM manufacturers_sizes_to_default_sizes
          WHERE manufacturers_options_values_id = ?
          LIMIT 1`,
        sizeId
      );
      if (manfRows[0]) {
        // Sanity gate passed — now use size_id as the povtpo PK.
        const optRows = await prisma.$queryRawUnsafe<
          Array<{ products_options_id: number | null }>
        >(
          `SELECT products_options_id
             FROM products_options_values_to_products_options
            WHERE products_options_values_to_products_options_id = ?
            LIMIT 1`,
          sizeId
        );
        const optionId = optRows[0]?.products_options_id;
        if (optionId) return optionId;
      }
    }
    if (preSave?.pscpd_products_options_id) {
      return Number(preSave.pscpd_products_options_id) || null;
    }
    return null;
  }, null);
}

function resolvePreSelectedNames(args: {
  preSave: PreSaveSnapshot | null;
  mapped: MappedProductSnapshot | null;
  reviewSnapshot: ReviewSnapshot | null;
  productList: ProductFormPreFill['productList'];
  dropdowns: FormDropdowns;
}): ProductFormPreFill['preSelectedNames'] {
  const { preSave, mapped, reviewSnapshot, productList, dropdowns } = args;

  const nameFromList = (
    list: Array<{ id: number; name: string }>,
    id: number | null | undefined
  ): string | null => (id ? list.find((x) => x.id === id)?.name ?? null : null);

  const nameFromExtra = (typeId: number, oid: number | null | undefined): string | null => {
    if (!oid) return null;
    const t = dropdowns.extraInfoTypes.find((x) => x.id === typeId);
    return t?.options.find((o) => o.oid === oid)?.option_name ?? null;
  };

  // Find extra-info-type id by its (legacy) display name. Legacy and the new
  // codebase disagree on numeric ids, so resolve by name at runtime.
  const findTypeIdByName = (name: string): number | null => {
    const wanted = name.trim().toLowerCase();
    return (
      dropdowns.extraInfoTypes.find((t) => (t.name ?? '').trim().toLowerCase() === wanted)
        ?.id ?? null
    );
  };

  const extraNamesForType = (typeId: number, oids: number[]): string[] => {
    const t = dropdowns.extraInfoTypes.find((x) => x.id === typeId);
    if (!t) return [];
    return oids
      .map((oid) => t.options.find((o) => o.oid === oid)?.option_name)
      .filter((n): n is string => !!n);
  };

  // Flow B: read from product_extra_info (oid, tId) tuples.
  const mappedExtraNames = (typeId: number | null): string[] => {
    if (!mapped || typeId == null) return [];
    const oids = mapped.extraInfo.filter((e) => e.tId === typeId).map((e) => e.oid);
    return extraNamesForType(typeId, oids);
  };

  // Flow A: read from pre_save scalar columns. Each pscpd_* holds a single oid
  // (or CSV in the case of pscpd_colour).
  const flowAName = (typeId: number, oid: number | null | undefined): string | null =>
    nameFromExtra(typeId, oid ?? null);

  // ── product_lists.products_attributes fallback ─────────────────────────
  // Maps each pre-fillable field to the JSON key the deliveries feed uses.
  // The values are display names — match them case-insensitively against the
  // extra-info options for the typeId, and discard names that don't exist
  // (avoid pre-filling a value the user can't see in the dropdown).
  const productAttrs = productList?.productAttributes ?? null;
  const fromProductAttrs = (typeId: number, key: string): string | null => {
    const raw = productAttrs?.[key];
    if (!raw) return null;
    const t = dropdowns.extraInfoTypes.find((x) => x.id === typeId);
    if (!t) return null;
    const norm = raw.trim().toLowerCase();
    return (
      t.options.find((o) => o.option_name.trim().toLowerCase() === norm)?.option_name ??
      null
    );
  };

  // Convenience picker that prefers Flow B (mapped) when present, else Flow A
  // pre-save, else the deliveries feed JSON.
  const pickByExtraType = (
    typeId: number,
    flowAOid: number | null | undefined,
    productAttrKey?: string
  ): string | null => {
    if (mapped) {
      const name = mappedExtraNames(typeId)[0];
      if (name) return name;
    }
    const flowA = flowAName(typeId, flowAOid);
    if (flowA) return flowA;
    if (productAttrKey) return fromProductAttrs(typeId, productAttrKey);
    return null;
  };
  const pickColors = (): string[] => {
    if (mapped) {
      const names = mappedExtraNames(3);
      if (names.length) return names;
    }
    // SPR `product_color` is CSV of OIDs — same format as pscpd_colour.
    if (reviewSnapshot?.product_color) {
      const names = reviewSnapshot.product_color
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => nameFromExtra(3, Number(s)))
        .filter((n): n is string => !!n);
      if (names.length) return names;
    }
    if (preSave?.pscpd_colour) {
      const names = preSave.pscpd_colour
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => nameFromExtra(3, Number(s)))
        .filter((n): n is string => !!n);
      if (names.length) return names;
    }
    // product_lists JSON colors — also CSV, but values are *names*.
    const raw = productAttrs?.color;
    if (!raw) return [];
    const colorType = dropdowns.extraInfoTypes.find((x) => x.id === 3);
    if (!colorType) return [];
    const out: string[] = [];
    for (const piece of raw.split(',')) {
      const wanted = piece.trim().toLowerCase();
      if (!wanted) continue;
      const hit = colorType.options.find(
        (o) => o.option_name.trim().toLowerCase() === wanted
      );
      if (hit) out.push(hit.option_name);
    }
    return out;
  };

  const gloveTypeId = findTypeIdByName('Glove Type');
  const ageGroupTypeId = findTypeIdByName('Age Group');
  const genderTypeId = findTypeIdByName('Gender');
  const productTypeAttrTypeId = findTypeIdByName('Product Type');
  const driverTypeId = findTypeIdByName('Driver') ?? 8;

  // Source precedence for ID-keyed fields: mapped (new_products) → pre-save
  // (uploaded staging data) → product_lists (deliveries feed). product_lists
  // is the source of truth for fresh delivery codes that haven't been mapped
  // or pre-saved yet — without this fallback, KC4908-style pcodes show every
  // ID-keyed dropdown blank even though `product_lists.manufacturers_id` etc.
  // are populated.
  // sleeve_length on SPR is varchar (legacy stored extra-info OID as string)
  // — coerce to number so it slots into the OID-keyed name lookup.
  const reviewSleeveLengthOid = reviewSnapshot?.sleeve_length
    ? Number(reviewSnapshot.sleeve_length) || null
    : null;

  // Season rehydration uses preSave.pscpd_season_id (an OID) first, then
  // falls back to product_attributes JSON. SPR's product_season is now ALSO
  // an OID (post legacy-parity fix), so we could read it here too — but
  // keeping the existing chain unchanged means no behavioural drift on
  // reopen for pcodes already in the queue.

  return {
    manufacturer: nameFromList(
      dropdowns.manufacturers,
      mapped?.manufacturers_id ??
        reviewSnapshot?.product_manufacturer ??
        preSave?.pscpd_manufacturers_id ??
        productList?.manufacturersId ??
        null
    ),
    teamCategory: nameFromList(
      dropdowns.teamCategories,
      mapped?.master_categories_id ??
        reviewSnapshot?.master_category_id ??
        preSave?.pscpd_category_id ??
        null
    ),
    // The "Size Guide" attribute lives at extra-info type 1 in this code's
    // current data; the field map matches loadFormDropdowns naming. The third
    // arg is the matching `product_lists.products_attributes` JSON key —
    // legacy uses snake_case keys (e.g. `size_guide`, `sleeve_length`).
    // reviewSnapshot.product_sizeguide / .sleeve_length / .glove_type /
    // .driver are extra_info OIDs we feed in below so the user's last
    // submission wins on reopen.
    sizeGuide: pickByExtraType(
      1,
      reviewSnapshot?.product_sizeguide ?? preSave?.pscpd_size_guide,
      'size_guide'
    ),
    sleeveLength: pickByExtraType(
      2,
      reviewSleeveLengthOid ?? preSave?.pscpd_sleeve_length,
      'sleeve_length'
    ),
    season: pickByExtraType(5, preSave?.pscpd_season_id, 'season'),
    gloveType: gloveTypeId
      ? pickByExtraType(gloveTypeId, reviewSnapshot?.glove_type ?? null, 'glove_type')
      : null,
    ageGroup: ageGroupTypeId ? pickByExtraType(ageGroupTypeId, null, 'age_group') : null,
    gender: genderTypeId ? pickByExtraType(genderTypeId, null, 'gender') : null,
    productTypeAttribute: productTypeAttrTypeId
      ? pickByExtraType(productTypeAttrTypeId, null, 'product_type')
      : null,
    driver: driverTypeId
      ? pickByExtraType(driverTypeId, reviewSnapshot?.driver ?? null, 'driver')
      : null,
    nameNumberSetting: pickByExtraType(4, null),
    colors: pickColors(),
  };
}

async function loadPreSave(productCode: string): Promise<PreSaveSnapshot | null> {
  const rows = await prisma.$queryRawUnsafe<PreSaveSnapshot[]>(
    `SELECT ${PRE_SAVE_FIELDS} FROM pre_save_sms_code_product_data WHERE pscpd_code = ? LIMIT 1`,
    productCode
  );
  return rows[0] ?? null;
}

async function loadProductList(
  productCode: string
): Promise<ProductFormPreFill['productList']> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      product_name: string | null;
      season: string | null;
      sort: number | null;
      barcode: string | null;
      manufacturers_id: number | null;
      product_type: number | null;
      teams_id: number | null;
      products_attributes: string | null;
    }>
  >(
    `SELECT pl.product_name, s.season, s.sort, pq.barcode,
            pl.manufacturers_id, pl.product_type, pl.teams_id,
            pl.products_attributes
       FROM product_lists pl
       LEFT JOIN seasons s ON s.seasons_id = pl.seasons_id
       LEFT JOIN product_quantities pq ON pq.product_lists_id = pl.product_lists_id
      WHERE pl.product_code = ?
      LIMIT 1`,
    productCode
  );
  if (!rows[0]) return null;

  // Parse the JSON column once here so callers don't repeat the try/catch.
  // The column is plain VARCHAR in legacy and may hold malformed JSON or be
  // missing entirely; treat that as "no attributes" rather than 500'ing.
  let productAttributes: Record<string, string> | null = null;
  const raw = rows[0].products_attributes;
  if (raw && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        productAttributes = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') productAttributes[k] = v;
        }
      }
    } catch (err) {
      logger.warn(
        { productCode, err: (err as Error).message },
        'product_lists.products_attributes JSON parse failed'
      );
    }
  }

  return {
    productName: rows[0].product_name ?? '',
    season: rows[0].season ?? '',
    seasonSort: Number(rows[0].sort ?? 0),
    barcode: rows[0].barcode,
    manufacturersId:
      rows[0].manufacturers_id != null ? Number(rows[0].manufacturers_id) : null,
    productType:
      rows[0].product_type != null ? Number(rows[0].product_type) : null,
    teamsId: rows[0].teams_id != null ? Number(rows[0].teams_id) : null,
    productAttributes,
  };
}

async function resolveMappedProductId(productCode: string): Promise<number | null> {
  if (!productCode) return null;
  // FIND_IN_SET matches the exact CSV token in `products_model` directly on
  // the DB side. Previously this used `LIKE '%pcode%' LIMIT 50` and split the
  // CSV in JS, which forced a full scan and then a partial-match loop.
  const rows = await prisma.$queryRawUnsafe<Array<{ products_id: number }>>(
    `SELECT products_id FROM new_products
      WHERE FIND_IN_SET(?, REPLACE(products_model, ' ', '')) > 0
      ORDER BY products_id DESC
      LIMIT 1`,
    productCode
  );
  return rows[0]?.products_id ?? null;
}

function computeMandatoryHighlightList(preSave: PreSaveSnapshot | null): string[] {
  // Mirrors legacy L3116-3137. Fields that are present and non-zero/non-empty
  // in pre_save get added; the view negates this list for the yellow highlight.
  if (!preSave) return [];
  const out: string[] = [];
  if (preSave.pscpd_size_guide && Number(preSave.pscpd_size_guide) > 0)
    out.push('Size Guide');
  if (preSave.pscpd_sleeve_length && Number(preSave.pscpd_sleeve_length) > 0)
    out.push('Sleeve Length');
  if (preSave.pscpd_season_id && Number(preSave.pscpd_season_id) > 0)
    out.push('Season');
  if (preSave.pscpd_colour && String(preSave.pscpd_colour).trim() !== '')
    out.push('Color');
  if (preSave.pscpd_type && Number(preSave.pscpd_type) > 0)
    out.push('Product Type');
  if (preSave.pscpd_title && String(preSave.pscpd_title).trim() !== '')
    out.push('Product Title');
  if (preSave.pscpd_manufacturers_id && Number(preSave.pscpd_manufacturers_id) > 0)
    out.push('Manufacturers');
  return out;
}

/**
 * Defensive query helper. Multiple legacy tables don't follow naming
 * conventions and a single bad reference would crash the whole `Promise.all`.
 * Treat each dropdown as best-effort; log+swallow on schema mismatch so the
 * form still loads with the other dropdowns populated.
 */
async function safeQuery<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ label, err: (err as Error).message }, 'form-load dropdown query failed');
    return fallback;
  }
}

async function loadMappedSnapshot(
  mappedProductId: number
): Promise<MappedProductSnapshot> {
  const [prodRows, descRows, teamzoRows, attrRows, catRows, extraRows, kitRows] =
    await Promise.all([
      prisma.$queryRawUnsafe<
        Array<{
          products_id: number;
          products_model: string | null;
          products_price: string | null;
          products_rrp_price: string | null;
          manufacturers_id: number | null;
          master_categories_id: number | null;
          products_type: number | null;
        }>
      >(
        `SELECT products_id, products_model, products_price, products_rrp_price,
                manufacturers_id, master_categories_id, products_type
           FROM new_products
          WHERE products_id = ?
          LIMIT 1`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<
        Array<{ products_name: string | null; products_description: string | null }>
      >(
        `SELECT products_name, products_description FROM products_description
          WHERE products_id = ? AND language_id = 1 LIMIT 1`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<Array<{ multisite_products_name: string | null }>>(
        `SELECT multisite_products_name FROM multisite_products_description
          WHERE products_id = ? AND store_id = 99 LIMIT 1`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<
        Array<{ options_id: number; options_values_id: number; options_values_price: string | null }>
      >(
        `SELECT options_id, options_values_id, options_values_price
           FROM products_attributes WHERE products_id = ?`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<Array<{ categories_id: number }>>(
        `SELECT DISTINCT categories_id FROM products_to_categories WHERE products_id = ?`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<Array<{ oid: number; tId: number }>>(
        `SELECT oid, tId FROM product_extra_info WHERE productId = ?`,
        mappedProductId
      ),
      prisma.$queryRawUnsafe<Array<{ groupname_id: number; size_id: number }>>(
        `SELECT groupname_id, size_id FROM team_custom_kit_products WHERE productId = ? LIMIT 1`,
        mappedProductId
      ),
    ]);
  const prod = prodRows[0];

  return {
    products_id: mappedProductId,
    products_model: prod?.products_model ?? null,
    products_name: descRows[0]?.products_name ?? null,
    products_description: descRows[0]?.products_description ?? null,
    products_price: prod?.products_price ?? null,
    products_rrp_price: prod?.products_rrp_price ?? null,
    manufacturers_id: prod?.manufacturers_id ?? null,
    master_categories_id: prod?.master_categories_id ?? null,
    products_type: prod?.products_type ?? null,
    teamzo_name: teamzoRows[0]?.multisite_products_name ?? null,
    selectedAttributes: attrRows,
    categoryIds: catRows.map((r) => r.categories_id),
    extraInfo: extraRows,
    teamCustomKit: kitRows[0] ?? null,
  };
}

async function loadHeroShirtQueue(productsId: number): Promise<number> {
  // Legacy `Product::get_hero_shirt_queue` reads a `hero_shirt_queue` column on
  // `products`. We tolerate the column not existing by returning 0.
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ hero_shirt_queue: number | null }>>(
      `SELECT hero_shirt_queue FROM products WHERE products_id = ? LIMIT 1`,
      productsId
    );
    return Number(rows[0]?.hero_shirt_queue ?? 0);
  } catch (err) {
    logger.warn({ productsId, err: (err as Error).message }, 'get_hero_shirt_queue read failed');
    return 0;
  }
}

// Dropdown payload is essentially static reference data. Cache it in-process
// for 10 minutes so opening the form repeatedly doesn't replay 13 reads each
// time. Shared across requests; concurrent loads await the same in-flight
// promise instead of stampeding the DB.
const DROPDOWN_TTL_MS = 10 * 60 * 1000;
let dropdownCache: { value: FormDropdowns; expiresAt: number } | null = null;
let dropdownInFlight: Promise<FormDropdowns> | null = null;

async function loadFormDropdowns(): Promise<FormDropdowns> {
  const now = Date.now();
  if (dropdownCache && dropdownCache.expiresAt > now) {
    return dropdownCache.value;
  }
  if (dropdownInFlight) return dropdownInFlight;

  dropdownInFlight = loadFormDropdownsFresh()
    .then((value) => {
      dropdownCache = { value, expiresAt: Date.now() + DROPDOWN_TTL_MS };
      return value;
    })
    .finally(() => {
      dropdownInFlight = null;
    });
  return dropdownInFlight;
}

/** Test/admin hook — clears the in-process dropdown cache. */
export function invalidateProductFormDropdownsCache(): void {
  dropdownCache = null;
}

async function loadFormDropdownsFresh(): Promise<FormDropdowns> {
  // All table/column names verified against INFORMATION_SCHEMA on staging
  // (CLAUDE.md rule #6). Notes:
  //   - Real table is `category_league` (singular), not `category_continent`.
  //     The legacy CategoryLeague model class makes that mismatch invisible
  //     in PHP. Columns: id, league_name.
  //   - Real table is `generic_product_type` (singular), not the plural.
  //     Columns: generic_product_type_id, generic_product_type_name,
  //     generic_product_type_parent. Top-level filter is parent = 0.
  //   - product_types real columns are `type_id`, `type_name`.
  //   - products_options_values_to_products_options has NO options_values_price
  //     column — the price lives on the value side (products_options_values.defualt_price)
  //     or per-product on products_attributes. We use defualt_price (yes, typo'd
  //     in the schema) as the default sleeve-patch price.
  //   - products_options_values lacks an `options_values_price` field; we read
  //     `defualt_price` (sic — preserved typo in the legacy DB).
  const [
    leagues,
    manufacturers,
    teamCategories,
    trainingWearCategories,
    teamGroups,
    extraInfoTypes,
    extraInfoOptions,
    sleevePatches,
    genericProductTypes,
    productTypes,
    printingAttributes,
    sizeAttributeRows,
    subCategoryRows,
  ] = await Promise.all([
    safeQuery('leagues', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT id, league_name AS name FROM category_league ORDER BY league_name`
      ), []),
    safeQuery('manufacturers', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT manufacturers_id AS id, manufacturers_name AS name
           FROM manufacturers
          ORDER BY manufacturers_name`
      ), []),
    safeQuery('teamCategories', () =>
      // `team_category` is `ENUM('0','1')` — comparing as integer (= 1) makes
      // MySQL match the ENUM ordinal, which silently returns rows where the
      // value is '0' (9897 rows on staging vs the expected 1032). Always
      // compare the ENUM as a string. Same trap below in `subCategories`.
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT c.categories_id AS id, cd.categories_name AS name
           FROM categories c
           JOIN categories_description cd
             ON cd.categories_id = c.categories_id AND cd.language_id = 1
          WHERE c.team_category = '1'
          ORDER BY cd.categories_name`
      ), []),
    safeQuery('trainingWearCategories', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT c.categories_id AS id, cd.categories_name AS name
           FROM categories c
           JOIN categories_description cd
             ON cd.categories_id = c.categories_id AND cd.language_id = 1
          WHERE c.parent_id = 2270
          ORDER BY cd.categories_name`
      ), []),
    safeQuery('teamGroups', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT id, name FROM team_groups ORDER BY name`
      ), []),
    safeQuery('extraInfoTypes', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT id, name FROM product_extra_info_type
          ORDER BY IF(id = 5, 1, 0) DESC, name`
      ), []),
    safeQuery('extraInfoOptions', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; oid: number; option_name: string }>>(
        `SELECT id, oid, option_name FROM product_extra_info_type_options
          ORDER BY id, option_name`
      ), []),
    safeQuery('sleevePatches', () =>
      // Mirrors legacy `ProductsOptionsValuesToProductsOption::get_all_sleeve_patch()`
      // (`app/models/products_options_values_to_products_option.php` L272-285):
      // every row under products_options_id = 2, including the 'None' value —
      // legacy renders it as a real selectable patch so the freelancer can
      // explicitly mark "no patch". Earlier port mistakenly added a
      // `!= 'None'` filter copied from the separate `optionForSelectedSizes`
      // selection-flag query (legacy L3340-3354) and silently dropped the row.
      prisma.$queryRawUnsafe<
        Array<{
          products_options_values_to_products_options_id: number;
          products_options_values_name: string;
          options_values_price: string | null;
        }>
      >(
        `SELECT povtpo.products_options_values_to_products_options_id,
                pov.products_options_values_name,
                IFNULL(pov.defualt_price, '') AS options_values_price
           FROM products_options_values_to_products_options povtpo
           JOIN products_options_values pov
             ON pov.products_options_values_id = povtpo.products_options_values_id
          WHERE povtpo.products_options_id = 2
          ORDER BY pov.products_options_values_name`
      ), []),
    safeQuery('genericProductTypes', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT generic_product_type_id AS id, generic_product_type_name AS name
           FROM generic_product_type
          WHERE generic_product_type_parent = 0
          ORDER BY generic_product_type_name`
      ), []),
    safeQuery('productTypes', () =>
      prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
        `SELECT type_id AS id, type_name AS name FROM product_types ORDER BY type_name`
      ), []),
    // Printing attribute rows — legacy `Name & Number` is options_id=4 with
    // attribute id 261 in povtpo, but we expose anything tagged as a print/
    // printing option (printing/customization category in products_options).
    // The form checkboxes are: 261 (Name & Number), 5781 (Shorts Numbers),
    // 5762 (Trainers) — see audit C.3. For UI completeness we expose every
    // povtpo row whose option name contains 'print' or 'name' or 'number'.
    safeQuery('printingAttributes', () =>
      prisma.$queryRawUnsafe<
        Array<{
          products_options_values_to_products_options_id: number;
          products_options_values_name: string;
          default_price: string | null;
          options_id: number;
        }>
      >(
        `SELECT povtpo.products_options_values_to_products_options_id,
                pov.products_options_values_name,
                IFNULL(pov.defualt_price, '0') AS default_price,
                povtpo.products_options_id AS options_id
           FROM products_options_values_to_products_options povtpo
           JOIN products_options_values pov
             ON pov.products_options_values_id = povtpo.products_options_values_id
           JOIN products_options po
             ON po.products_options_id = povtpo.products_options_id
          WHERE (po.products_options_name LIKE '%print%'
              OR po.products_options_name LIKE '%name%'
              OR po.products_options_name LIKE '%number%'
              OR povtpo.products_options_values_to_products_options_id IN (261, 5781, 5762))
            AND pov.products_options_values_name != 'None'
          GROUP BY povtpo.products_options_values_to_products_options_id
          ORDER BY pov.products_options_values_name`
      ), []),
    // Size attributes — legacy reads `products_options LIKE '%size%'` then
    // pulls all values per option. Returns flat rows; we group by options_id
    // below.
    safeQuery('sizeAttributes', () =>
      prisma.$queryRawUnsafe<
        Array<{
          options_id: number;
          options_name: string;
          products_options_values_to_products_options_id: number;
          products_options_values_id: number;
          products_options_values_name: string;
          default_price: string | null;
        }>
      >(
        `SELECT po.products_options_id AS options_id,
                po.products_options_name AS options_name,
                povtpo.products_options_values_to_products_options_id,
                povtpo.products_options_values_id,
                pov.products_options_values_name,
                IFNULL(pov.defualt_price, '0') AS default_price
           FROM products_options po
           JOIN products_options_values_to_products_options povtpo
             ON povtpo.products_options_id = po.products_options_id
           JOIN products_options_values pov
             ON pov.products_options_values_id = povtpo.products_options_values_id
          WHERE po.products_options_name LIKE '%size%'
            AND pov.products_options_values_name != 'None'
          ORDER BY po.products_options_id, povtpo.orderId, pov.products_options_values_name`
      ), []),
    // Sub-categories for the master_category drilldown. We fetch every team
    // category's children once; the React form filters by selected master.
    safeQuery('subCategories', () =>
      prisma.$queryRawUnsafe<
        Array<{ parent_id: number; categories_id: number; categories_name: string }>
      >(
        `SELECT c.parent_id, c.categories_id, cd.categories_name
           FROM categories c
           JOIN categories_description cd
             ON cd.categories_id = c.categories_id AND cd.language_id = 1
          WHERE c.parent_id IN (
                  SELECT categories_id FROM categories WHERE team_category = '1'
                )
          ORDER BY c.parent_id, cd.categories_name`
      ), []),
  ]);

  // Group size attribute rows by options_id.
  const sizeAttrsMap = new Map<number, {
    options_id: number;
    options_name: string;
    values: Array<{
      products_options_values_to_products_options_id: number;
      products_options_values_id: number;
      products_options_values_name: string;
      default_price: string;
    }>;
  }>();
  for (const r of sizeAttributeRows) {
    let group = sizeAttrsMap.get(r.options_id);
    if (!group) {
      group = { options_id: r.options_id, options_name: r.options_name, values: [] };
      sizeAttrsMap.set(r.options_id, group);
    }
    group.values.push({
      products_options_values_to_products_options_id: r.products_options_values_to_products_options_id,
      products_options_values_id: r.products_options_values_id,
      products_options_values_name: r.products_options_values_name,
      default_price: r.default_price ?? '0',
    });
  }
  const sizeAttributes = Array.from(sizeAttrsMap.values());

  // Group extra-info options under their type. Replaces legacy N+1 (L3439).
  const optionsByType = new Map<number, Array<{ oid: number; option_name: string }>>();
  for (const opt of extraInfoOptions) {
    const list = optionsByType.get(opt.id) ?? [];
    list.push({ oid: opt.oid, option_name: opt.option_name });
    optionsByType.set(opt.id, list);
  }

  return {
    leagues,
    manufacturers,
    teamCategories,
    trainingWearCategories,
    teamGroups,
    extraInfoTypes: extraInfoTypes.map((t) => ({
      ...t,
      options: optionsByType.get(t.id) ?? [],
    })),
    sleevePatches: sleevePatches.map((r) => ({
      ...r,
      options_values_price: r.options_values_price ?? '',
    })),
    genericProductTypes,
    productTypes,
    printingAttributes: printingAttributes.map((p) => ({
      ...p,
      default_price: p.default_price ?? '0',
    })),
    sizeAttributes,
    subCategoriesByParent: subCategoryRows,
  };
}

// ---------------------------------------------------------------------------
// Submit for review — Flow A only
// ---------------------------------------------------------------------------

export class FormSubmitError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'FormSubmitError';
  }
}

export interface SubmitForReviewResult {
  spr_id: number;
  action: 'inserted' | 'updated';
  productCode: string;
  redirectTo: string;
}

/**
 * Submit the add/edit-product form.
 *
 * Dispatches on `mappedProductId`:
 *  - empty   → Flow A: single-table write to `sms_products_for_review` (below).
 *  - present → Flow B: delegates to `editProduct`, the full 14-table edit of an
 *    already-mapped product. Flow B is LIVE — it does destructive
 *    DELETE-then-conditional-INSERT on kit/attribute mappings (legacy parity;
 *    see the `editProduct` banner). Callers must only pass `mappedProductId`
 *    when the user is genuinely editing a mapped product.
 *
 * Driver auto-INSERT is preserved (legacy footgun documented in audit B.5).
 *
 * Description regex is preserved exactly from legacy L3836 — the spec calls
 * out that the char class includes a literal range; we reproduce it verbatim
 * for parity. If the legacy bug needs fixing later, both apps should change
 * together.
 */
export async function submitForReview(
  body: SubmitForReviewBody,
  smsUserId: number
): Promise<SubmitForReviewResult> {
  // Flow B dispatch: a non-empty mappedProductId means "edit this already-mapped
  // product" → the full 14-table editProduct write. This path is DESTRUCTIVE on
  // kit/attribute mappings (legacy parity — see editProduct banner). It is not a
  // 501 stub; do not route here unless the user is editing a mapped product.
  if (body.mappedProductId && body.mappedProductId !== '') {
    return editProduct(body, Number(body.mappedProductId), smsUserId);
  }

  const productCode = body.adults_products_model.trim();

  // 0. Load product_lists row up-front: legacy reads it both for images
  //    (`product_code_image` / `product_code_additional_img`, controller
  //    L5644-5645) AND for the description seed (`description_notes`,
  //    L5594-5604). Without these the saved review row has empty images and
  //    description, which matched the user's bug report for KQ6513.
  const productListExtras = await prisma.$queryRawUnsafe<
    Array<{
      product_code_image: string | null;
      product_code_additional_img: string | null;
      description_notes: string | null;
    }>
  >(
    `SELECT product_code_image, product_code_additional_img, description_notes
       FROM product_lists WHERE product_code = ? LIMIT 1`,
    productCode
  );
  const productImage = productListExtras[0]?.product_code_image ?? '';
  const productAdditionalImages =
    productListExtras[0]?.product_code_additional_img ?? '';
  const descriptionNotes = productListExtras[0]?.description_notes ?? '';

  // Resolve product_size_option_id + sms_size_groups_id from the same legacy
  // chain the form-load uses: stock_home_grid_lists.size_id is a povtpo PK
  // whose `products_options_id` is e.g. 72 ("Adidas Size") and whose
  // `manufacturers_sizes_to_default_sizes.sms_size_groups_id` is e.g. 21
  // ("Adidas Adult Shirts"). Legacy reads both from hidden form inputs
  // (`products_options_id`, `sms_size_group_id`) that we don't render — so
  // we resolve them server-side here.
  let productSizeOptionId = body.products_options_id ?? 0;
  let smsSizeGroupsId = body.sms_size_group_id ?? 0;
  {
    const sizeRows = await prisma.$queryRawUnsafe<Array<{ size_id: number | null }>>(
      `SELECT size_id FROM stock_home_grid_lists WHERE product_code = ? LIMIT 1`,
      productCode
    );
    const sizeId = sizeRows[0]?.size_id ?? null;
    if (sizeId) {
      const manfRows = await prisma.$queryRawUnsafe<
        Array<{ sms_size_groups_id: number | null }>
      >(
        `SELECT sms_size_groups_id
           FROM manufacturers_sizes_to_default_sizes
          WHERE manufacturers_options_values_id = ?
          LIMIT 1`,
        sizeId
      );
      if (manfRows[0]?.sms_size_groups_id && !smsSizeGroupsId) {
        smsSizeGroupsId = Number(manfRows[0].sms_size_groups_id);
      }
      const optRows = await prisma.$queryRawUnsafe<
        Array<{ products_options_id: number | null }>
      >(
        `SELECT products_options_id
           FROM products_options_values_to_products_options
          WHERE products_options_values_to_products_options_id = ?
          LIMIT 1`,
        sizeId
      );
      if (optRows[0]?.products_options_id && !productSizeOptionId) {
        productSizeOptionId = Number(optRows[0].products_options_id);
      }
    }
  }

  // Map size povtpo IDs → option_value IDs for `product_size_option_value_ids`.
  // Legacy form renders a hidden `sizesid<povtpoId>` per size value mapping
  // povtpo → option_value_id (controller L4949); the submit handler then reads
  // `$_POST["sizesid".$povtpoId]` for each selected size (L5542). We have only
  // the povtpo ids on the body, so query the mapping in one batch.
  const PRINTING_IDS = new Set([261, 5781, 5762]);
  const sizePovtpoIds = (body.attribute ?? []).filter((id) => !PRINTING_IDS.has(id));
  let productSizeOptionValueIds = '';
  if (sizePovtpoIds.length > 0) {
    const placeholders = sizePovtpoIds.map(() => '?').join(',');
    const valueRows = await prisma.$queryRawUnsafe<
      Array<{
        products_options_values_to_products_options_id: number;
        products_options_values_id: number;
      }>
    >(
      `SELECT products_options_values_to_products_options_id,
              products_options_values_id
         FROM products_options_values_to_products_options
        WHERE products_options_values_to_products_options_id IN (${placeholders})`,
      ...sizePovtpoIds
    );
    // Preserve selection order so a future re-read replays the legacy CSV
    // ordering rather than the DB scan order.
    const byPovtpo = new Map(
      valueRows.map((r) => [
        Number(r.products_options_values_to_products_options_id),
        Number(r.products_options_values_id),
      ])
    );
    productSizeOptionValueIds = sizePovtpoIds
      .map((id) => byPovtpo.get(id))
      .filter((v): v is number => v != null && Number.isFinite(v))
      .join(',');
  }

  // Build sleeve_patch CSV in legacy "optionValueId:price" format.
  // Legacy submit (controller L5489-5495) reads two hidden fields per
  // selected patch:
  //   price_sleeve_patch_option_value_id_<povtpoId> → option_value_id
  //   price_sleeve_patch_<povtpoId>                  → user-entered price
  // and joins them as `<option_value_id>:<price>,…`.
  // We have povtpo ids in `body.extra_info_kids_sleeve_patch` and per-povtpo
  // prices in `body.sleevePatchPrices`; we just need to resolve each povtpo
  // to its `products_options_values_id` via the same junction table.
  const sleevePatchPovtpoIds = body.extra_info_kids_sleeve_patch ?? [];
  let sleevePatchValue = '';
  if (sleevePatchPovtpoIds.length > 0) {
    const placeholders = sleevePatchPovtpoIds.map(() => '?').join(',');
    const valueRows = await prisma.$queryRawUnsafe<
      Array<{
        products_options_values_to_products_options_id: number;
        products_options_values_id: number;
      }>
    >(
      `SELECT products_options_values_to_products_options_id,
              products_options_values_id
         FROM products_options_values_to_products_options
        WHERE products_options_values_to_products_options_id IN (${placeholders})`,
      ...sleevePatchPovtpoIds
    );
    const optValueByPovtpo = new Map(
      valueRows.map((r) => [
        Number(r.products_options_values_to_products_options_id),
        Number(r.products_options_values_id),
      ])
    );
    const prices = body.sleevePatchPrices ?? {};
    const pairs = sleevePatchPovtpoIds
      .map((povtpoId) => {
        const optionValueId = optValueByPovtpo.get(povtpoId);
        if (optionValueId == null) return null;
        // Legacy doesn't validate or default the price — whatever the form
        // hidden input held is concatenated. Empty string ('0' default) is
        // a legitimate legacy outcome when the user leaves the field blank,
        // so we mirror that rather than skip the row.
        const price = prices[String(povtpoId)] ?? '0';
        return `${optionValueId}:${price}`;
      })
      .filter((s): s is string => s != null);
    sleevePatchValue = pairs.join(',');
  }

  // 1. Season — store the raw `product_extra_info_type_options.oid` from
  //    `extra_info_kids_5[0]`, NOT the resolved `seasons.seasons_id`.
  //
  //    Legacy parity (add_sms_products_controller.php L5381 + L5638):
  //        $season_id = $this->request->params['form']['extra_info_kids_5'][0];
  //        $sms_products_for_review['SmsProductsForReview']['product_season'] = $season_id;
  //
  //    The legacy review form (`create_product_review_form.ctp` L585-598)
  //    builds the Season <select> from `product_extra_info_type_options` (id=5),
  //    using each row's OID as the <option value>. It then highlights the
  //    selected option by matching `product_season` against the OID. If we
  //    write a `seasons.seasons_id` instead, no <option> matches → the
  //    dropdown shows "None" even though the user did pick a season — which
  //    is the bug reported on JV6566.
  //
  //    Note: `product_lists.seasons_id` (a DIFFERENT table) DOES store
  //    seasons.seasons_id — see legacy L4055-4063. That's a separate
  //    side-effect handled elsewhere; here we only touch
  //    sms_products_for_review.
  const seasonOid: number | null = body.extra_info_kids_5.length > 0
    ? body.extra_info_kids_5[0] ?? null
    : null;

  // 2. Compute description — legacy L5594-5604: wrap product_lists.description_notes
  //    in `<p>...</p>` (only if non-empty), then concatenate the auto-generated
  //    personalisation HTML built from selected printing options and player
  //    names. The legacy non-ASCII strip (L5613) is applied afterwards.
  const manufacturerDesc = descriptionNotes.trim()
    ? `<p>${descriptionNotes}</p>`
    : '';
  const personalisation = buildPersonalisationHtml(body);
  const proDescription = stripDescriptionForLegacyParity(
    manufacturerDesc + personalisation
  );

  // 3. Driver auto-INSERT (legacy L5667-5683) — if a free-text driver name was
  //    submitted, INSERT a new row into product_extra_info_type_options (id=8)
  //    when no exact match exists.
  let driverId: number | null = null;
  const driverRaw = (body.extra_info_kids_8?.[0] ?? '').trim();
  if (driverRaw) {
    driverId = await ensureDriverOption(driverRaw, smsUserId);
  }

  // 4. is_pre_own (archive flow — PMS 130032).
  const { isPreOwn, isPreOwnFields } = buildPreOwn(body);

  // 5. Build the payload (mirrors legacy L5616-5708).
  const payload = {
    // Every column on `sms_products_for_review` is `NOT NULL` with no explicit
    // default. Legacy ran MySQL in non-strict mode so omitted columns silently
    // got 0 / '' on INSERT; Prisma talks to MySQL in strict mode, so every
    // field must be present and non-null. The `?? 0` / `?? ''` here matches
    // the *effective* row state legacy produced (legacy controller L5630-5651).
    product_name: body.products_name,
    products_type: body.products_type_id ?? 0,
    teamzo_product_name: body.teamzo_products_name ?? '',
    product_code: productCode,
    product_price: body.products_price ?? 0,
    teamzo_price: body.products_teamzo_price ?? 0,
    rrp_price: body.products_rrp_price ?? 0,
    master_category_id: body.master_category ?? 0,
    product_categories: (body.category_menu ?? []).join(','),
    product_size_option_id: productSizeOptionId,
    product_size_option_value_ids: productSizeOptionValueIds,
    sms_size_groups_id: smsSizeGroupsId,
    product_manufacturer: body.manufacturers_id ?? 0,
    product_type: body.product_type_id ?? 0,
    product_description: proDescription,
    product_season: seasonOid ?? 0,
    season_sort_order: body.season_sort_order ?? 0,
    product_sizeguide: body.extra_info_kids_1?.[0] ?? 0,
    product_color: (body.extra_info_kids_3 ?? []).join(','),
    is_printing: (body.attribute ?? []).join(','),
    players_name: [body.player1, body.player2, body.player3].filter(Boolean).join(','),
    // sms_products_for_review.product_image is varchar(100); product_lists
    // filenames frequently exceed that (KQ6513 is 122 chars). Legacy CakePHP
    // hands the full string to `->save()` and MySQL in non-strict mode
    // silently truncates. Prisma talks to MySQL in strict mode, so do the
    // truncation explicitly to keep the same row shape and avoid a 1406
    // "Data too long" rejection. product_additional_images is varchar(500)
    // which has plenty of headroom but the same defensive cap doesn't hurt.
    product_image: productImage.slice(0, 100),
    product_additional_images: productAdditionalImages.slice(0, 500),
    // Legacy CSV format: "<option_value_id>:<price>,…" — see the build above.
    sleeve_patch: sleevePatchValue,
    similar_products: 0, // legacy L5647 sends string '0'; column is int — keep numeric
    sleeve_length: body.extra_info_kids_2?.[0] ?? 0,
    glove_type: body.extra_info_kids_6?.[0] ?? 0,
    // `group_id` and `size_group_id` are NOT NULL ints. Legacy controller
    // L5652-5653 explicitly comments out both assignments → relied on the
    // non-strict-mode default of 0. We send 0 here so strict mode accepts.
    group_id: body.grp_id ?? 0,
    size_group_id: body.kids_size_group_dropdown ?? 0,
    // `driver` is `int(11) NOT NULL` with no default. Legacy CakePHP only
    // adds the key to the payload array when a driver name was submitted
    // (controller L5681), so `->save()` omits the column entirely and the
    // legacy DB (running in MySQL's non-strict mode) silently stores 0.
    // Prisma talks to MySQL in strict mode, so we coerce null → 0 here to
    // get the same row state legacy would have produced.
    driver: driverId ?? 0,
    is_pre_own: isPreOwn,
    is_pre_own_fields: isPreOwnFields,
    review_product_status: 1,
    // Schema has `created` (set explicitly on INSERT) and `modified` (auto on
    // UPDATE via `current_timestamp() on update current_timestamp()`). The
    // table has no `submitted_by` / `submitted_date` columns — legacy
    // CakePHP's `->save()` populates `created` automatically; raw SQL must do
    // it manually here.
  };

  // 6. UPSERT keyed on product_code.
  const existing = await prisma.$queryRawUnsafe<Array<{ spr_id: number }>>(
    `SELECT spr_id FROM sms_products_for_review WHERE product_code = ? LIMIT 1`,
    productCode
  );

  if (existing[0]) {
    // UPDATE branch — legacy L5734. `modified` auto-updates via the column
    // default (`on update current_timestamp()`); no need to set it manually.
    await prisma.$executeRawUnsafe(
      `UPDATE sms_products_for_review SET
         product_name = ?, products_type = ?, teamzo_product_name = ?,
         product_price = ?, teamzo_price = ?, rrp_price = ?,
         master_category_id = ?, product_categories = ?,
         product_size_option_id = ?, product_size_option_value_ids = ?,
         sms_size_groups_id = ?, product_manufacturer = ?, product_type = ?,
         product_description = ?, product_season = ?, season_sort_order = ?,
         product_sizeguide = ?, product_color = ?, is_printing = ?,
         players_name = ?, product_image = ?, product_additional_images = ?,
         sleeve_patch = ?, similar_products = ?,
         sleeve_length = ?, glove_type = ?,
         driver = ?, group_id = ?, size_group_id = ?,
         is_pre_own = ?, is_pre_own_fields = ?,
         review_product_status = ?
       WHERE spr_id = ?`,
      payload.product_name, payload.products_type, payload.teamzo_product_name,
      payload.product_price, payload.teamzo_price, payload.rrp_price,
      payload.master_category_id, payload.product_categories,
      payload.product_size_option_id, payload.product_size_option_value_ids,
      payload.sms_size_groups_id, payload.product_manufacturer, payload.product_type,
      payload.product_description, payload.product_season, payload.season_sort_order,
      payload.product_sizeguide, payload.product_color, payload.is_printing,
      payload.players_name, payload.product_image, payload.product_additional_images,
      payload.sleeve_patch, payload.similar_products,
      payload.sleeve_length, payload.glove_type,
      payload.driver, payload.group_id, payload.size_group_id,
      payload.is_pre_own, payload.is_pre_own_fields,
      payload.review_product_status,
      existing[0].spr_id
    );
    logger.info({ spr_id: existing[0].spr_id, productCode, smsUserId }, 'Flow A — UPDATED sms_products_for_review');
    return {
      spr_id: existing[0].spr_id,
      action: 'updated',
      productCode,
      redirectTo: redirectFor(body),
    };
  }

  // INSERT branch — legacy L5749. `created` is set manually (legacy
  // CakePHP `->save()` does it implicitly); `modified` auto-fills via its
  // default. `submitted_by` does not exist on this table — the audit trail
  // for who-submitted-what lives in the `stock_system_log` writes elsewhere.
  await prisma.$executeRawUnsafe(
    `INSERT INTO sms_products_for_review (
       product_name, products_type, teamzo_product_name, product_code,
       product_price, teamzo_price, rrp_price, master_category_id,
       product_categories, product_size_option_id, product_size_option_value_ids,
       sms_size_groups_id, product_manufacturer, product_type, product_description,
       product_season, season_sort_order, product_sizeguide,
       product_color, is_printing, players_name, product_image,
       product_additional_images, sleeve_patch, similar_products,
       sleeve_length, glove_type, driver, group_id, size_group_id,
       is_pre_own, is_pre_own_fields,
       review_product_status, created
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    payload.product_name, payload.products_type, payload.teamzo_product_name, payload.product_code,
    payload.product_price, payload.teamzo_price, payload.rrp_price, payload.master_category_id,
    payload.product_categories, payload.product_size_option_id, payload.product_size_option_value_ids,
    payload.sms_size_groups_id, payload.product_manufacturer, payload.product_type, payload.product_description,
    payload.product_season, payload.season_sort_order, payload.product_sizeguide,
    payload.product_color, payload.is_printing, payload.players_name, payload.product_image,
    payload.product_additional_images, payload.sleeve_patch, payload.similar_products,
    payload.sleeve_length, payload.glove_type, payload.driver, payload.group_id, payload.size_group_id,
    payload.is_pre_own, payload.is_pre_own_fields,
    payload.review_product_status
  );
  const idRow = await prisma.$queryRawUnsafe<Array<{ id: number | bigint }>>(
    `SELECT LAST_INSERT_ID() AS id`
  );
  const spr_id = Number(idRow[0]?.id ?? 0);
  logger.info({ spr_id, productCode, smsUserId }, 'Flow A — INSERTED sms_products_for_review');
  return {
    spr_id,
    action: 'inserted',
    productCode,
    redirectTo: redirectFor(body),
  };
}

/**
 * Build the personalisation HTML block that legacy appends after
 * description_notes (controller L5555-5582). Three printing checkbox ids
 * drive three fixed `<li>` strings:
 *   261  → Name & Number (folds in player name list)
 *   5781 → Shorts Numbers
 *   5762 → Trainers Personalisation
 *
 * Returns '' when no printing checkboxes are selected, matching legacy's
 * "wrap in <ul> only if any" gate at L5557.
 */
function buildPersonalisationHtml(body: SubmitForReviewBody): string {
  const attrs = new Set(body.attribute ?? []);
  const hasNameNumber = attrs.has(261);
  const hasShortsPrinting = attrs.has(5781);
  const hasTrainingPersonalisation = attrs.has(5762);
  if (!hasNameNumber && !hasShortsPrinting && !hasTrainingPersonalisation) {
    return '';
  }
  const players = [body.player1, body.player2, body.player3]
    .filter((p) => p && p.trim() !== '')
    .join(', ');
  const items: string[] = [];
  if (hasNameNumber) {
    let line =
      "<li><b>Name & Number</b> - Customise your jersey with the name and number of your favourite player";
    if (players) line += ` including ${players}`;
    line +=
      ' or even your own name. We can print name in the same style worn by the players.</li>';
    items.push(line);
  }
  if (hasShortsPrinting) {
    items.push(
      '<li><b>Shorts Numbers</b> - Customise your item by adding your initials or squad number.</li>'
    );
  }
  if (hasTrainingPersonalisation) {
    items.push(
      '<li><b>Trainers Personalisation</b> - Customise your item by adding your initials or squad number.</li>'
    );
  }
  return `<div class="Description"><div class="DescriptionHeading">Personalisation</div><ul>${items.join('')}</ul></div>`;
}

function buildPreOwn(
  body: SubmitForReviewBody
): { isPreOwn: number; isPreOwnFields: string } {
  // PMS 130032 — pre-own archive flow. Encode the 4 fields as JSON when
  // `create_football` is set. Legacy controller L5703-5706 explicitly assigns
  // `$is_pre_own_fields = ''` (empty string) for the non-archive case — the
  // column is `varchar(255) NOT NULL`, so under MySQL strict mode we have to
  // ship a string rather than NULL (same trap as `driver` above).
  if (!body.create_football) return { isPreOwn: 0, isPreOwnFields: '' };
  return {
    isPreOwn: 1,
    isPreOwnFields: JSON.stringify({
      football_kits_id: body.football_kits_id ?? 0,
      league: body.league ?? 0,
      team_dropdown: body.team_dropdown ?? 0,
    }),
  };
}

async function ensureDriverOption(name: string, smsUserId: number): Promise<number> {
  // Legacy `is_product_extra_info_type_options_field_exist` returns either the
  // existing `oid` (numeric) or the literal string "false".
  const exact = await prisma.$queryRawUnsafe<Array<{ oid: number }>>(
    `SELECT oid FROM product_extra_info_type_options WHERE id = 8 AND option_name = ? LIMIT 1`,
    name
  );
  if (exact[0]) return exact[0].oid;
  // INSERT new option. Reuse the auto-increment for `oid`.
  await prisma.$executeRawUnsafe(
    `INSERT INTO product_extra_info_type_options (id, option_name) VALUES (8, ?)`,
    name
  );
  const lastIdRow = await prisma.$queryRawUnsafe<Array<{ id: number | bigint }>>(
    `SELECT LAST_INSERT_ID() AS id`
  );
  const newId = Number(lastIdRow[0]?.id ?? 0);
  logger.warn(
    { driverName: name, newId, smsUserId },
    'Auto-created product_extra_info_type_options row for new driver — operator should verify it is not a typo'
  );
  return newId;
}

function redirectFor(body: SubmitForReviewBody): string {
  // Legacy L5797-5813.
  if (body.called_from === 'pre_order_listing') {
    const action = body.request_uri && body.request_uri !== ''
      ? body.request_uri
      : 'pre_order_listing?pre_order_status=1';
    return `/pre_order_listings/${action}`;
  }
  return '/deliveries?sort=2';
}

// ---------------------------------------------------------------------------
// Flow B — direct edit of an already-mapped product (12-table write).
// ---------------------------------------------------------------------------
//
// Source: `add_sms_products_controller.php::edit_product` (L3514-4277). Full
// per-statement audit in the b0wtucpq9 transcript (sections WB1-WB14).
//
// Parity-preserving changes vs legacy:
//   1. All 17 writes wrapped in ONE Prisma $transaction (legacy has none —
//      free reliability win).
//   2. Server-side permission re-check on POST (audit C.17 — legacy has none).
//   3. Bug fixes documented in plan §6.2:
//      a. products_description IS saved on Flow B (legacy L3850 gate is removed).
//      b. products_modified UPDATE is well-formed (legacy L4094 missing SET).
//      c. Real error responses; no more success-flash-on-failure.
//   4. Parameterised SQL everywhere — kills the legacy raw-string injection
//      surface (audit C.20 #13).
//
// Parity-preserving quirks kept verbatim:
//   - team_custom_kit_products DELETE is unconditional, INSERT is gated. A
//     Flow B save without grp_id WIPES the existing kit assignment (matches
//     legacy L4073-4082).
//   - price261 magic: when attribute id 261 is selected, options_values_price
//     is overwritten to config.DELIVERIES_NAME_AND_NUMBER_PRICE when
//     training_wear contains category id 2282, otherwise '10.00'.
//   - multisite_products_description: DELETE for store_id NOT IN
//     (MULTISITE_STORES_ID) then INSERT for store_id=99 (Teamzo).
//   - Direct stock_home_grid_lists.map='Mapped' UPDATE at the end —
//     bypasses addStockGridList rebuild. Legacy parity (the only place in
//     SMS that does a targeted column write to map on the cache).

const PRICE_261_TRAINING_WEAR_TRIGGER = 2282;
const FLOW_B_LANGUAGE_ID = 1;
const TEAMZO_STORE_ID = 99;

interface AttributeRowMeta {
  povtpoId: number;
  options_id: number;
  options_values_id: number;
}

/**
 * Look up the (options_id, options_values_id) pair for every attribute id
 * submitted. The form sends `products_options_values_to_products_options_id`s;
 * we need to resolve them to the foreign keys `products_attributes` requires.
 *
 * NOTE: the price is NOT read here — `products_options_values_to_products_options`
 * has no price column (the legacy default lives on `products_options_values.defualt_price`),
 * and the INSERT below takes its price from the form payload via
 * `pricedAttributeValue()`, so no DB default is needed.
 */
async function resolveAttributeMeta(
  tx: Prisma.TransactionClient,
  povtpoIds: number[]
): Promise<Map<number, AttributeRowMeta>> {
  if (povtpoIds.length === 0) return new Map();
  const placeholders = povtpoIds.map(() => '?').join(',');
  const rows = await tx.$queryRawUnsafe<
    Array<{
      products_options_values_to_products_options_id: number;
      products_options_id: number;
      products_options_values_id: number;
    }>
  >(
    `SELECT products_options_values_to_products_options_id,
            products_options_id,
            products_options_values_id
       FROM products_options_values_to_products_options
      WHERE products_options_values_to_products_options_id IN (${placeholders})`,
    ...povtpoIds
  );
  const map = new Map<number, AttributeRowMeta>();
  for (const r of rows) {
    map.set(r.products_options_values_to_products_options_id, {
      povtpoId: r.products_options_values_to_products_options_id,
      options_id: r.products_options_id,
      options_values_id: r.products_options_values_id,
    });
  }
  return map;
}

/**
 * The legacy controller (L3954-3979) computes the price written into
 * `products_attributes.options_values_price` per attribute. Most attributes
 * use the user-submitted `price<id>` form value (or 0 if absent). Attribute
 * id 261 is the documented exception — see PRICE_261_TRAINING_WEAR_TRIGGER.
 */
function pricedAttributeValue(
  povtpoId: number,
  attributePrices: Record<string, string>,
  trainingWear: number[]
): { price: string; prefix: string } {
  const raw = attributePrices[String(povtpoId)] ?? '';
  let price = raw.trim() !== '' ? raw : '0';

  if (povtpoId === 261) {
    price = trainingWear.includes(PRICE_261_TRAINING_WEAR_TRIGGER)
      ? config.DELIVERIES_NAME_AND_NUMBER_PRICE
      : '10.00';
  }
  return { price, prefix: '' };
}

/**
 * Parse the regex strip applied to products_description in legacy L3836.
 * Kept verbatim so descriptions are bit-identical between old/new saves.
 * (Plan §6.2 records this as a parity preservation choice; the regex is
 *  arguably buggy but both apps share the same DB so they should agree.)
 */
function stripDescriptionForLegacyParity(input: string): string {
  // Legacy: preg_replace('/[^A-Za-z0-9 !> <@#$:;%^€ -© ® £\/@¥•&*().]/u','', $desc)
  // The char class includes ` - ` (space-hyphen-space) which is a range
  // ` `..`©`. We mirror it exactly. Also strip Â and ¢ glyphs per L5614-5615
  // and convert <strong> → <b> per L5616.
  return input
    .replace(/[^A-Za-z0-9 !> <@#$:;%^€ -© ® £\/@¥•&*().]/gu, '')
    .replace(/[Â¢]/g, '')
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>');
}

/**
 * Legacy `url_slug($productName)` helper. Produces a lowercase, hyphenated
 * slug. Used as `products.guid` for SEO URLs. Matches the most common
 * `url_slug` implementation in osCommerce-derived stacks.
 */
function urlSlug(input: string): string {
  return (input ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/&[^;]+;/g, ' ')          // drop HTML entities
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 191);
}

/**
 * Resolve the `gift_voucher` flag for `products` UPDATE. Legacy L3628-3639:
 * if the master_category's categories_name == 'Gift Voucher', the flag is 1.
 */
async function resolveGiftVoucherFlag(
  tx: Prisma.TransactionClient,
  masterCategoryId: number
): Promise<number> {
  if (!masterCategoryId || masterCategoryId <= 0) return 0;
  const rows = await tx.$queryRawUnsafe<Array<{ categories_id: number }>>(
    `SELECT cd.categories_id
       FROM categories_description cd
      WHERE cd.categories_id = ?
        AND cd.language_id = 1
        AND cd.categories_name = 'Gift Voucher'
      LIMIT 1`,
    masterCategoryId
  );
  return rows[0] ? 1 : 0;
}

/**
 * Look up the denormalised `manufacturers_name` for `new_products`. Legacy
 * L3719-3722.
 */
async function lookupManufacturerName(
  tx: Prisma.TransactionClient,
  manufacturersId: number
): Promise<string> {
  if (!manufacturersId || manufacturersId <= 0) return '';
  const rows = await tx.$queryRawUnsafe<Array<{ manufacturers_name: string }>>(
    `SELECT manufacturers_name FROM manufacturers WHERE manufacturers_id = ? LIMIT 1`,
    manufacturersId
  );
  return rows[0]?.manufacturers_name ?? '';
}

/**
 * Build the `new_products.products_to_categories` denormalised CSV. Legacy
 * stores `#<id>#,#<id>#,...`. (Used by the front-end category-page builder.)
 */
function buildCategoriesIdString(categoryIds: number[]): string {
  return categoryIds.map((id) => `#${id}#`).join(',');
}

async function editProduct(
  body: SubmitForReviewBody,
  mappedProductId: number,
  smsUserId: number
): Promise<SubmitForReviewResult> {
  const productCode = body.adults_products_model.trim();
  if (!productCode) {
    throw new FormSubmitError('adults_products_model is required', 'INVALID_PRODUCT_CODE');
  }

  // Pre-resolve attribute metadata once (outside the transaction is fine —
  // these are read-only lookups against immutable rows).
  const allPovtpoIds = Array.from(
    new Set([
      ...body.attribute,
      ...body.extra_info_kids_sleeve_patch.filter((id) => id !== 21),
    ])
  );
  const attrMeta = await resolveAttributeMeta(prisma as unknown as Prisma.TransactionClient, allPovtpoIds);

  // Description string (with legacy parity strip + personalisation HTML if blank).
  const personalisation = [body.player1, body.player2, body.player3]
    .filter((p) => p && p.trim() !== '')
    .map((p) => `<li>${p}</li>`)
    .join('');
  const baseDescription = body.products_description?.trim()
    ? stripDescriptionForLegacyParity(body.products_description.trim())
    : personalisation
      ? `<h4>Personalisation</h4><ul>${personalisation}</ul>`
      : '';

  // Sort order is "<season_sort>" + a suffix from the season label — the
  // legacy code at L3549-3560 builds a numeric sort key for products list
  // ordering. For phase 3 we forward the season_sort_order the form already
  // computed (matches what `useProductFormLoad` returns).
  const sortOrder = body.season_sort_order ?? 0;

  // Resolve season_id from extra_info_kids_5[0] if a Season type option was
  // selected. Matches legacy L4055-4063 (PMS 164738 Apr 2026 patch).
  let seasonsIdForProductLists: number | null = null;
  if (body.extra_info_kids_5.length > 0) {
    const opt = body.extra_info_kids_5[0];
    const optionName = await prisma.$queryRawUnsafe<Array<{ option_name: string }>>(
      `SELECT option_name FROM product_extra_info_type_options WHERE oid = ? LIMIT 1`,
      opt
    );
    if (optionName[0]) {
      const seasonRow = await prisma.$queryRawUnsafe<Array<{ seasons_id: number }>>(
        `SELECT seasons_id FROM seasons WHERE season = ? LIMIT 1`,
        optionName[0].option_name
      );
      if (seasonRow[0]) {
        seasonsIdForProductLists = seasonRow[0].seasons_id;
      }
    }
  }

  // Now the transaction.
  return prisma.$transaction(async (tx) => {
    // ---- WB1: products UPDATE ------------------------------------------
    // Legacy: L3682-3684. Columns from L3599-3626 (excluding INSERT-only image
    // fields). All hardcoded values match legacy exactly:
    //   products_quantity = 20, products_weight = 0.200, products_status = 1,
    //   products_virtual = 0, new_url_structure = 'yes', hero_shirts = 0.
    // Also computes guid (url_slug) and gift_voucher (lookup) like legacy.
    const giftVoucher = await resolveGiftVoucherFlag(tx, body.master_category);
    const guid = urlSlug(body.products_name);
    // teamwear_product flag legacy never sets here — preserved as untouched.
    // Important: hot_product/copa/toffs are only written when explicitly
    // provided by the UI. Legacy reads these from form vars that aren't in
    // its view → silently zeroes them. We do better by gating on undefined.
    const setHotProduct = typeof body.hot_product === 'number';
    const setCopa = typeof body.products_copa === 'number' && body.products_copa > 0;
    const setToffs = typeof body.products_toffs === 'number' && body.products_toffs > 0;

    const productsSet: string[] = [
      'products_model = ?',
      'products_quantity = 20',
      'products_price = ?',
      'products_rrp_price = ?',
      'new_multisite_price = ?',
      'products_last_modified = NOW()',
      'products_weight = 0.200',
      'products_status = 1',
      'products_virtual = 0',
      'manufacturers_id = ?',
      'products_sort_order = ?',
      "new_url_structure = 'yes'",
      'guid = ?',
      'hero_shirts = 0',
      'master_categories_id = ?',
      'gift_voucher = ?',
      'products_type = ?',
    ];
    const productsParams: unknown[] = [
      productCode,
      body.products_price,
      body.products_rrp_price,
      body.products_teamzo_price,
      body.manufacturers_id,
      sortOrder,
      guid,
      body.master_category,
      giftVoucher,
      body.products_type_id,
    ];
    if (setHotProduct) {
      productsSet.push('hot_product = ?');
      productsParams.push(body.hot_product ?? 0);
    }
    if (setCopa) {
      productsSet.push('copa = ?');
      productsParams.push(String(body.products_copa));
    }
    if (setToffs) {
      productsSet.push('toffs = ?');
      productsParams.push(String(body.products_toffs));
    }
    productsParams.push(mappedProductId);
    await tx.$executeRawUnsafe(
      `UPDATE products SET ${productsSet.join(', ')} WHERE products_id = ?`,
      ...productsParams
    );

    // ---- WB1.5: driver auto-INSERT (free-text option) ------------------
    // Legacy L3749-3762. Same footgun as Flow A — we preserve it but log.
    let driverId: number | null = null;
    const driverRaw = (body.extra_info_kids_8?.[0] ?? '').trim();
    if (driverRaw) {
      const existing = await tx.$queryRawUnsafe<Array<{ oid: number }>>(
        `SELECT oid FROM product_extra_info_type_options WHERE id = 8 AND option_name = ? LIMIT 1`,
        driverRaw
      );
      if (existing[0]) {
        driverId = existing[0].oid;
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO product_extra_info_type_options (id, option_name) VALUES (8, ?)`,
          driverRaw
        );
        const lastIdRow = await tx.$queryRawUnsafe<Array<{ id: number | bigint }>>(
          `SELECT LAST_INSERT_ID() AS id`
        );
        driverId = Number(lastIdRow[0]?.id ?? 0);
        logger.warn({ driverName: driverRaw, driverId }, 'Flow B — auto-created driver option');
      }
    }

    // ---- WB2: products_description UPSERT ------------------------------
    // BUG FIX (plan §6.2 / audit C.2): legacy gates the save behind
    // `mappedProductId == ''` so Flow B never updated this row. We always
    // upsert because storefront search reads this table.
    const descExists = await tx.$queryRawUnsafe<Array<{ products_id: number }>>(
      `SELECT products_id FROM products_description
        WHERE products_id = ? AND language_id = ? LIMIT 1`,
      mappedProductId,
      FLOW_B_LANGUAGE_ID
    );
    if (descExists[0]) {
      await tx.$executeRawUnsafe(
        `UPDATE products_description
            SET products_name = ?, products_description = ?, datemod = NOW()
          WHERE products_id = ? AND language_id = ?`,
        body.products_name,
        baseDescription,
        mappedProductId,
        FLOW_B_LANGUAGE_ID
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO products_description
           (products_id, language_id, products_name, products_description, datemod)
         VALUES (?, ?, ?, ?, NOW())`,
        mappedProductId,
        FLOW_B_LANGUAGE_ID,
        body.products_name,
        baseDescription
      );
    }

    // ---- WB3a/b: products_to_categories DELETE+INSERT ------------------
    // Legacy L3858-3871. categories list is master_category + category_menu
    // + training_wear (legacy builds it at L3641-3655 — `justAnotherInputBox_*`
    // are Flow-A-only).
    const categoryIds = Array.from(
      new Set(
        [body.master_category, ...body.category_menu, ...body.training_wear].filter(
          (id) => Number.isFinite(id) && id > 0
        )
      )
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM products_to_categories WHERE products_id = ?`,
      mappedProductId
    );
    for (const catId of categoryIds) {
      await tx.$executeRawUnsafe(
        `INSERT INTO products_to_categories (products_id, categories_id) VALUES (?, ?)`,
        mappedProductId,
        catId
      );
    }

    // ---- WB4a/b: products_attributes DELETE+INSERT (+price261 magic) ---
    // Legacy L3885 + L3952-4000.
    await tx.$executeRawUnsafe(
      `DELETE FROM products_attributes WHERE products_id = ?`,
      mappedProductId
    );

    // Merge attribute[] with sleeve_patch (legacy L3919-3922 — drops the
    // "None" sentinel `[21]`).
    const sleevePatches = body.extra_info_kids_sleeve_patch.filter((id) => id !== 21);
    const attrIds = Array.from(new Set([...body.attribute, ...sleevePatches]));

    for (const povtpoId of attrIds) {
      const meta = attrMeta.get(povtpoId);
      if (!meta) {
        logger.warn(
          { povtpoId, mappedProductId },
          'attribute id not found in products_options_values_to_products_options — skipping'
        );
        continue;
      }
      const { price, prefix } = pricedAttributeValue(
        povtpoId,
        body.attributePrices,
        body.training_wear
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO products_attributes (
           products_id, options_id, options_values_id, options_values_price,
           price_prefix, products_options_sort_order,
           product_attribute_is_free, attributes_display_only, attributes_default,
           attributes_discounted, attributes_price_base_included, date_modified
         ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 1, NOW())`,
        mappedProductId,
        meta.options_id,
        meta.options_values_id,
        price,
        prefix
      );
    }

    // ---- WB5: newExtraInfo_<i> ad-hoc INSERTs --------------------------
    // Legacy L4019-4028. For each `newExtraInfo_<typeId>` non-empty value
    // we INSERT a new option then prepend its oid into the kids array for
    // that type.
    const dynamicKidsAdditions = new Map<number, number[]>();
    for (const [typeIdStr, name] of Object.entries(body.newExtraInfo ?? {})) {
      const typeId = Number(typeIdStr);
      const trimmed = (name ?? '').trim();
      if (!Number.isFinite(typeId) || !trimmed) continue;
      await tx.$executeRawUnsafe(
        `INSERT INTO product_extra_info_type_options (id, option_name) VALUES (?, ?)`,
        typeId,
        trimmed
      );
      const lastIdRow = await tx.$queryRawUnsafe<Array<{ id: number | bigint }>>(
        `SELECT LAST_INSERT_ID() AS id`
      );
      const newOid = Number(lastIdRow[0]?.id ?? 0);
      const arr = dynamicKidsAdditions.get(typeId) ?? [];
      arr.unshift(newOid);
      dynamicKidsAdditions.set(typeId, arr);
    }

    // ---- WB6a/b: product_extra_info DELETE+INSERT ----------------------
    // Legacy L4007-4049 + WB7 sync.
    await tx.$executeRawUnsafe(
      `DELETE FROM product_extra_info WHERE productId = ?`,
      mappedProductId
    );

    const kidsArrays: Record<number, number[]> = {
      1: body.extra_info_kids_1,
      2: body.extra_info_kids_2,
      3: body.extra_info_kids_3,
      4: body.extra_info_kids_4,
      5: body.extra_info_kids_5,
      6: body.extra_info_kids_6,
      7: body.extra_info_kids_7,
      // 8 is the driver — single resolved id from WB1.5.
      8: driverId ? [driverId] : [],
    };
    for (const [tIdStr, oidArr] of Object.entries(kidsArrays)) {
      const tId = Number(tIdStr);
      const dynamics = dynamicKidsAdditions.get(tId) ?? [];
      const merged = [...dynamics, ...oidArr].filter((id) => id > 0);
      for (const oid of merged) {
        await tx.$executeRawUnsafe(
          `INSERT INTO product_extra_info (productId, oid, tId) VALUES (?, ?, ?)`,
          mappedProductId,
          oid,
          tId
        );
        // ---- WB7: product_lists.seasons_id sync (PMS 164738) ---------
        if (tId === 5 && seasonsIdForProductLists) {
          await tx.$executeRawUnsafe(
            `UPDATE product_lists SET seasons_id = ? WHERE product_code = ?`,
            seasonsIdForProductLists,
            productCode
          );
        }
      }
    }

    // ---- WB8a/b: team_custom_kit_products DELETE + (conditional) INSERT
    // Legacy L4073-4082 — DELETE unconditional, INSERT only if grp_id +
    // kids_size_group_dropdown both present (preserved quirk).
    await tx.$executeRawUnsafe(
      `DELETE FROM team_custom_kit_products WHERE productId = ?`,
      mappedProductId
    );
    const grpId = body.grp_id ?? 0;
    const kitSizeId = body.kids_size_group_dropdown ?? 0;
    if (grpId > 0 && kitSizeId > 0 && body.master_category > 0) {
      const kitRow = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM team_custom_kit WHERE category_id = ? LIMIT 1`,
        body.master_category
      );
      const teamId = kitRow[0]?.id ?? null;
      await tx.$executeRawUnsafe(
        `INSERT INTO team_custom_kit_products
           (teamid, groupname_id, productId, sort_order, size_id)
         VALUES (?, ?, ?, 0, ?)`,
        teamId,
        grpId,
        mappedProductId,
        kitSizeId
      );
    }

    // ---- WB9: products_modified UPSERT --------------------------------
    // BUG FIX (plan §6.2 / audit C.9): legacy L4094 has `UPDATE
    // products_modified action = 'update'` — missing SET. Downstream cron
    // jobs rely on this. We write it correctly.
    const pmExists = await tx.$queryRawUnsafe<Array<{ products_id: number }>>(
      `SELECT products_id FROM products_modified WHERE products_id = ? LIMIT 1`,
      mappedProductId
    );
    if (pmExists[0]) {
      await tx.$executeRawUnsafe(
        `UPDATE products_modified SET action = 'update', modified_date = NOW() WHERE products_id = ?`,
        mappedProductId
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO products_modified (products_id, action, modified_date) VALUES (?, 'update', NOW())`,
        mappedProductId
      );
    }

    // ---- WB11a/b: multisite_products_description (Teamzo store_id=99) -
    // Legacy L4117-4136. Note the `Configure::read(MULTISITE_STORES_ID)`
    // double-indirection quirk (audit C.11 #6). Legacy comments name
    // `store_id NOT IN (117, 118)`. We match that intent here directly;
    // when the operator confirms the indirection in production we can
    // wire it to a config var.
    const MULTISITE_PRESERVED_STORE_IDS = [117, 118];
    await tx.$executeRawUnsafe(
      `DELETE FROM multisite_products_description
        WHERE products_id = ?
          AND store_id NOT IN (${MULTISITE_PRESERVED_STORE_IDS.map(() => '?').join(',')})`,
      mappedProductId,
      ...MULTISITE_PRESERVED_STORE_IDS
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO multisite_products_description
         (store_id, products_id, multisite_products_name, multisite_products_price, status)
       VALUES (?, ?, ?, '0.0000', '0')`,
      TEAMZO_STORE_ID,
      mappedProductId,
      body.teamzo_products_name ?? ''
    );

    // ---- WB12: product_lists.map_status = 1 ---------------------------
    // Legacy L4139.
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET map_status = '1' WHERE product_code = ?`,
      productCode
    );

    // ---- WB13: stock_home_grid_lists.map = 'Mapped' -------------------
    // Legacy L4140 — direct column UPDATE, the only cache write on this
    // path. Goes through the shared helper to keep the audit trail.
    await directUpdateGridRow({
      set: { map: 'Mapped' },
      where: { byProductCode: productCode },
      callerTag: 'deliveries/product-form/flow-b',
    }, tx);

    // ---- WB14: new_products UPDATE ------------------------------------
    // Legacy L4185-4205 — mirror of WB1 into the secondary products table.
    // Adds denormalised `products_to_categories` CSV and manufacturers_name,
    // and the same hardcoded ZenCart defaults.
    const manufacturersName = await lookupManufacturerName(tx, body.manufacturers_id);
    const productsToCategoriesCsv = buildCategoriesIdString(categoryIds);

    const npSet: string[] = [
      'products_model = ?',
      'products_quantity = 20',
      'products_price = ?',
      'products_rrp_price = ?',
      'new_multisite_price = ?',
      'products_last_modified = NOW()',
      'products_weight = 0.200',
      'products_status = 1',
      'manufacturers_id = ?',
      'manufacturers_name = ?',
      'products_sort_order = ?',
      "new_url_structure = 'yes'",
      'guid = ?',
      'master_categories_id = ?',
      'gift_voucher = ?',
      'products_to_categories = ?',
      'products_type = ?',
    ];
    const npParams: unknown[] = [
      productCode,
      body.products_price,
      body.products_rrp_price,
      body.products_teamzo_price,
      body.manufacturers_id,
      manufacturersName,
      sortOrder,
      guid,
      body.master_category,
      giftVoucher,
      productsToCategoriesCsv,
      body.products_type_id,
    ];
    if (setHotProduct) {
      npSet.push('hot_product = ?');
      npParams.push(body.hot_product ?? 0);
    }
    if (setCopa) {
      npSet.push('copa = ?');
      npParams.push(String(body.products_copa));
    }
    if (setToffs) {
      npSet.push('toffs = ?');
      npParams.push(String(body.products_toffs));
    }
    npParams.push(mappedProductId);
    await tx.$executeRawUnsafe(
      `UPDATE new_products SET ${npSet.join(', ')} WHERE products_id = ?`,
      ...npParams
    );

    logger.info(
      {
        mappedProductId,
        productCode,
        smsUserId,
        attributeCount: attrIds.length,
        categoryCount: categoryIds.length,
        seasonsIdSynced: seasonsIdForProductLists,
      },
      'Flow B edit_product completed'
    );

    return {
      spr_id: mappedProductId, // legacy redirect doesn't carry a separate id; reuse mappedProductId
      action: 'updated' as const,
      productCode,
      redirectTo: '/deliveries',
    };
  });
}
