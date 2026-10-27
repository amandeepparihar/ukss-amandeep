/**
 * Unit tests for the eBay relist/recover job (relistEndedEbayListings).
 *
 * Core guarantee: every candidate is VERIFIED against eBay (GetItem) before acting —
 * live listings are reactivated (never relisted → no duplicates), only genuinely
 * ended listings are relisted, and candidates are de-duplicated by ItemID.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { MARKETPLACE_EBAY_MAX_QUANTITY_CAP: 1, EBAY_STORE_ID: 94 },
}));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const getItemListingStatus = vi.fn();
const relistFixedPriceItem = vi.fn();
const fetchAccessToken = vi.fn().mockResolvedValue('token');
vi.mock('../../lib/marketplaces/ebay/client', () => ({
  createEbayClient: () => ({ fetchAccessToken, getItemListingStatus, relistFixedPriceItem }),
}));

const getEbayRelistCandidates = vi.fn();
const reactivateEbayFalseDeletes = vi.fn().mockResolvedValue(0);
const markEbayRelistedByItemId = vi.fn().mockResolvedValue(0);
vi.mock('../marketplace-sync/marketplace-sync.db', () => ({
  getEbayRelistCandidates: (...a: any[]) => getEbayRelistCandidates(...a),
  reactivateEbayFalseDeletes: (...a: any[]) => reactivateEbayFalseDeletes(...a),
  markEbayRelistedByItemId: (...a: any[]) => markEbayRelistedByItemId(...a),
}));

import { relistEndedEbayListings } from './ebay-relist.service';

const cand = (over: Partial<any> = {}) => ({
  marketplace_listings_id: 1,
  marketplace_item_identifier: '111',
  products_sku: 'SKU-1',
  price_adjustment: 0,
  current_price: 10,
  specials_status: null,
  specials_price: null,
  normalized_quantity: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchAccessToken.mockResolvedValue('token');
  reactivateEbayFalseDeletes.mockResolvedValue(1);
  markEbayRelistedByItemId.mockResolvedValue(1);
});

describe('verify-before-act guard', () => {
  it('reactivates (never relists) a candidate that is still ACTIVE on eBay', async () => {
    getEbayRelistCandidates.mockResolvedValue([cand()]);
    getItemListingStatus.mockResolvedValue('active');

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: false, limit: 50 });

    expect(res.reactivated).toBe(1);
    expect(res.relisted).toBe(0);
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledWith(94, ['111']);
    expect(relistFixedPriceItem).not.toHaveBeenCalled();
  });

  it('relists a genuinely ENDED candidate and repoints rows to the new ItemID', async () => {
    getEbayRelistCandidates.mockResolvedValue([cand()]);
    getItemListingStatus.mockResolvedValue('ended');
    relistFixedPriceItem.mockResolvedValue({ success: true, newItemId: '999' });

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: false, limit: 50 });

    expect(res.relisted).toBe(1);
    expect(relistFixedPriceItem).toHaveBeenCalledWith(94, '111');
    expect(markEbayRelistedByItemId).toHaveBeenCalledWith(94, '111', '999');
  });

  it('does not relist when eBay status is not-found or unknown', async () => {
    getEbayRelistCandidates.mockResolvedValue([cand({ marketplace_item_identifier: 'A' }), cand({ marketplace_listings_id: 2, marketplace_item_identifier: 'B' })]);
    getItemListingStatus.mockResolvedValueOnce('not-found').mockResolvedValueOnce('unknown');

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: false, limit: 50 });

    expect(res.gone).toBe(1);
    expect(res.unknown).toBe(1);
    expect(relistFixedPriceItem).not.toHaveBeenCalled();
    expect(reactivateEbayFalseDeletes).not.toHaveBeenCalled();
  });
});

describe('dedup by ItemID', () => {
  it('verifies a multi-variation ItemID once and acts on it once', async () => {
    // 3 variation rows, same ItemID
    getEbayRelistCandidates.mockResolvedValue([
      cand({ marketplace_listings_id: 1, products_sku: 'S' }),
      cand({ marketplace_listings_id: 2, products_sku: 'M' }),
      cand({ marketplace_listings_id: 3, products_sku: 'L' }),
    ]);
    getItemListingStatus.mockResolvedValue('ended');
    relistFixedPriceItem.mockResolvedValue({ success: true, newItemId: '999' });

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: false, limit: 50 });

    expect(res.candidateRows).toBe(3);
    expect(res.distinctItems).toBe(1);
    expect(getItemListingStatus).toHaveBeenCalledTimes(1);
    expect(relistFixedPriceItem).toHaveBeenCalledTimes(1);
    expect(res.outcomes[0].rows).toBe(3);
  });
});

describe('dry-run', () => {
  it('verifies (read-only) but makes no writes', async () => {
    getEbayRelistCandidates.mockResolvedValue([cand({ marketplace_item_identifier: 'A' }), cand({ marketplace_listings_id: 2, marketplace_item_identifier: 'B' })]);
    getItemListingStatus.mockResolvedValueOnce('active').mockResolvedValueOnce('ended');

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: true, limit: 50 });

    expect(getItemListingStatus).toHaveBeenCalledTimes(2);
    expect(res.reactivated).toBe(1); // would-reactivate
    expect(res.relisted).toBe(1);    // would-relist
    expect(reactivateEbayFalseDeletes).not.toHaveBeenCalled();
    expect(relistFixedPriceItem).not.toHaveBeenCalled();
    expect(markEbayRelistedByItemId).not.toHaveBeenCalled();
  });
});

describe('candidates override', () => {
  it('uses the candidates override without querying the deleted-ended set', async () => {
    getItemListingStatus.mockResolvedValue('active');
    const candidates = [cand({ marketplace_item_identifier: '77' })]; // reuse the file's existing cand() fixture helper
    const result = await relistEndedEbayListings({ storeId: 94, dryRun: true, limit: 10, candidates });
    expect(getEbayRelistCandidates).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ itemId: '77', action: 'reactivate' });
  });
});

describe('--item-ids allowlist', () => {
  it('only acts on allowlisted ItemIDs, others skipped', async () => {
    getEbayRelistCandidates.mockResolvedValue([cand({ marketplace_item_identifier: 'A' }), cand({ marketplace_listings_id: 2, marketplace_item_identifier: 'B' })]);
    getItemListingStatus.mockResolvedValue('active');

    const res = await relistEndedEbayListings({ storeId: 94, dryRun: false, limit: 50, itemIds: ['A'] });

    expect(res.skipped).toBe(1);
    expect(res.reactivated).toBe(1);
    expect(getItemListingStatus).toHaveBeenCalledTimes(1); // skipped one never verified
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledWith(94, ['A']);
  });
});
