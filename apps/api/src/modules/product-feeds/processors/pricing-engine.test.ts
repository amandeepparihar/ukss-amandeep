/**
 * Unit tests for the product-feeds pricing engine.
 *
 * Each test exercises one priority tier in isolation. The engine takes
 * `checkDealsFn` as an injected dependency, so the DB is never touched.
 */

import { describe, it, expect, vi } from 'vitest';
import { calculatePrice } from './pricing-engine.js';
import type {
  ProductVariationRow,
  ActiveSale,
  WeekendOffer,
  CheckDealsFn,
} from '../product-feeds.types.js';

function makeRow(overrides: Partial<ProductVariationRow> = {}): ProductVariationRow {
  return {
    ovid: 1,
    pfv_product_variation_size: 'M',
    agegroup: 'adult',
    pfv_product_id: 100,
    sku: 'SKU-001',
    pfv_product_variation_name: 'Test Shirt',
    mpn: 'TST-001',
    gtin: null,
    main_image: null,
    color: null,
    hero_shirts: null,
    your_name: null,
    manufacturer_name: 'Nike',
    description: null,
    virtual_product_type_id: null,
    products_type: 10,
    href_link: 'test-shirt',
    products_rrp_price: null,
    available_from: null,
    t_modified: null,
    base_date: null,
    league: null,
    team: null,
    np_team_id: null,
    team_type: null,
    sleevelength: null,
    season: null,
    bestseller_update_date: null,
    bestsellers_count: null,
    qty: 10,
    canvas_product: null,
    modifiedDate: null,
    gender: 'male',
    products_price: 50,
    products_model: null,
    product_is_free: 0,
    products_priced_by_attribute: null,
    products_sort_order: 1,
    specials_status: null,
    specials_price: null,
    non_vat: null,
    products_to_categories: '#5#,#10#',
    additional_img: null,
    products_quantity: 10,
    products_weight: null,
    continent: null,
    player_name: null,
    material: null,
    products_name: 'Test Shirt',
    master_categories_id: 5,
    print: 0,
    ...overrides,
  };
}

const noDeals: CheckDealsFn = async () => null;

