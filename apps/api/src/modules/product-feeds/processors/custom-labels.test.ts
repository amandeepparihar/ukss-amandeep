/**
 * Unit tests for the product-feeds custom-label processors.
 */

import { describe, it, expect } from 'vitest';
import {
  determineAgeGroup,
  getCustomLabel2,
  getCustomLabel3,
  getCustomLabel4,
  findFirstMatch,
} from './custom-labels.js';
import type { ProductVariationRow } from '../product-feeds.types.js';

describe('determineAgeGroup', () => {
  it('uses a unique title keyword match', () => {
    expect(determineAgeGroup('adult', 'Kids Training Top', '')).toBe('kids');
    expect(determineAgeGroup('adult', 'Toddler Jersey', '')).toBe('toddler');
  });

  it('falls through to size when title has no unique match', () => {
    // PHP parity: the Mo-based regex is dead code in PHP (the string is
    // lowercased, the pattern has literal "Mo") so these sizes fall
    // through to the DB age. Preserved here bug-for-bug. Abhinav Gautam
    expect(determineAgeGroup('adult', '', '6-9 Mo')).toBe('adult');
    expect(determineAgeGroup('adult', '', '0-3 Mo')).toBe('adult');
    expect(determineAgeGroup('adult', '', '3-4')).toBe('toddler');
    expect(determineAgeGroup('adult', '', '8-10')).toBe('kids');
  });

  it('returns the DB age when no title/size rule matches', () => {
    expect(determineAgeGroup('adult', 'Shirt', 'L')).toBe('adult');
  });

  it('defaults to "adult" when nothing matches and DB age is empty', () => {
    expect(determineAgeGroup('', 'Shirt', 'L')).toBe('adult');
    expect(determineAgeGroup(null, 'Shirt', 'L')).toBe('adult');
  });
});

describe('getCustomLabel2', () => {
  it('returns "print" when isPrint is true', () => {
    expect(getCustomLabel2(10, 'anything', true, 2026)).toBe('print');
  });

  it('returns the title category match when available', () => {
    expect(getCustomLabel2(10, 'Retro England Shirt', false, 2026)).toBe('retro');
    expect(getCustomLabel2(10, 'Hoodie Top', false, 2026)).toBe('hoodies');
  });

  it('falls back to UKSS product type map', () => {
    expect(getCustomLabel2(22, 'No keywords here', false, 2026)).toBe('hoodies');
    expect(getCustomLabel2(13, 'Plain Top', false, 2026)).toBe('goalkeeper');
  });

  it('returns "current season" when title contains the current season year', () => {
    expect(getCustomLabel2(null, 'England 2026 Kit', false, 2026)).toBe('current season');
  });

  it('returns "empty" when nothing matches', () => {
    expect(getCustomLabel2(null, 'Random thing', false, 2026)).toBe('empty');
  });
});

