import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { EBAY_STORE_ID: 94, EBAY_RECON_BROWSE_CAP: 2 },
}));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const fetchAccessToken = vi.fn().mockResolvedValue('token');
const getBrowseAvailability = vi.fn().mockResolvedValue({ status: 'IN_STOCK', qty: 1 });
let activePages: { pageNumber: number; totalPages: number; totalEntries: number; items: unknown[] }[] = [];
async function* iterateActiveListings() {
  for (const p of activePages) {
    if ((p as any).throwError) throw new Error('eBay 500 on page ' + p.pageNumber);
    yield p;
  }
}
vi.mock('../../lib/marketplaces/ebay/client', () => ({
  createEbayClient: () => ({ fetchAccessToken, iterateActiveListings, getBrowseAvailability }),
}));

const acquireSnapshotRun = vi.fn().mockResolvedValue(7);
const insertSnapshotRows = vi.fn().mockResolvedValue(0);
const getDbListingRows = vi.fn().mockResolvedValue([]);
const insertResults = vi.fn().mockResolvedValue(0);
const completeRun = vi.fn().mockResolvedValue(undefined);
const failRun = vi.fn().mockResolvedValue(undefined);
const purgeOldRuns = vi.fn().mockResolvedValue(0);
// Full mock (no importOriginal — the real module pulls in the Prisma client).
// The service's `type ResultWithBrowse` import is type-only and erased at runtime.
vi.mock('./ebay-reconciliation.db', () => ({
  acquireSnapshotRun: (...a: unknown[]) => acquireSnapshotRun(...a),
  insertSnapshotRows: (...a: unknown[]) => insertSnapshotRows(...a),
  getDbListingRows: (...a: unknown[]) => getDbListingRows(...a),
  insertResults: (...a: unknown[]) => insertResults(...a),
  completeRun: (...a: unknown[]) => completeRun(...a),
  failRun: (...a: unknown[]) => failRun(...a),
  purgeOldRuns: (...a: unknown[]) => purgeOldRuns(...a),
}));

import { runEbaySnapshot } from './ebay-snapshot.service';

const ebayItem = (itemId: string, sku: string, qty = 1) => ({
  ItemID: itemId, Title: `Item ${itemId}`, SKU: sku, Quantity: qty, SellingStatus: { QuantitySold: 0 },
});
const dbRow = (o: Record<string, unknown> = {}) => ({
  itemId: '1', sku: 'S1', listingStatus: 'confirmed', lastSyncedQty: 1,
  lastSyncedPrice: null, errorCode: null, ruleTargetZero: false, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  activePages = [{ pageNumber: 1, totalPages: 1, totalEntries: 1, items: [ebayItem('1', 'S1')] }];
  getDbListingRows.mockResolvedValue([dbRow()]);
});

describe('runEbaySnapshot', () => {
  it('persists snapshot rows + results, completes the run, purges old runs', async () => {
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron' });
    expect(acquireSnapshotRun).toHaveBeenCalledWith(94, 'cron', undefined);
    expect(insertSnapshotRows).toHaveBeenCalledWith(7, expect.arrayContaining([expect.objectContaining({ itemId: '1', sku: 'S1' })]));
    expect(insertResults).toHaveBeenCalledWith(7, 94, expect.arrayContaining([expect.objectContaining({ category: 'managed_ok' })]));
    expect(completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ listingsFetched: 1, variationsFetched: 1 }));
    expect(purgeOldRuns).toHaveBeenCalledWith(94, 14);
    expect(res.runId).toBe(7);
    expect(res.categoryCounts.managed_ok).toBe(1);
  });

  it('dry-run: classifies and reports but never acquires a lock or writes', async () => {
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron', dryRun: true });
    expect(acquireSnapshotRun).not.toHaveBeenCalled();
    expect(insertSnapshotRows).not.toHaveBeenCalled();
    expect(insertResults).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(res.runId).toBeNull();
    expect(res.categoryCounts.managed_ok).toBe(1);
  });

  it('marks the run failed and deletes partial rows when a page fetch throws', async () => {
    activePages = [
      { pageNumber: 1, totalPages: 2, totalEntries: 400, items: [ebayItem('1', 'S1')] },
      Object.assign({ pageNumber: 2, totalPages: 2, totalEntries: 400, items: [] }, { throwError: true }),
    ];
    await expect(runEbaySnapshot({ storeId: 94, trigger: 'cron' })).rejects.toThrow('eBay 500');
    expect(failRun).toHaveBeenCalledWith(7, expect.stringContaining('eBay 500'));
    expect(insertResults).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('Browse-checks oversell suspects up to the cap and counts the unchecked remainder', async () => {
    activePages = [{
      pageNumber: 1, totalPages: 1, totalEntries: 3,
      items: [ebayItem('1', 'S1'), ebayItem('2', 'S2'), ebayItem('3', 'S3')],
    }];
    getDbListingRows.mockResolvedValue([
      dbRow({ itemId: '1', sku: 'S1', ruleTargetZero: true, lastSyncedQty: 0 }),
      dbRow({ itemId: '2', sku: 'S2', ruleTargetZero: true, lastSyncedQty: 0 }),
      dbRow({ itemId: '3', sku: 'S3', ruleTargetZero: true, lastSyncedQty: 0 }),
    ]);
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron' });
    expect(getBrowseAvailability).toHaveBeenCalledTimes(2); // cap = 2 from config mock
    expect(res.browseChecked).toBe(2);
    expect(res.browseUnchecked).toBe(1);
    // browse fields ride along on the inserted results
    const inserted = insertResults.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(inserted.filter((r) => r.browseChecked === true)).toHaveLength(2);
    expect(inserted.filter((r) => r.browseStatus === 'IN_STOCK')).toHaveLength(2);
  });
});
