/**
 * Unit tests for the eBay reconciliation dashboard action services (spec §7):
 * reactivate / relist-ghosts / mark-gone / verify-oversell. Every action is
 * verify-first (reactivate/relist/verify-oversell hit eBay read-only before
 * writing) and dry-run-first (dryRun never writes DB or calls eBay writes).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { EBAY_STORE_ID: 94, MARKETPLACE_EBAY_MAX_QUANTITY_CAP: 1, EBAY_RECON_BROWSE_CAP: 200 },
}));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const getItemListingStatus = vi.fn();
const getBrowseAvailability = vi.fn();
const fetchAccessToken = vi.fn().mockResolvedValue('token');
vi.mock('../../lib/marketplaces/ebay/client', () => ({
  createEbayClient: () => ({ fetchAccessToken, getItemListingStatus, getBrowseAvailability }),
}));

const reactivateEbayFalseDeletes = vi.fn().mockResolvedValue(2);
const getEbayGhostRelistCandidates = vi.fn().mockResolvedValue([]);
vi.mock('../marketplace-sync/marketplace-sync.db', () => ({
  reactivateEbayFalseDeletes: (...a: unknown[]) => reactivateEbayFalseDeletes(...a),
  getEbayGhostRelistCandidates: (...a: unknown[]) => getEbayGhostRelistCandidates(...a),
}));

const relistEndedEbayListings = vi.fn();
vi.mock('../ebay/ebay-relist.service', () => ({
  relistEndedEbayListings: (...a: unknown[]) => relistEndedEbayListings(...a),
}));

const markEbayListingsGone = vi.fn().mockResolvedValue(3);
const updateResultBrowse = vi.fn().mockResolvedValue(undefined);
const countGhostRowsForItems = vi.fn().mockResolvedValue(3);
const getResultRowsForVerify = vi.fn().mockResolvedValue([]);
vi.mock('./ebay-reconciliation.db', () => ({
  markEbayListingsGone: (...a: unknown[]) => markEbayListingsGone(...a),
  updateResultBrowse: (...a: unknown[]) => updateResultBrowse(...a),
  countGhostRowsForItems: (...a: unknown[]) => countGhostRowsForItems(...a),
  getResultRowsForVerify: (...a: unknown[]) => getResultRowsForVerify(...a),
}));

import {
  reactivateVerifiedItems,
  relistGhostItems,
  markGoneItems,
  verifyOversellItems,
} from './ebay-reconciliation.service';

beforeEach(() => vi.clearAllMocks());

describe('reactivateVerifiedItems', () => {
  it('verifies each ItemID first; reactivates only listings ACTIVE on eBay', async () => {
    getItemListingStatus.mockImplementation(async (_s: number, id: string) => (id === '1' ? 'active' : 'ended'));
    const outcomes = await reactivateVerifiedItems({ storeId: 94, itemIds: ['1', '2'], dryRun: false });
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledTimes(1);
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledWith(94, ['1']);
    expect(outcomes).toEqual([
      expect.objectContaining({ itemId: '1', action: 'reactivate' }),
      expect.objectContaining({ itemId: '2', action: 'not-active:ended' }),
    ]);
  });

  it('dry-run verifies (read-only GetItem) but never writes', async () => {
    getItemListingStatus.mockResolvedValue('active');
    const outcomes = await reactivateVerifiedItems({ storeId: 94, itemIds: ['1'], dryRun: true });
    expect(getItemListingStatus).toHaveBeenCalled();
    expect(reactivateEbayFalseDeletes).not.toHaveBeenCalled();
    expect(outcomes[0].action).toBe('reactivate');
  });
});

describe('relistGhostItems', () => {
  it('fetches ghost candidates and delegates to relistEndedEbayListings with the override', async () => {
    const candidates = [{ marketplace_listings_id: 1, marketplace_item_identifier: '10', products_sku: 'S', price_adjustment: 0, current_price: 9.99, specials_status: null, specials_price: null, normalized_quantity: 1 }];
    getEbayGhostRelistCandidates.mockResolvedValue(candidates);
    relistEndedEbayListings.mockResolvedValue({ outcomes: [{ itemId: '10', rows: 1, action: 'relist', dryRun: true }] });
    const outcomes = await relistGhostItems({ storeId: 94, itemIds: ['10', '11'], dryRun: true });
    expect(getEbayGhostRelistCandidates).toHaveBeenCalledWith(94, ['10', '11'], 1);
    expect(relistEndedEbayListings).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 94, dryRun: true, itemIds: ['10', '11'], candidates }),
    );
    // '11' had no sellable candidate -> reported, not silently dropped
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: '10', action: 'relist' }),
        expect.objectContaining({ itemId: '11', action: 'skipped', detail: expect.stringContaining('no sellable stock') }),
      ]),
    );
  });
});

describe('markGoneItems', () => {
  it('dry-run counts affected rows without writing', async () => {
    const outcomes = await markGoneItems({ storeId: 94, itemIds: ['5'], dryRun: true, runId: 3 });
    expect(markEbayListingsGone).not.toHaveBeenCalled();
    expect(countGhostRowsForItems).toHaveBeenCalledWith(94, ['5']);
    expect(outcomes[0]).toMatchObject({ action: 'would-mark-gone', rows: 3 });
  });

  it('live marks rows gone (DB-only, never calls eBay)', async () => {
    const outcomes = await markGoneItems({ storeId: 94, itemIds: ['5'], dryRun: false, runId: 3 });
    expect(markEbayListingsGone).toHaveBeenCalledWith(94, ['5'], 3);
    expect(getItemListingStatus).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ action: 'marked-gone', rows: 3 });
  });
});

describe('verifyOversellItems', () => {
  it('Browse-checks each result row and persists the buyer-facing status', async () => {
    getResultRowsForVerify.mockResolvedValue([
      { id: 100, itemId: '1', sku: 'A' },
      { id: 101, itemId: '1', sku: 'B' },
    ]);
    getBrowseAvailability
      .mockResolvedValueOnce({ status: 'IN_STOCK', qty: 1 })
      .mockResolvedValueOnce(null); // unresolvable -> unchecked, never "safe"
    const outcomes = await verifyOversellItems({ storeId: 94, runId: 3, itemIds: ['1'] });
    expect(updateResultBrowse).toHaveBeenCalledWith(100, 'IN_STOCK', 1);
    expect(updateResultBrowse).toHaveBeenCalledWith(101, null, null);
    expect(outcomes).toEqual([
      expect.objectContaining({ itemId: '1', action: 'IN_STOCK' }),
      expect.objectContaining({ itemId: '1', action: 'unresolved' }),
    ]);
  });
});
