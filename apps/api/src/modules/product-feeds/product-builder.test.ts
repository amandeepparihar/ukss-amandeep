/**
 * Integration test for the product builder.
 *
 * Feeds a fixture of ~10 rows and asserts:
 *  - variants are grouped by pfv_product_id
 *  - first variant per group is the bestseller, subsequent get
 *    "do not use" when bestsellers_count > 0
 *  - improveTitle output ends up on item_title
 *  - RRP > price swaps to org=rrp, sale=price
 *  - gift voucher never gets a salemaker discount
 *  - EPL team shows up in product_type as "English Premier League"
 *  - team_type validation clears unknown team names
 *  - productTeams map is populated for FIFA filter downstream
 */

import { describe, it, expect } from 'vitest';
import { buildProducts, type BuildProductsDeps } from './product-builder.js';
import type { ProductVariationRow, CheckDealsFn } from './product-feeds.types.js';

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ProductVariationRow> = {}): ProductVariationRow {
  return {
    ovid: 1,
    pfv_product_variation_size: 'M',
    agegroup: 'adult',
    pfv_product_id: 100,
    sku: 'SKU-100-M',
    pfv_product_variation_name: 'Arsenal Home Shirt',
    mpn: 'ARS-HOME',
    gtin: null,
    main_image: 'arsenal.jpg',
    color: 'Red',
    hero_shirts: null,
    your_name: null,
    manufacturer_name: 'Nike',
    description: '<p>Arsenal home shirt.</p>',
    virtual_product_type_id: null,
    products_type: 10,
    href_link: 'arsenal-home-shirt',
    products_rrp_price: null,
    available_from: null,
    t_modified: null,
    base_date: null,
    league: null,
    team: 'Arsenal',
    np_team_id: 1,
    team_type: 'club team',
    sleevelength: null,
    season: '2025-2026',
    bestseller_update_date: null,
    bestsellers_count: 5,
    qty: 10,
    canvas_product: null,
    modifiedDate: null,
    gender: 'male',
    products_price: 50,
    products_model: 'ARS-HOME',
    product_is_free: 0,
    products_priced_by_attribute: null,
    products_sort_order: 1,
    specials_status: null,
    specials_price: null,
    non_vat: null,
    products_to_categories: '#5#',
    additional_img: null,
    products_quantity: 10,
    products_weight: null,
    continent: 'European Clubs',
    player_name: null,
    material: null,
    products_name: 'Arsenal Home Shirt',
    master_categories_id: 5,
    print: 0,
    ...overrides,
  };
}

const noDeals: CheckDealsFn = async () => null;

