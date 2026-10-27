/**
 * Product Feeds - Pricing Engine
 *
 * Calculates the final `{ productOrgPrice, productSalePrice }` for a
 * single product variation by applying a 5-tier priority chain:
 *
 *   1. DEALS        -- highest; skips all other logic if a deal matches
 *   2. FREE         -- product_is_free == 1 -> sale_price = 0
 *   3. SPECIALS     -- specials_status == 'special' and specials_price set
 *   4. SALEMAKER    -- first matching active sale; skipped for MPN 'GIFT*'
 *   5. WEEKEND 10%  -- applied when no other tier matched
 *
 * Then a final RRP adjustment: if products_rrp_price > products_price,
 * swap so org=rrp and sale=base (or the discount from the chain).
 *
 * PHP source: ukss-feed/price_functions.php::priceStuff() (lines 1-219).
 *
 * The `checkDeals` function is injected (rather than imported) so the
 * engine stays pure and database-free for unit testing.
 */

import type {
  ProductVariationRow,
  ActiveSale,
  WeekendOffer,
  PricingResult,
  CheckDealsFn,
} from '../product-feeds.types.js';

/**
 * Pure arithmetic branch of priceStuff() -- no DB calls.
 * Returns the sale_price (or null) from tiers 2-5; the caller applies
 * the RRP swap afterwards.
 */
function computeSalePriceFromTiers(
  row: ProductVariationRow,
  productPrice: number,
  activeSales: ActiveSale[],
  weekendOffers: WeekendOffer[],
): number | null {
  // --- Tier 2: free product ------------------------------------------
  if (Number(row.product_is_free) === 1) {
    return 0;
  }

  // --- Tier 3: specials ---------------------------------------------
  if (
    typeof row.specials_status === 'string' &&
    row.specials_status.toLowerCase() === 'special'
  ) {
    const specials = row.specials_price != null ? Number(row.specials_price) : 0;
    if (specials > 0) {
      return specials;
    }
  }

  // --- Tier 4: salemaker (skipped for MPN starting "GIFT") ---------
  const mpn = row.mpn ?? '';
  const isGiftVoucher = mpn !== null && mpn.substring(0, 4) === 'GIFT';

  if (!isGiftVoucher && activeSales.length > 0) {
    const masterCategoryId = row.master_categories_id;
    const productsSortOrder = row.products_sort_order;

    for (const sale of activeSales) {
      const saleCategories = (sale.sale_categories_all ?? '').split(',').map((s) => s.trim());
      const sortOrderExclude = (sale.sortorder_to_exclude ?? '')
        .split(',')
        .map((s) => s.trim());

      const rangeFromOk =
        productPrice >= sale.sale_pricerange_from ||
        String(sale.sale_pricerange_from) === '0.0000' ||
        sale.sale_pricerange_from === 0;
      // PHP bug-compatible: range_to check is short-circuited by the same
      // `sale_pricerange_from == 0.0000` sentinel (see price_functions.php line 98).
      const rangeToOk =
        productPrice <= sale.sale_pricerange_to ||
        String(sale.sale_pricerange_from) === '0.0000' ||
        sale.sale_pricerange_from === 0;

      const categoryMatch =
        masterCategoryId != null &&
        saleCategories.includes(String(masterCategoryId));

      const sortOrderOk =
        productsSortOrder == null ||
        !sortOrderExclude.includes(String(productsSortOrder));

      if (categoryMatch && rangeFromOk && rangeToOk && sortOrderOk) {
        // Apply deduction by type (matching PHP switch statement).
        let saleMakerPrice: number;
        switch (sale.sale_deduction_type) {
          case 0:
            // Fixed amount off base price.
            saleMakerPrice = productPrice - sale.sale_deduction_value;
            break;
          case 1:
            // Percentage off base price.
            saleMakerPrice =
              productPrice - (productPrice * sale.sale_deduction_value) / 100;
            break;
          case 2:
            // New fixed price (attribute adjustments from the PHP are
            // noop-safe here since the view does not expose the
            // per-attribute min-price lookup).
            saleMakerPrice = sale.sale_deduction_value;
            break;
          default:
            continue;
        }
        // PHP number_format(v, 4, '.', '') -> keep 4 decimal places.
        return Number(saleMakerPrice.toFixed(4));
      }
    }
  }

  // --- Tier 5: weekend 10% -------------------------------------------
  if (weekendOffers.length > 0) {
    const excludeCategoriesRaw = weekendOffers[0]?.exclude_categories ?? '';
    const excludeCategories =
      excludeCategoriesRaw.length > 0
        ? excludeCategoriesRaw.split(',').map((s) => s.trim())
        : [];

    // products_to_categories is stored like "#15#,#48#" (with #'s); strip them.
    const mappedCats = (row.products_to_categories ?? '')
      .split(',')
      .map((s) => s.replace(/#/g, '').trim())
      .filter((s) => s.length > 0);

    let weekendEligible = true;
    if (mappedCats.length > 0 && excludeCategories.length > 0) {
      for (const cat of mappedCats) {
        if (excludeCategories.includes(cat)) {
          weekendEligible = false;
          break;
        }
      }
    }

    if (weekendEligible && !isGiftVoucher) {
      return productPrice - (productPrice * 10) / 100;
    }
  }

  return null;
}

/**
 * Calculate the org / sale price for a product variation.
 *
 * Returns absolute numbers (never strings). `productSalePrice` is null
 * when no discount applies AND no RRP swap pushed the base price up --
 * matching the PHP behaviour that omits `<g:sale_price>` in that case.
 */
export async function calculatePrice(
  row: ProductVariationRow,
  activeSales: ActiveSale[],
  weekendOffers: WeekendOffer[],
  dealCategoryIds: number[],
  checkDealsFn: CheckDealsFn,
): Promise<PricingResult> {
  const productPrice = Number(row.products_price);
  const productRrp = row.products_rrp_price != null ? Number(row.products_rrp_price) : 0;

  let salePrice: number | null = null;

  // --- Tier 1: deals (highest priority) ------------------------------
  if (dealCategoryIds.length > 0) {
    const mappedCats = (row.products_to_categories ?? '')
      .split(',')
      .map((s) => s.replace(/#/g, '').trim())
      .filter((s) => s.length > 0);

    const inDealCategory = dealCategoryIds.some(
      (catId) => catId > 0 && mappedCats.includes(String(catId)),
    );

    if (inDealCategory) {
      const dealPrice = await checkDealsFn(
        row.pfv_product_id,
        row.np_team_id ?? null,
        productPrice,
      );
      if (dealPrice !== null) {
        salePrice = dealPrice;
      }
    }
  }

  // Tiers 2-5 only run if no deal price was found.
  if (salePrice === null) {
    salePrice = computeSalePriceFromTiers(row, productPrice, activeSales, weekendOffers);
  }

  // --- Final RRP adjustment ------------------------------------------
  // If RRP > base price, swap: org=rrp, sale=discount-or-base.
  // Otherwise org=base, sale=discount-or-null.
  let productOrgPrice: number;
  let productSalePrice: number | null;

  if (productRrp > productPrice) {
    productOrgPrice = productRrp;
    productSalePrice = salePrice !== null && salePrice >= 0 ? salePrice : productPrice;
  } else {
    productOrgPrice = productPrice;
    productSalePrice = salePrice !== null && salePrice >= 0 ? salePrice : null;
  }

  return { productOrgPrice, productSalePrice };
}
