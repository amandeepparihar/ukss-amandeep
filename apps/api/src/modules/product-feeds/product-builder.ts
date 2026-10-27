/**
 * Product Feeds - Product Builder
 *
 * Central processing loop. Takes raw rows from `product_variation_view`
 * and applies every processor (pricing, title, size, color, labels,
 * GPC, GTIN, product-type, image, material) to produce the grouped
 * `ProcessedProduct` array the feed generator consumes.
 *
 * Grouping: variants sharing the same `pfv_product_id` (same
 * `item_group_id`) share one "common" envelope and an array of
 * variant objects. The view is already ordered by `products_id` so
 * the loop just needs to detect `item_group_id` change to flush.
 *
 * First variant of a group gets the "new bestseller" label when
 * `bestsellers_count > 0`; subsequent variants get "do not use" to
 * prevent Google from counting them twice.
 *
 * Also builds a `productTeams` lookup map used by the FIFA World Cup
 * feed filter in Phase 7.
 *
 * PHP source: ukss-feed/build_data.php lines 53-314.
 */

import { ENCODING_FIXES } from './product-feeds.constants.js';
import type {
  ProductVariationRow,
  ProcessedProduct,
  ProductVariant,
  ProductTeamInfo,
  ActiveSale,
  WeekendOffer,
  CheckDealsFn,
} from './product-feeds.types.js';
import {
  calculatePrice,
  fixEncoding,
  standardizeTitle,
  cleanDescription,
  createItemDetails,
  improveTitle,
  checkTitle4Player,
  checkTitle4Team,
  normalizeSize,
  detectColor,
  determineAgeGroup,
  getCustomLabel2,
  getCustomLabel3,
  getCustomLabel4,
  getGoogleProductCategory,
  isValidGTIN,
  buildProductType,
  resolveImageUrl,
  getMaterial,
} from './processors/index.js';

export interface BuildProductsDeps {
  /** Pre-loaded from `data/pricing-data.ts`. */
  activeSales: ActiveSale[];
  weekendOffers: WeekendOffer[];
  dealCategoryIds: number[];
  checkDealsFn: CheckDealsFn;
  /** Pre-loaded from `data/reference-data.ts`. */
  teamTypes: Map<string, string>;
  /**
   * Per-product player-name overrides loaded from
   * `data/snapshots/player-overrides.json`. Mirrors the PHP middle
   * tier between `np_player_name` and the title-regex fallback.
   * Abhinav Gautam
   */
  playerOverrides: Map<number, string>;
  /** From `getProductFeedsConfig()`. */
  cdnUrl: string;
  currentSeason: number;
  skipImageColor: boolean;
  /** Website root for building product links (constant). */
  websiteRoot: string;
  /**
   * Mutable set tracking product IDs already seen so subsequent variants
   * get the "do not use" bestseller label. Injected by the orchestrator
   * so state persists across chunk boundaries (a product whose variants
   * straddle two chunks must still mark the later variants as duplicates).
   * Abhinav Gautam
   */
  processedProducts: Set<number>;
}

export interface BuildProductsResult {
  products: ProcessedProduct[];
  productTeams: Map<string, ProductTeamInfo>;
  /** Number of rows that were processed but produced no variant (always 0 today, reserved for future filters). */
  skipped: number;
}

/** Regex used to extract "(Player Name 10)" suffixes from a raw title. */
const TRAILING_PLAYER_RE = /\(([A-Za-z].*\s\d{1,3})\)$/;

/**
 * Main processing loop. Async because `detectColor` may fetch an
 * image and `calculatePrice` depends on `checkDealsFn`. The loop is
 * sequential within a chunk to keep memory flat -- parallelism comes
 * from the orchestrator processing multiple chunks pipelined.
 */
