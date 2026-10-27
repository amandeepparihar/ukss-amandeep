import { describe, it, expect } from 'vitest';
import {
  classifyListings,
  type ClassifierSnapshotRow,
  type ClassifierDbRow,
} from './ebay-classifier';

const snap = (o: Partial<ClassifierSnapshotRow> = {}): ClassifierSnapshotRow => ({
  itemId: '111', sku: 'SKU-A', title: 'Test shirt', isVariation: true,
  price: 19.99, currency: 'GBP', qtyListed: 1, qtySold: 0, qtyAvailable: 1, ...o,
});
const db = (o: Partial<ClassifierDbRow> = {}): ClassifierDbRow => ({
  itemId: '111', sku: 'SKU-A', listingStatus: 'confirmed',
  lastSyncedQty: 1, lastSyncedPrice: 19.99, errorCode: null, ruleTargetZero: false, ...o,
});
const only = (rows: ReturnType<typeof classifyListings>, cat: string) =>
  rows.filter((r) => r.category === cat);

describe('classifyListings', () => {
  it('flags eBay items with no DB row as unmanaged (one row per ItemID, eBay qty summed)', () => {
    const r = classifyListings(
      [snap({ itemId: '999', sku: 'S1', qtyAvailable: 1 }), snap({ itemId: '999', sku: 'S2', qtyAvailable: 2 })],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ itemId: '999', sku: null, category: 'unmanaged', ebayQtyAvailable: 3, ebayTitle: 'Test shirt' });
    expect(r[0].dbListingStatus).toBeNull();
  });

  it('flags DB live rows absent from eBay as managed_ghost (one row per DB SKU row)', () => {
    const r = classifyListings([], [db({ sku: 'A' }), db({ sku: 'B', listingStatus: 'active' })]);
    expect(only(r, 'managed_ghost')).toHaveLength(2);
    expect(r[0].ebayQtyAvailable).toBeNull();
  });

  it('treats DB deleted/suspended rows absent from eBay as managed_ok (agreement)', () => {
    const r = classifyListings([], [db({ listingStatus: 'deleted' }), db({ listingStatus: 'suspended', sku: 'B' })]);
    expect(only(r, 'managed_ok')).toHaveLength(2);
  });

  it('flags status_mismatch when ALL DB rows for a live eBay item are deleted/suspended', () => {
    const r = classifyListings(
      [snap()],
      [db({ listingStatus: 'deleted', errorCode: '21916750' }), db({ sku: 'B', listingStatus: 'suspended' })],
    );
    expect(only(r, 'status_mismatch')).toHaveLength(2);
    expect(r[0].dbErrorCode).toBe('21916750');
  });

  it('flags a deleted DB SKU whose sibling is live as per-SKU status_mismatch, not item-level', () => {
    const r = classifyListings(
      [snap({ sku: 'A' }), snap({ sku: 'B' })],
      [db({ sku: 'A', listingStatus: 'deleted' }), db({ sku: 'B' })],
    );
    expect(only(r, 'status_mismatch').map((x) => x.sku)).toEqual(['A']);
    expect(only(r, 'managed_ok').map((x) => x.sku)).toEqual(['B']);
  });

  it('flags SKUs present on only one side as unmatched_sku', () => {
    const r = classifyListings(
      [snap({ sku: 'EBAY-ONLY' }), snap({ sku: 'BOTH' })],
      [db({ sku: 'BOTH' }), db({ sku: 'DB-ONLY' })],
    );
    const um = only(r, 'unmatched_sku');
    expect(um.map((x) => x.sku).sort()).toEqual(['DB-ONLY', 'EBAY-ONLY']);
    expect(only(r, 'managed_ok').map((x) => x.sku)).toEqual(['BOTH']);
  });

  it('flags oversell_suspect when rule target is 0 but eBay shows buyable — wins over qty_mismatch', () => {
    const r = classifyListings(
      [snap({ qtyAvailable: 1 })],
      [db({ ruleTargetZero: true, lastSyncedQty: 0 })],
    );
    expect(r[0].category).toBe('oversell_suspect');
  });

  it('does NOT flag rule-target-zero rows that eBay already shows unbuyable', () => {
    const r = classifyListings(
      [snap({ qtyListed: 1, qtySold: 1, qtyAvailable: 0 })],
      [db({ ruleTargetZero: true, lastSyncedQty: 0 })],
    );
    expect(r[0].category).toBe('managed_ok');
  });

  it('flags qty_mismatch only on buyability disagreement (XOR), not raw inequality', () => {
    // Sale between syncs: db pushed 1, buyer bought it -> eBay 0. Buyability disagrees -> flag.
    const disagree = classifyListings([snap({ qtyAvailable: 0, qtySold: 1 })], [db({ lastSyncedQty: 1 })]);
    expect(disagree[0].category).toBe('qty_mismatch');
    // Both buyable with different raw numbers -> NOT flagged.
    const agree = classifyListings([snap({ qtyAvailable: 3 })], [db({ lastSyncedQty: 1 })]);
    expect(agree[0].category).toBe('managed_ok');
  });

  it('flags price_mismatch beyond a 0.01 tolerance, never on NULL sides', () => {
    expect(classifyListings([snap({ price: 21.99 })], [db()])[0].category).toBe('price_mismatch');
    expect(classifyListings([snap({ price: 19.995 })], [db()])[0].category).toBe('managed_ok');
    expect(classifyListings([snap({ price: null })], [db()])[0].category).toBe('managed_ok');
    expect(classifyListings([snap()], [db({ lastSyncedPrice: null })])[0].category).toBe('managed_ok');
  });

  it('pairs a NULL-SKU snapshot row against a single DB row for the ItemID', () => {
    const r = classifyListings(
      [snap({ sku: null, isVariation: false })],
      [db({ sku: 'DB-SKU' })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].category).toBe('managed_ok');
    expect(r[0].sku).toBe('DB-SKU'); // reported under the DB row's SKU
  });

  it('reports a NULL-SKU snapshot row as unmatched_sku when the ItemID has multiple DB rows', () => {
    const r = classifyListings(
      [snap({ sku: null, isVariation: false })],
      [db({ sku: 'A' }), db({ sku: 'B' })],
    );
    expect(only(r, 'unmatched_sku').some((x) => x.sku === null)).toBe(true);
  });

  it('classifies DB rows with non-live, non-dead statuses (inactive/draft/paused) absent from eBay as managed_ok', () => {
    const r = classifyListings([], [db({ listingStatus: 'inactive' })]);
    expect(r[0].category).toBe('managed_ok');
  });

  it('pairs a NULL-SKU snapshot row with the ItemID\'s NULL-SKU DB row even when an orphaned non-null-SKU DB row also fails to pair (no silent drop)', () => {
    const r = classifyListings(
      [snap({ itemId: '111', sku: null, isVariation: false, qtyAvailable: 1, price: 19.99 })],
      [db({ itemId: '111', sku: null }), db({ itemId: '111', sku: 'ORPHAN' })],
    );
    expect(r).toHaveLength(2);
    expect(r.filter((x) => x.category === 'managed_ok' && x.sku === null)).toHaveLength(1);
    expect(only(r, 'unmatched_sku').map((x) => x.sku)).toEqual(['ORPHAN']);
  });
});