describe('calculatePrice', () => {
  // -------------------------------------------------------------------
  // Tier 1: DEALS
  // -------------------------------------------------------------------
  it('Tier 1: returns deal price when product is in a deal category', async () => {
    const checkDeals = vi.fn<CheckDealsFn>().mockResolvedValue(30);
    const row = makeRow({
      products_to_categories: '#42#,#5#',
      products_price: 50,
    });
    const result = await calculatePrice(row, [], [], [42], checkDeals);
    expect(checkDeals).toHaveBeenCalledWith(100, null, 50);
    expect(result.productOrgPrice).toBe(50);
    expect(result.productSalePrice).toBe(30);
  });

  it('Tier 1: skips deal lookup when product is not in a deal category', async () => {
    const checkDeals = vi.fn<CheckDealsFn>().mockResolvedValue(30);
    const row = makeRow({ products_to_categories: '#5#' });
    await calculatePrice(row, [], [], [42], checkDeals);
    expect(checkDeals).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Tier 2: FREE
  // -------------------------------------------------------------------
  it('Tier 2: sale_price is 0 when product_is_free = 1', async () => {
    const row = makeRow({ product_is_free: 1, products_price: 25 });
    const result = await calculatePrice(row, [], [], [], noDeals);
    expect(result.productOrgPrice).toBe(25);
    expect(result.productSalePrice).toBe(0);
  });

  // -------------------------------------------------------------------
  // Tier 3: SPECIALS
  // -------------------------------------------------------------------
  it('Tier 3: uses specials_price when specials_status=special', async () => {
    const row = makeRow({
      specials_status: 'special',
      specials_price: 19.99,
    });
    const result = await calculatePrice(row, [], [], [], noDeals);
    expect(result.productSalePrice).toBe(19.99);
  });

  // -------------------------------------------------------------------
  // Tier 4: SALEMAKER (types 0, 1, 2)
  // -------------------------------------------------------------------
  const saleBase = (overrides: Partial<ActiveSale> = {}): ActiveSale => ({
    sale_deduction_value: 10,
    sale_deduction_type: 0,
    sale_categories_all: '5',
    sortorder_to_exclude: '',
    sale_pricerange_from: 0,
    sale_pricerange_to: 1000,
    ...overrides,
  });

  it('Tier 4: salemaker type 0 subtracts a fixed amount', async () => {
    const row = makeRow({ products_price: 50, master_categories_id: 5 });
    const sale = saleBase({ sale_deduction_type: 0, sale_deduction_value: 5 });
    const result = await calculatePrice(row, [sale], [], [], noDeals);
    expect(result.productSalePrice).toBe(45);
  });

  it('Tier 4: salemaker type 1 subtracts a percentage', async () => {
    const row = makeRow({ products_price: 100, master_categories_id: 5 });
    const sale = saleBase({ sale_deduction_type: 1, sale_deduction_value: 20 });
    const result = await calculatePrice(row, [sale], [], [], noDeals);
    expect(result.productSalePrice).toBe(80);
  });

  it('Tier 4: salemaker type 2 sets a new fixed price', async () => {
    const row = makeRow({ products_price: 50, master_categories_id: 5 });
    const sale = saleBase({ sale_deduction_type: 2, sale_deduction_value: 9.99 });
    const result = await calculatePrice(row, [sale], [], [], noDeals);
    expect(result.productSalePrice).toBe(9.99);
  });

  it('Tier 4: salemaker is skipped for GIFT voucher MPN', async () => {
    const row = makeRow({
      mpn: 'GIFT-50',
      products_price: 50,
      master_categories_id: 5,
    });
    const sale = saleBase({ sale_deduction_type: 0, sale_deduction_value: 10 });
    const result = await calculatePrice(row, [sale], [], [], noDeals);
    expect(result.productSalePrice).toBeNull();
  });

  it('Tier 4: salemaker is skipped when sort order is excluded', async () => {
    const row = makeRow({
      products_price: 50,
      master_categories_id: 5,
      products_sort_order: 3,
    });
    const sale = saleBase({ sortorder_to_exclude: '3,7' });
    const result = await calculatePrice(row, [sale], [], [], noDeals);
    expect(result.productSalePrice).toBeNull();
  });

  // -------------------------------------------------------------------
  // Tier 5: WEEKEND 10%
  // -------------------------------------------------------------------
  it('Tier 5: weekend 10% applies when product category is not excluded', async () => {
    const row = makeRow({ products_price: 100 });
    const offer: WeekendOffer = { id: 1, exclude_categories: '99,88' };
    const result = await calculatePrice(row, [], [offer], [], noDeals);
    expect(result.productSalePrice).toBe(90);
  });

  it('Tier 5: weekend 10% is skipped when product is in an excluded category', async () => {
    const row = makeRow({
      products_price: 100,
      products_to_categories: '#5#,#99#',
    });
    const offer: WeekendOffer = { id: 1, exclude_categories: '99,88' };
    const result = await calculatePrice(row, [], [offer], [], noDeals);
    expect(result.productSalePrice).toBeNull();
  });

  // -------------------------------------------------------------------
  // Final RRP swap
  // -------------------------------------------------------------------
  it('RRP swap: org=rrp, sale=base when rrp > base and no discount chain', async () => {
    const row = makeRow({
      products_price: 50,
      products_rrp_price: 80,
    });
    const result = await calculatePrice(row, [], [], [], noDeals);
    expect(result.productOrgPrice).toBe(80);
    expect(result.productSalePrice).toBe(50);
  });

  it('RRP swap: sale remains the discount when chain produced a discount', async () => {
    const row = makeRow({
      specials_status: 'special',
      specials_price: 30,
      products_price: 50,
      products_rrp_price: 80,
    });
    const result = await calculatePrice(row, [], [], [], noDeals);
    expect(result.productOrgPrice).toBe(80);
    expect(result.productSalePrice).toBe(30);
  });

  it('no-discount path: org=base, sale=null when nothing matches and no RRP', async () => {
    const row = makeRow({ products_price: 50 });
    const result = await calculatePrice(row, [], [], [], noDeals);
    expect(result.productOrgPrice).toBe(50);
    expect(result.productSalePrice).toBeNull();
  });

  // -------------------------------------------------------------------
  // Priority: deals short-circuit everything else
  // -------------------------------------------------------------------
  it('Priority: deals tier short-circuits salemaker/specials/weekend', async () => {
    const checkDeals = vi.fn<CheckDealsFn>().mockResolvedValue(15);
    const row = makeRow({
      products_to_categories: '#42#',
      products_price: 50,
      master_categories_id: 5,
      specials_status: 'special',
      specials_price: 30,
    });
    const sale = saleBase({ sale_deduction_type: 0, sale_deduction_value: 10 });
    const offer: WeekendOffer = { id: 1, exclude_categories: '' };
    const result = await calculatePrice(row, [sale], [offer], [42], checkDeals);
    expect(result.productSalePrice).toBe(15);
  });
});
