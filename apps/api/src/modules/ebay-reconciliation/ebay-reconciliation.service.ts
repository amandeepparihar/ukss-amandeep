/**
 * Dashboard actions (spec §7). Every action is verify-first and dry-run-first:
 *  - reactivate: GetItem-verify ACTIVE before restoring rows (false-delete fix)
 *  - relist:     delegates to relistEndedEbayListings (GetItem-verify inside)
 *  - mark-gone:  DB-only; never calls eBay
 *  - verify-oversell: Browse (buyer view) re-check; read-only against eBay
 */
import { config } from '../../config';
import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import {
  reactivateEbayFalseDeletes,
  getEbayGhostRelistCandidates,
} from '../marketplace-sync/marketplace-sync.db';
import { relistEndedEbayListings } from '../ebay/ebay-relist.service';
import {
  markEbayListingsGone,
  countGhostRowsForItems,
  getResultRowsForVerify,
  updateResultBrowse,
} from './ebay-reconciliation.db';
import type { EbayReconActionOutcome } from '@admin/shared';

export interface ReconActionOptions {
  storeId: number;
  itemIds: string[];
  dryRun: boolean;
}

export async function reactivateVerifiedItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun } = opts;
  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RECON_REACTIVATE_${storeId}`);

  const outcomes: EbayReconActionOutcome[] = [];
  for (const itemId of itemIds) {
    const status = await client.getItemListingStatus(storeId, itemId);
    if (status === 'active') {
      if (!dryRun) await reactivateEbayFalseDeletes(storeId, [itemId]);
      outcomes.push({ itemId, action: 'reactivate' });
    } else {
      // Not live on eBay: reactivating would put a dead listing back in the
      // sync set — refuse, report what eBay said instead.
      outcomes.push({ itemId, action: `not-active:${status}` });
    }
  }
  getLogger().info({ storeId, dryRun, requested: itemIds.length }, 'eBay recon action: reactivate');
  return outcomes;
}

export async function relistGhostItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun } = opts;
  const maxQuantityCap = config.MARKETPLACE_EBAY_MAX_QUANTITY_CAP ?? 0;
  const candidates = await getEbayGhostRelistCandidates(storeId, itemIds, maxQuantityCap);

  const result = await relistEndedEbayListings({ storeId, dryRun, limit: itemIds.length, itemIds, candidates });
  const outcomes: EbayReconActionOutcome[] = result.outcomes.map((o) => ({
    itemId: o.itemId,
    action: o.action,
    rows: o.rows,
    newItemId: o.newItemId,
    detail: o.errorMessage,
  }));

  // ItemIDs with no sellable candidate (rule target 0 / no stock): report, never drop silently.
  const covered = new Set(candidates.map((c) => c.marketplace_item_identifier));
  for (const itemId of itemIds) {
    if (!covered.has(itemId)) {
      outcomes.push({ itemId, action: 'skipped', detail: 'no sellable stock (rule target 0) — use mark-gone instead' });
    }
  }
  return outcomes;
}

export async function markGoneItems(opts: ReconActionOptions & { runId: number | null }): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun, runId } = opts;
  if (dryRun) {
    const rows = await countGhostRowsForItems(storeId, itemIds);
    return [{ itemId: itemIds.join(','), action: 'would-mark-gone', rows }];
  }
  const rows = await markEbayListingsGone(storeId, itemIds, runId);
  return [{ itemId: itemIds.join(','), action: 'marked-gone', rows }];
}

export async function verifyOversellItems(opts: {
  storeId: number;
  runId: number;
  itemIds: string[];
}): Promise<EbayReconActionOutcome[]> {
  const { storeId, runId, itemIds } = opts;
  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RECON_VERIFY_${storeId}`);

  const rows = await getResultRowsForVerify(runId, itemIds);
  const outcomes: EbayReconActionOutcome[] = [];
  for (const row of rows) {
    const avail = await client.getBrowseAvailability(storeId, row.itemId, row.sku ?? undefined);
    await updateResultBrowse(row.id, avail?.status ?? null, avail?.qty ?? null);
    outcomes.push({
      itemId: row.itemId,
      action: avail?.status ?? 'unresolved',
      detail: row.sku ?? undefined,
    });
  }
  return outcomes;
}
