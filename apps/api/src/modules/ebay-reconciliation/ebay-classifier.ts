/**
 * Pure classifier for the eBay reconciliation dashboard (spec §6).
 *
 * Inputs: the full ActiveList snapshot (SKU-level) and all store-94
 * marketplace_listings rows (with a precomputed ruleTargetZero flag).
 * Output: one ClassifiedResult per (ItemID, SKU) pair, category precedence
 * per spec §6.1 — first match wins.
 *
 * No I/O here — keep this file pure so it stays trivially unit-testable.
 */
import type { EbayReconCategory } from '@admin/shared';

export interface ClassifierSnapshotRow {
  itemId: string;
  sku: string | null;
  title: string;
  isVariation: boolean;
  price: number | null;
  currency: string | null;
  qtyListed: number;
  qtySold: number;
  qtyAvailable: number;
}

export interface ClassifierDbRow {
  itemId: string;
  sku: string | null;
  listingStatus: string;
  lastSyncedQty: number | null;
  lastSyncedPrice: number | null;
  errorCode: string | null;
  ruleTargetZero: boolean;
}

export interface ClassifiedResult {
  itemId: string;
  sku: string | null;
  category: EbayReconCategory;
  dbListingStatus: string | null;
  dbLastSyncedQty: number | null;
  dbLastSyncedPrice: number | null;
  dbErrorCode: string | null;
  ebayQtyAvailable: number | null;
  ebayPrice: number | null;
  ebayTitle: string | null;
}

const LIVE_DB_STATUSES = new Set(['active', 'confirmed']);
const DEAD_DB_STATUSES = new Set(['deleted', 'suspended']);
const PRICE_TOLERANCE = 0.01;

const groupBy = <T>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
};

const fromDb = (r: ClassifierDbRow) => ({
  dbListingStatus: r.listingStatus,
  dbLastSyncedQty: r.lastSyncedQty,
  dbLastSyncedPrice: r.lastSyncedPrice,
  dbErrorCode: r.errorCode,
});
const noDb = { dbListingStatus: null, dbLastSyncedQty: null, dbLastSyncedPrice: null, dbErrorCode: null };
const fromSnap = (s: ClassifierSnapshotRow) => ({
  ebayQtyAvailable: s.qtyAvailable,
  ebayPrice: s.price,
  ebayTitle: s.title,
});
const noSnap = { ebayQtyAvailable: null, ebayPrice: null, ebayTitle: null };

/** Spec §6.1 rows 2/5–8 precedence for a matched (dbRow, snapRow) pair. */
function classifyPair(dbRow: ClassifierDbRow, snapRow: ClassifierSnapshotRow): EbayReconCategory {
  if (DEAD_DB_STATUSES.has(dbRow.listingStatus)) return 'status_mismatch';
  if (dbRow.ruleTargetZero && snapRow.qtyAvailable > 0) return 'oversell_suspect';
  const dbBuyable = (dbRow.lastSyncedQty ?? 0) > 0;
  const ebayBuyable = snapRow.qtyAvailable > 0;
  if (dbBuyable !== ebayBuyable) return 'qty_mismatch';
  if (
    dbRow.lastSyncedPrice != null &&
    snapRow.price != null &&
    Math.abs(dbRow.lastSyncedPrice - snapRow.price) > PRICE_TOLERANCE
  ) {
    return 'price_mismatch';
  }
  return 'managed_ok';
}

