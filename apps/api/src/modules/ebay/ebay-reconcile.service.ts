/**
 * eBay false-delete reconciliation.
 *
 * Cross-checks every row we marked terminal `deleted` for error 21916750 ("FixedPrice
 * item ended") against eBay's ACTUAL active listings (GetMyeBaySelling ActiveList).
 * Any such row whose ItemID is still live on eBay was a FALSE delete (OutOfStockControl
 * listings report transient "ended" while staying Active) — it is reactivated so the
 * normal sync resumes, exactly like the manual fix.
 *
 * Read-only when `dryRun` is true. This both cleans the existing backlog and serves as
 * a periodic safety net against future false deletes.
 */

import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import {
  getEbayDeletedEndedRows,
  reactivateEbayFalseDeletes,
} from '../marketplace-sync/marketplace-sync.db';

export interface ReconcileOptions {
  storeId: number;
  /** When true (default), report but make no writes. */
  dryRun: boolean;
}

export interface ReconcileResult {
  storeId: number;
  dryRun: boolean;
  activeOnEbay: number;        // total active listings on eBay
  deletedEndedRows: number;    // our rows marked deleted+21916750
  distinctDeletedItems: number;
  liveItems: number;           // distinct deleted ItemIDs that are actually live on eBay
  rowsReactivated: number;     // rows restored (or that WOULD be in dry-run)
  genuinelyEndedItems: number; // distinct deleted ItemIDs not live on eBay
  liveItemIds: string[];
}

export async function reconcileEbayFalseDeletes(opts: ReconcileOptions): Promise<ReconcileResult> {
  const { storeId, dryRun } = opts;
  const logger = getLogger();

  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RECONCILE_${storeId}`);

  // All ItemIDs currently live on eBay, and all our deleted+21916750 rows.
  const [activeIds, deletedRows] = await Promise.all([
    client.getActiveItemIds(storeId),
    getEbayDeletedEndedRows(storeId),
  ]);

  const distinctDeletedItems = new Set(deletedRows.map((r) => r.marketplace_item_identifier));
  const liveItemIds = [...distinctDeletedItems].filter((id) => activeIds.has(id));
  const liveSet = new Set(liveItemIds);
  const rowsToReactivate = deletedRows.filter((r) => liveSet.has(r.marketplace_item_identifier)).length;

  let rowsReactivated = rowsToReactivate;
  if (!dryRun && liveItemIds.length > 0) {
    rowsReactivated = await reactivateEbayFalseDeletes(storeId, liveItemIds);
  }

  const result: ReconcileResult = {
    storeId,
    dryRun,
    activeOnEbay: activeIds.size,
    deletedEndedRows: deletedRows.length,
    distinctDeletedItems: distinctDeletedItems.size,
    liveItems: liveItemIds.length,
    rowsReactivated,
    genuinelyEndedItems: distinctDeletedItems.size - liveItemIds.length,
    liveItemIds,
  };

  logger.info(
    { ...result, liveItemIds: undefined },
    dryRun
      ? 'eBay reconcile (dry-run): false-deletes that WOULD be reactivated'
      : 'eBay reconcile: reactivated false-deletes still live on eBay'
  );
  return result;
}