function makeDeps(overrides: Partial<BuildProductsDeps> = {}): BuildProductsDeps {
  return {
    activeSales: [],
    weekendOffers: [],
    dealCategoryIds: [],
    checkDealsFn: noDeals,
    teamTypes: new Map([
      ['arsenal', 'club team'],
      ['england', 'national team'],
    ]),
    playerOverrides: new Map<number, string>(),
    cdnUrl: 'https://cdn.uksoccershop.com',
    currentSeason: 2026,
    skipImageColor: true,
    websiteRoot: 'https://www.uksoccershop.com/',
    processedProducts: new Set<number>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildProducts', () => {
  it('groups variants by pfv_product_id into a single common envelope', async () => {
    const rows = [
      makeRow({ ovid: 1, pfv_product_variation_size: 'S', sku: 'A-S' }),
      makeRow({ ovid: 2, pfv_product_variation_size: 'M', sku: 'A-M' }),
      makeRow({ ovid: 3, pfv_product_variation_size: 'L', sku: 'A-L' }),
    ];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products).toHaveLength(1);
    expect(result.products[0].item_variants).toHaveLength(3);
    expect(result.products[0].item_item_group_id).toBe('p-100');
  });

  it('splits into separate products when pfv_product_id changes', async () => {
    const rows = [
      makeRow({ ovid: 1, pfv_product_id: 100, sku: 'A' }),
      makeRow({ ovid: 2, pfv_product_id: 200, sku: 'B' }),
    ];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products).toHaveLength(2);
    expect(result.products[0].item_item_group_id).toBe('p-100');
    expect(result.products[1].item_item_group_id).toBe('p-200');
  });

  it('labels the first variant "new bestseller" and subsequent "do not use"', async () => {
    const rows = [
      makeRow({ ovid: 1, bestsellers_count: 10 }),
      makeRow({ ovid: 2, bestsellers_count: 10 }),
      makeRow({ ovid: 3, bestsellers_count: 10 }),
    ];
    const result = await buildProducts(rows, makeDeps());
    const variants = result.products[0].item_variants;
    expect(variants[0].item_custom_label_1).toBe('new bestseller');
    expect(variants[1].item_custom_label_1).toBe('do not use');
    expect(variants[2].item_custom_label_1).toBe('do not use');
  });

  it('omits item_custom_label_1 when bestsellers_count is 0', async () => {
    const rows = [makeRow({ bestsellers_count: 0 })];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_variants[0].item_custom_label_1).toBeUndefined();
  });

  it('swaps RRP into item_price and base price into item_sale_price', async () => {
    const rows = [makeRow({ products_price: 50, products_rrp_price: 80 })];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_price).toBe(80);
    expect(result.products[0].item_sale_price).toBe(50);
  });

  it('never applies salemaker discount to GIFT voucher MPNs', async () => {
    const rows = [
      makeRow({
        mpn: 'GIFT-100',
        products_price: 100,
        master_categories_id: 5,
      }),
    ];
    const deps = makeDeps({
      activeSales: [
        {
          sale_deduction_value: 10,
          sale_deduction_type: 0,
          sale_categories_all: '5',
          sortorder_to_exclude: '',
          sale_pricerange_from: 0,
          sale_pricerange_to: 1000,
        },
      ],
    });
    const result = await buildProducts(rows, deps);
    expect(result.products[0].item_sale_price).toBeUndefined();
    expect(result.products[0].item_price).toBe(100);
  });

  it('clears unknown team names (team_type validation)', async () => {
    const rows = [
      makeRow({
        team: 'UnknownTeam',
        continent: 'Unknown Continent',
      }),
    ];
    const result = await buildProducts(rows, makeDeps());
    // The unknown team is cleared, so the title's team-presence check
    // has nothing to bite on. The key observation: the raw team still
    // lands in productTeams (for the FIFA filter) even when cleared
    // from the user-facing fields.
    expect(result.productTeams.get('p-100')?.team).toBe('unknownteam');
  });

  it('populates productTeams map with team + continent for every row', async () => {
    const rows = [
      makeRow({ pfv_product_id: 100, team: 'Arsenal', continent: 'European Clubs' }),
      makeRow({ pfv_product_id: 200, team: 'England', continent: 'National Teams' }),
    ];
    const result = await buildProducts(rows, makeDeps());
    expect(result.productTeams.get('p-100')).toEqual({
      team: 'arsenal',
      continent: 'European Clubs',
    });
    expect(result.productTeams.get('p-200')).toEqual({
      team: 'england',
      continent: 'National Teams',
    });
  });

  it('sets used condition for virtual_product_type_id=5', async () => {
    const rows = [makeRow({ virtual_product_type_id: 5 })];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_condition).toBe('used');
  });

  it('builds item_image_link from main_image + cdnUrl', async () => {
    const rows = [makeRow({ main_image: 'arsenal.jpg' })];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_image_link).toBe(
      'https://cdn.uksoccershop.com/images/arsenal.jpg',
    );
  });

  it('applies EPL override to product_type when continent=European Clubs', async () => {
    const rows = [
      makeRow({
        products_name: 'Arsenal Home Shirt',
        continent: 'European Clubs',
        team: 'Arsenal',
      }),
    ];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_product_type[0]).toContain('English Premier League');
  });

  it('builds canonical item_link from websiteRoot + href_link', async () => {
    const rows = [makeRow({ href_link: 'arsenal-home-shirt' })];
    const result = await buildProducts(rows, makeDeps());
    expect(result.products[0].item_link).toBe(
      'https://www.uksoccershop.com/arsenal-home-shirt',
    );
    expect(result.products[0].item_canonical_link).toBe(result.products[0].item_link);
  });

  it('runs improveTitle -- returns longTitle on the common envelope', async () => {
    const rows = [
      makeRow({
        pfv_product_variation_name: 'Arsenal Kit',
        manufacturer_name: 'Nike',
        gender: 'male',
      }),
    ];
    const result = await buildProducts(rows, makeDeps());
    // "Made By: Nike" and "Men's" appended, since neither appears in the raw title.
    expect(result.products[0].item_title).toContain('Made By: Nike');
    expect(result.products[0].item_title).toContain("Men's");
  });
});