describe('getCustomLabel3', () => {
  const baseRow: ProductVariationRow = {
    ovid: 1,
    pfv_product_variation_size: null,
    agegroup: null,
    pfv_product_id: 1,
    sku: null,
    pfv_product_variation_name: null,
    mpn: null,
    gtin: null,
    main_image: null,
    color: null,
    hero_shirts: null,
    your_name: null,
    manufacturer_name: null,
    description: null,
    virtual_product_type_id: null,
    products_type: null,
    href_link: null,
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
    qty: null,
    canvas_product: null,
    modifiedDate: null,
    gender: null,
    products_price: 0,
    products_model: null,
    product_is_free: null,
    products_priced_by_attribute: null,
    products_sort_order: null,
    specials_status: null,
    specials_price: null,
    non_vat: null,
    products_to_categories: null,
    additional_img: null,
    products_quantity: null,
    products_weight: null,
    continent: null,
    player_name: null,
    material: null,
    products_name: null,
    master_categories_id: null,
    print: 0,
  };

  it('picks "t-shirts" for virtual_product_type_id=4', () => {
    const result = getCustomLabel3(
      { ...baseRow, virtual_product_type_id: 4 },
      'Arsenal',
      'Arsenal T-Shirt',
      'Arsenal T-Shirt',
    );
    expect(result.all).toBe('t-shirts');
  });

  it('picks "your-name" when title contains "Your Name"', () => {
    const result = getCustomLabel3(
      baseRow,
      'Arsenal',
      'Arsenal Shirt with Your Name',
      'Arsenal Shirt with Your Name',
    );
    expect(result.all).toBe('your-name');
  });

  it('picks "hero-shirts" when hero_shirts=1', () => {
    const result = getCustomLabel3(
      { ...baseRow, hero_shirts: 1 },
      'Arsenal',
      'Arsenal Shirt',
      'Arsenal Shirt',
    );
    expect(result.all).toBe('hero-shirts');
  });

  it('picks "airo-concept-kit" for Airo Sportswear brand', () => {
    const result = getCustomLabel3(
      { ...baseRow, manufacturer_name: 'Airo Sportswear' },
      'Arsenal',
      'Arsenal Shirt',
      'Arsenal Shirt',
    );
    expect(result.all).toBe('airo-concept-kit');
  });

  it('falls back to bestseller match for keys that survive PHP case-sensitivity', () => {
    // PHP matches strpos($lowercaseTitle, $key) -- keys with any
    // uppercase letter can never match. 'messi' is one of the handful
    // of all-lowercase keys that do match.
    const result = getCustomLabel3(
      baseRow,
      'Real Madrid',
      'Madrid Messi Shirt',
      'Madrid Messi Shirt',
    );
    expect(result.all).toBe('Lionel Messi');
  });

  it('returns empty "all" when no primary rule and no lowercase bestseller key hits', () => {
    const result = getCustomLabel3(
      baseRow,
      'Real Madrid',
      'Madrid Ronaldo Shirt',
      'Madrid Ronaldo Shirt',
    );
    // PHP parity: the "Ronaldo" key is mixed-case, so strpos on the
    // lowercased title never matches. findFirstMatch returns null and
    // custom_label_3['all'] ends up empty (not emitted in the feed).
    expect(result.all).toBe('');
  });

  it('sets facebook and shoptimized to lowercased team name', () => {
    const result = getCustomLabel3(baseRow, 'Real Madrid', 'foo', 'foo');
    expect(result.facebook).toBe('real madrid');
    expect(result.shoptimized).toBe('real madrid');
  });
});

describe('getCustomLabel4', () => {
  it('detects next-season (current=2026)', () => {
    expect(getCustomLabel4('England 2026-2027 Home', 2026)).toBe('2026-2027');
    expect(getCustomLabel4('England 2026-27 Home', 2026)).toBe('2026-2027');
  });

  it('detects current season', () => {
    expect(getCustomLabel4('England 2025-26 Kit', 2026)).toBe('2025-2026');
  });

  it('detects last season', () => {
    expect(getCustomLabel4('Kit 2024-2025', 2026)).toBe('2024-2025');
  });

  it('detects last-to-last season', () => {
    expect(getCustomLabel4('Kit 2023-24', 2026)).toBe('2023-2024');
  });

  it('detects historical seasons back to 1960', () => {
    expect(getCustomLabel4('Retro 1998-99 Kit', 2026)).toBe('1998-1999');
  });

  it('returns empty when no season pattern matches', () => {
    expect(getCustomLabel4('Generic Shirt', 2026)).toBe('');
  });
});

describe('findFirstMatch', () => {
  it('matches an all-lowercase bestseller key in the lowercased title', () => {
    // PHP: strpos($lowercaseTitle, 'messi') -- matches because the key
    // is all-lowercase.
    expect(findFirstMatch('Lionel Messi Jersey')).toBe('Lionel Messi');
  });

  it('does NOT match mixed-case keys (PHP strpos is case-sensitive)', () => {
    // "Maradona" key has uppercase M, so PHP's strpos on the lowercased
    // "diego maradona jersey" never matches. JS preserves the bug.
    expect(findFirstMatch('Diego Maradona Jersey')).toBeNull();
  });

  it('returns null when no key matches', () => {
    expect(findFirstMatch('Generic Blank Title')).toBeNull();
  });
});
