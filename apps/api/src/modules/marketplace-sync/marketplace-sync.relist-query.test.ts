/**
 * Unit tests for buildEbayRelistCandidatesQuery — the SQL that finds ended-but-stocked
 * eBay listings to relist. Pure (no DB), mirrors the existing query-builder test style.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEbayRelistCandidatesQuery,
  buildListingsNeedingSyncQuery,
} from './marketplace-sync.query';

describe('buildEbayRelistCandidatesQuery', () => {
  const sql = buildEbayRelistCandidatesQuery();

  it('targets only terminal-deleted listings ended via error 21916750', () => {
    expect(sql).toContain("ml.marketplace_listing_status = 'deleted'");
    expect(sql).toContain("ml.api_last_error_code = '21916750'");
  });

  it('only returns rows that still have stock (normalized_quantity > 0)', () => {
    expect(sql).toContain('candidates.normalized_quantity > 0');
  });

  it('applies the eBay quantity arms (t-shirt = 1, npv_always_in_stock=Yes = 0, no-FC = 0, non-bestseller = 0)', () => {
    expect(sql).toContain('np.virtual_product_type_id = 4 THEN 1');
    expect(sql).toContain("npv.npv_always_in_stock = 'Yes' THEN 0");
    expect(sql).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0 THEN 0');
    expect(sql).toContain('bestsellers.products_id IS NULL THEN 0');
  });

  it('forces qty 0 for variations with no FC product (fc_product_id NULL/0 = cannot ship; refs #166187)', () => {
    expect(sql).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0 THEN 0');
  });

  it('uses new_products_variations as the source of truth for always-in-stock (no products_barcodes)', () => {
    expect(sql).not.toContain('products_barcodes');
    expect(sql).not.toContain('always_in_stock_flag');
  });

  it('joins listings to variations on the SKU columns (same latin1 collation, no CONVERT)', () => {
    expect(sql).toContain('INNER JOIN new_products_variations npv');
    expect(sql).toContain('ON ml.products_sku = npv.npv_products_sku');
    expect(sql).not.toContain('CONVERT(');
  });

  it('has exactly four ? placeholders (3x cap in the CASE, storeId) plus the LIMIT ?', () => {
    const count = (sql.match(/\?/g) || []).length;
    expect(count).toBe(5);
    // LIMIT placeholder present and last.
    expect(sql.trimEnd().endsWith('LIMIT ?')).toBe(true);
  });

  it('does not restrict by retry_count (deleted rows are out of the retry-gated sync set)', () => {
    expect(sql).not.toContain('retry_count <');
  });
});

describe('buildListingsNeedingSyncQuery (eBay / bestsellersOnly)', () => {
  const sql = buildListingsNeedingSyncQuery(true);
  const noFcArm = 'npv.fc_product_id IS NULL OR npv.fc_product_id = 0 THEN 0';

  it('forces qty 0 for variations with no FC product (fc_product_id NULL/0 = cannot ship; refs #166187)', () => {
    expect(sql).toContain(noFcArm);
  });

  it('applies the no-FC arm in BOTH the SELECT and WHERE quantity CASE (re-pick-loop invariant)', () => {
    const occurrences = sql.split(noFcArm).length - 1;
    expect(occurrences).toBe(2);
  });

  it('exempts POD t-shirts: the t-shirt = 1 arm is evaluated before the no-FC = 0 arm', () => {
    const tshirtIdx = sql.indexOf('np.virtual_product_type_id = 4 THEN 1');
    const noFcIdx = sql.indexOf(noFcArm);
    expect(tshirtIdx).toBeGreaterThanOrEqual(0);
    expect(noFcIdx).toBeGreaterThan(tshirtIdx);
  });

  it('does not inject the eBay arms when bestsellersOnly is false (OFF path unchanged)', () => {
    expect(buildListingsNeedingSyncQuery(false)).not.toContain(noFcArm);
  });
});

describe('buildListingsNeedingSyncQuery — virtual_product_type_id plumbing (SD T-shirt markup)', () => {
  it('selects np.virtual_product_type_id on both the SD (non-bestseller) and eBay paths', () => {
    // The SD adapter reads listing.virtual_product_type_id to pick the T-shirt markup.
    // It runs bestsellersOnly=false, so the column must be in the base SELECT list, not
    // just the eBay quantity CASE arms.
    expect(buildListingsNeedingSyncQuery(false)).toContain('np.virtual_product_type_id,');
    expect(buildListingsNeedingSyncQuery(true)).toContain('np.virtual_product_type_id,');
  });
});