export function classifyListings(
  snapshot: ClassifierSnapshotRow[],
  db: ClassifierDbRow[],
): ClassifiedResult[] {
  const snapByItem = groupBy(snapshot, (r) => r.itemId);
  const dbByItem = groupBy(db, (r) => r.itemId);
  const results: ClassifiedResult[] = [];

  // --- ItemIDs live on eBay ---
  for (const [itemId, snapRows] of snapByItem) {
    const dbRows = dbByItem.get(itemId);

    if (!dbRows) {
      // Spec §6.1 #1: not ours — one row per ItemID, eBay quantities aggregated.
      results.push({
        itemId,
        sku: null,
        category: 'unmanaged',
        ...noDb,
        ebayQtyAvailable: snapRows.reduce((sum, r) => sum + r.qtyAvailable, 0),
        ebayPrice: snapRows[0].price,
        ebayTitle: snapRows[0].title,
      });
      continue;
    }

    // Spec §6.1 #2: live on eBay but our DB thinks the whole listing is gone.
    if (dbRows.every((r) => DEAD_DB_STATUSES.has(r.listingStatus))) {
      const snapBySku = new Map(snapRows.filter((s) => s.sku).map((s) => [s.sku as string, s]));
      for (const dbRow of dbRows) {
        const match = dbRow.sku ? snapBySku.get(dbRow.sku) : undefined;
        results.push({
          itemId,
          sku: dbRow.sku,
          category: 'status_mismatch',
          ...fromDb(dbRow),
          ...(match
            ? fromSnap(match)
            : { ...fromSnap(snapRows[0]), ebayQtyAvailable: snapRows.reduce((s, r) => s + r.qtyAvailable, 0) }),
        });
      }
      continue;
    }

    // SKU-level matching within a matched ItemID.
    const snapBySku = new Map(snapRows.filter((s) => s.sku !== null).map((s) => [s.sku as string, s]));
    const dbBySku = new Map(dbRows.filter((d) => d.sku !== null).map((d) => [d.sku as string, d]));
    const nullSnapRows = snapRows.filter((s) => s.sku === null);
    // Track consumed DB rows by identity (not by SKU string) so that a null-SKU
    // DB row can be recorded as "paired" without colliding with SKU-keyed lookups.
    const consumedDb = new Set<ClassifierDbRow>();

    for (const [sku, snapRow] of snapBySku) {
      const dbRow = dbBySku.get(sku);
      if (!dbRow) {
        results.push({ itemId, sku, category: 'unmatched_sku', ...noDb, ...fromSnap(snapRow) });
        continue;
      }
      consumedDb.add(dbRow);
      results.push({ itemId, sku, category: classifyPair(dbRow, snapRow), ...fromDb(dbRow), ...fromSnap(snapRow) });
    }

    // NULL-SKU snapshot rows (single-SKU listings without a seller SKU):
    // pair with the ItemID's single unconsumed DB row when unambiguous — preferring
    // a null-SKU DB row candidate — else report the snapshot row as unmatched.
    for (const snapRow of nullSnapRows) {
      const candidates = dbRows.filter((d) => !consumedDb.has(d));
      const nullSkuCandidates = candidates.filter((d) => d.sku === null);
      let dbRow: ClassifierDbRow | undefined;
      if (nullSkuCandidates.length === 1) {
        dbRow = nullSkuCandidates[0];
      } else if (candidates.length === 1) {
        dbRow = candidates[0];
      }

      if (dbRow) {
        consumedDb.add(dbRow);
        results.push({
          itemId,
          sku: dbRow.sku,
          category: classifyPair(dbRow, snapRow),
          ...fromDb(dbRow),
          ...fromSnap(snapRow),
        });
      } else {
        results.push({ itemId, sku: null, category: 'unmatched_sku', ...noDb, ...fromSnap(snapRow) });
      }
    }

    // DB rows (null- or non-null-SKU alike) that were never consumed by a pairing above.
    for (const dbRow of dbRows) {
      if (consumedDb.has(dbRow)) continue;
      results.push({ itemId, sku: dbRow.sku, category: 'unmatched_sku', ...fromDb(dbRow), ...noSnap });
    }
  }

  // --- DB ItemIDs absent from eBay ---
  for (const [itemId, dbRows] of dbByItem) {
    if (snapByItem.has(itemId)) continue;
    for (const dbRow of dbRows) {
      results.push({
        itemId,
        sku: dbRow.sku,
        // Spec §6.1 #3: DB thinks it is live but eBay does not list it (ghost).
        // Dead or dormant DB statuses absent from eBay are agreement -> managed_ok.
        category: LIVE_DB_STATUSES.has(dbRow.listingStatus) ? 'managed_ghost' : 'managed_ok',
        ...fromDb(dbRow),
        ...noSnap,
      });
    }
  }

  return results;
}
