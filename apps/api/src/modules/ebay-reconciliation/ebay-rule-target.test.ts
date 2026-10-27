/**
 * Rule-parity guard (spec §6.2): the reconciliation "target quantity is 0"
 * conditions must mirror the eBay sync quantity arms. If the sync arms change,
 * this test MUST break so both places are updated together.
 */
import { describe, it, expect } from 'vitest';
import {
  buildListingsNeedingSyncQuery,
  buildEbayRelistCandidatesQuery,
} from '../marketplace-sync/marketplace-sync.query';
import { EBAY_RULE_TARGET_ZERO_SELECT } from './ebay-rule-target';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('EBAY_RULE_TARGET_ZERO_SELECT parity with sync arms', () => {
  const syncSql = norm(buildListingsNeedingSyncQuery(true));
  const relistSql = norm(buildEbayRelistCandidatesQuery());
  const ours = norm(EBAY_RULE_TARGET_ZERO_SELECT);

  // Each sync arm the reconciliation fragment must reproduce.
  it('covers the soft-deleted variant arm', () => {
    expect(syncSql).toContain("npv.npv_delete_status = '1'");
    expect(ours).toContain("npv.npv_delete_status = '1'");
  });

  it('covers the always-in-stock arm (npv source of truth, NOT products_barcodes)', () => {
    expect(syncSql).toContain("npv.npv_always_in_stock = 'Yes'");
    expect(ours).toContain("npv.npv_always_in_stock = 'Yes'");
    expect(ours).not.toContain('products_barcodes');
  });

  it('covers the no-FC-product arm', () => {
    expect(syncSql).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0');
    expect(ours).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0');
  });

  it('covers the non-bestseller arm (sync uses the bestsellers join; we test the same predicate)', () => {
    // The sync builders express "non-bestseller" via a join on
    // new_products.np_best_seller_lifetime > 0; our flat expression uses the
    // equivalent NULL/<=0 predicate directly.
    expect(syncSql).toContain('np_best_seller_lifetime > 0');
    expect(relistSql).toContain('np_best_seller_lifetime > 0');
    expect(ours).toContain('np.np_best_seller_lifetime IS NULL OR np.np_best_seller_lifetime <= 0');
  });

  it('exempts T-shirts (virtual_product_type_id = 4) exactly like the sync', () => {
    expect(syncSql).toContain('np.virtual_product_type_id = 4');
    expect(ours).toContain('np.virtual_product_type_id');
    expect(ours).toContain('<> 4');
  });

  it('covers the sold-out arm', () => {
    expect(ours).toContain('npv.npv_quantities <= 0');
  });

  it('treats a missing npv row as target-zero (cannot verify stock => do not sell)', () => {
    expect(ours).toContain('npv.npv_products_sku IS NULL');
  });
});