export async function buildProducts(
  rows: ProductVariationRow[],
  deps: BuildProductsDeps,
): Promise<BuildProductsResult> {
  const products: ProcessedProduct[] = [];
  const productTeams = new Map<string, ProductTeamInfo>();
  const processedProducts = deps.processedProducts;

  let current: ProcessedProduct | null = null;
  let currentGroupId = '';

  const flushCurrent = (): void => {
    if (current) {
      products.push(current);
      current = null;
    }
  };

  for (const row of rows) {
    const productId = Number(row.pfv_product_id);
    const itemGroupId = `p-${productId}`;
    const rawTitle = row.pfv_product_variation_name ?? '';

    // --- 1. Pricing ---------------------------------------------------
    const { productOrgPrice, productSalePrice } = await calculatePrice(
      row,
      deps.activeSales,
      deps.weekendOffers,
      deps.dealCategoryIds,
      deps.checkDealsFn,
    );

    // --- 2. Description cleanup --------------------------------------
    let description = row.description ?? '';
    if (description.includes('Â')) {
      // Strip "Â" when NOT followed by a word-character (artefact from
      // double-UTF-8 encoding of non-breaking spaces).
      description = description.replace(/Â(?!\w)/g, '');
    }

    // --- 3. Title: encoding fix + season standardisation -------------
    let itemTitle = fixEncoding(rawTitle, ENCODING_FIXES);
    itemTitle = standardizeTitle(itemTitle);

    // --- 4. Size normalisation ---------------------------------------
    const size = normalizeSize(row.pfv_product_variation_size);

    // --- 5. Material + age group -------------------------------------
    const material = getMaterial(row.material, itemTitle);
    const agegroup = determineAgeGroup(row.agegroup, rawTitle, size);

    // --- 6. Team name + team-type validation -------------------------
    const rawTeam = (row.team ?? '').toLowerCase();
    productTeams.set(itemGroupId, {
      team: rawTeam,
      continent: row.continent ?? '',
    });

    let teamName = rawTeam;
    const teamType = deps.teamTypes.get(teamName);
    if (
      teamType === undefined ||
      (teamType !== 'club team' && teamType !== 'national team' && teamType !== null)
    ) {
      teamName = '';
    }

    // --- 7. Player name fallback -------------------------------------
    // Mirrors PHP `build_data.php:83-100` exactly: view column first,
    // then the curated `additional_data[product_id]` override (now
    // `playerOverrides`), then the trailing "(Surname 10)" title regex.
    // Abhinav Gautam
    let playerName = row.player_name ?? '';
    if (!playerName) {
      const override = deps.playerOverrides.get(productId);
      if (override) {
        playerName = override;
      } else {
        const match = TRAILING_PLAYER_RE.exec(rawTitle);
        if (match) playerName = match[1];
      }
    }

    // Clear player/team if already present in improved title.
    if (checkTitle4Player(playerName, itemTitle)) playerName = '';
    if (checkTitle4Team(teamName, itemTitle)) teamName = '';

    // --- 8. Image URL + colour ---------------------------------------
    const imageUrl = resolveImageUrl(row.main_image, row.additional_img, deps.cdnUrl);
    const color = await detectColor(
      itemTitle,
      row.color,
      imageUrl.length > 0 ? imageUrl : null,
      deps.skipImageColor,
    );

    // --- 9. Title improvement + description clean --------------------
    const brand = row.manufacturer_name ?? '';
    const details = createItemDetails(
      itemTitle,
      color,
      playerName,
      teamName,
      brand,
      material,
      size,
      agegroup,
      row.gender ?? '',
    );
    const longTitle = improveTitle(details, []);
    const cleanDesc = cleanDescription(description);

    // --- 10. GPC + GTIN + product type -------------------------------
    const gpc = getGoogleProductCategory(longTitle);
    const gtin = isValidGTIN(row.gtin, brand) ? row.gtin ?? undefined : undefined;
    const productType = buildProductType(row);

    // --- 11. Custom labels -------------------------------------------
    const isPrint = Number(row.print) === 1;
    const customLabel2 = getCustomLabel2(
      row.products_type,
      rawTitle,
      isPrint,
      deps.currentSeason,
    );
    const customLabel3 = getCustomLabel3(row, teamName, rawTitle, longTitle);
    const customLabel4 = getCustomLabel4(rawTitle, deps.currentSeason);

    // --- 12. Bestseller label (per-variant) --------------------------
    let bestseller: string | null = null;
    if ((row.bestsellers_count ?? 0) > 0) {
      bestseller = 'new bestseller';
    }
    if (processedProducts.has(productId)) {
      // Already saw a variant for this product -> downgrade to "do not use".
      bestseller = 'do not use';
    } else {
      processedProducts.add(productId);
    }

    // --- 13. Item condition ------------------------------------------
    const itemCondition =
      Number(row.virtual_product_type_id) === 5 ? 'used' : 'new';

    // --- 14. Variant row --------------------------------------------
    const variant: ProductVariant = {
      item_id: row.sku ?? '',
      item_item_group_id: itemGroupId,
      item_varID: Number(row.ovid),
    };
    if (size) variant.item_size = size;
    if (gtin) variant.item_gtin = gtin;
    if (bestseller) variant.item_custom_label_1 = bestseller;

    // --- 15. Group boundary detection --------------------------------
    if (currentGroupId !== itemGroupId) {
      // Flush previous group.
      flushCurrent();

      // Build the common envelope for this new group.
      const link = deps.websiteRoot + (row.href_link ?? '');
      const common: ProcessedProduct = {
        item_item_group_id: itemGroupId,
        item_variants: [],
        item_title: longTitle,
        item_description: cleanDesc,
        item_link: link,
        item_canonical_link: link,
        item_condition: itemCondition,
        item_price: productOrgPrice,
        item_google_product_category: gpc,
        item_product_type: [productType],
        item_shipping: '',
        item_custom_label_2: customLabel2,
        item_custom_label_3: customLabel3,
        item_custom_label_4: customLabel4.toLowerCase(),
      };
      if (imageUrl) common.item_image_link = imageUrl;
      if (productSalePrice != null) common.item_sale_price = productSalePrice;
      if (brand) common.item_brand = brand;
      if (agegroup) common.item_age_group = agegroup;
      if (row.gender) common.item_gender = row.gender;
      if (material) common.item_material = material;
      if (color) common.item_color = color;
      if (row.mpn) common.item_mpn = row.mpn;
      if (agegroup) common.item_custom_label_0 = agegroup;

      current = common;
      currentGroupId = itemGroupId;
    }

    // Append variant to the current (guaranteed-open) group.
    current!.item_variants.push(variant);
  }

  // Flush the last open group.
  flushCurrent();

  return { products, productTeams, skipped: 0 };
}
