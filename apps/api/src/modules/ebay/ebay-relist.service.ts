/**
 * eBay relist / recover job — handles listings the sync marked terminal `deleted`
 * for error 21916750 ("FixedPrice item ended") that still have stock.
 *
 * CRITICAL: `21916750` is NOT reliably terminal. On OutOfStockControl listings eBay
 * reports a transient/false "ended" while the listing is still ACTIVE (verified:
 * 8/15 of store 94's candidates were live on eBay). Relisting a live listing creates
 * a DUPLICATE. So this job VERIFIES every candidate against eBay (GetItem) before
 * acting, and branches per ItemID:
 *   - Active on eBay   -> REACTIVATE the rows (confirmed, last_synced_quantity=NULL)
 *                         so the normal sync resumes. NEVER relisted.
 *   - Ended/Completed  -> RELIST once via RelistFixedPriceItem (new ItemID), repoint
 *                         all rows for that ItemID, force a resync.
 *   - Not found / unknown -> left as-is and reported (no blind relist).
 *
 * A single eBay ItemID backs all variation rows, so candidates are de-duplicated by
 * ItemID and each listing is acted on exactly once. DRY-RUN (default) still calls the
 * read-only GetItem so the report is accurate; it makes no writes.
 */

import { config } from '../../config';
import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import {
  getEbayRelistCandidates,
  reactivateEbayFalseDeletes,
  markEbayRelistedByItemId,
  type EbayRelistCandidate,
} from '../marketplace-sync/marketplace-sync.db';

export interface RelistJobOptions {
  storeId: number;
  /** When true (default), verify (read-only GetItem) and report but make no writes. */
  dryRun: boolean;
  /** Max candidate rows to fetch. */
  limit: number;
  /** If set, only act on these eBay ItemIDs (others reported as skipped). */
  itemIds?: string[];
  /** If set, use these candidates instead of querying (ghost-relist path). */
  candidates?: EbayRelistCandidate[];
}

export type RelistAction =
  | 'reactivate'   // live on eBay -> restored to sync set
  | 'relist'       // genuinely ended -> relisted with new ItemID
  | 'failed'       // relist attempt failed
  | 'gone'         // eBay has no such item -> cannot relist
  | 'unknown'      // could not verify status -> left untouched
  | 'skipped';     // excluded by --item-ids filter

export interface RelistOutcome {
  itemId: string;
  newItemId?: string;
  rows: number;            // marketplace_listings rows backing this ItemID (variations)
  action: RelistAction;
  dryRun: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface RelistJobResult {
  storeId: number;
  dryRun: boolean;
  candidateRows: number;
  distinctItems: number;
  reactivated: number;     // listings live on eBay -> restored
  relisted: number;        // listings ended -> relisted
  failed: number;
  gone: number;
  unknown: number;
  skipped: number;
  outcomes: RelistOutcome[];
}

/** Group candidate rows by eBay ItemID (one listing == one ItemID == many variation rows). */
function groupByItemId(candidates: EbayRelistCandidate[]): Map<string, EbayRelistCandidate[]> {
  const map = new Map<string, EbayRelistCandidate[]>();
  for (const c of candidates) {
    const list = map.get(c.marketplace_item_identifier) ?? [];
    list.push(c);
    map.set(c.marketplace_item_identifier, list);
  }
  return map;
}

export async function relistEndedEbayListings(opts: RelistJobOptions): Promise<RelistJobResult> {
  const { storeId, dryRun, limit, itemIds } = opts;
  const logger = getLogger();
  const maxQuantityCap = config.MARKETPLACE_EBAY_MAX_QUANTITY_CAP ?? 0;
  const allowed = itemIds && itemIds.length > 0 ? new Set(itemIds) : null;

  const candidates = opts.candidates ?? (await getEbayRelistCandidates(storeId, maxQuantityCap, limit));
  const byItem = groupByItemId(candidates);

  logger.info(
    { storeId, candidateRows: candidates.length, distinctItems: byItem.size, dryRun, limit, restrictedToItemIds: allowed?.size ?? 0 },
    'eBay relist/recover: candidates fetched'
  );

  // GetItem is read-only, so we authenticate and verify even in dry-run for an
  // accurate report. We only write to eBay/DB when dryRun is false.
  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RELIST_${storeId}`);

  const outcomes: RelistOutcome[] = [];

  for (const [itemId, rows] of byItem) {
    if (allowed && !allowed.has(itemId)) {
      outcomes.push({ itemId, rows: rows.length, action: 'skipped', dryRun });
      continue;
    }

    const status = await client.getItemListingStatus(storeId, itemId);

    if (status === 'active') {
      // FALSE delete — listing is live. Restore rows so the normal sync resumes.
      if (!dryRun) await reactivateEbayFalseDeletes(storeId, [itemId]);
      outcomes.push({ itemId, rows: rows.length, action: 'reactivate', dryRun });
      logger.info({ storeId, itemId, rows: rows.length, dryRun }, 'Candidate is ACTIVE on eBay -> reactivate (NOT relisted)');
      continue;
    }

    if (status === 'ended') {
      if (dryRun) {
        outcomes.push({ itemId, rows: rows.length, action: 'relist', dryRun });
        continue;
      }
      // RelistFixedPriceItem reuses the item's prior data (incl. variations); do NOT
      // override quantity. Repoint all rows to the new ItemID and force a resync.
      const res = await client.relistFixedPriceItem(storeId, itemId);
      if (res.success && res.newItemId) {
        await markEbayRelistedByItemId(storeId, itemId, res.newItemId);
        outcomes.push({ itemId, newItemId: res.newItemId, rows: rows.length, action: 'relist', dryRun });
        logger.info({ storeId, oldItemId: itemId, newItemId: res.newItemId, rows: rows.length }, 'Relisted ended eBay listing');
      } else {
        outcomes.push({ itemId, rows: rows.length, action: 'failed', dryRun, errorCode: res.errorCode, errorMessage: res.errorMessage });
        logger.warn({ storeId, itemId, errorCode: res.errorCode, errorMessage: res.errorMessage }, 'Relist failed (left as deleted)');
      }
      continue;
    }

    // not-found or unknown: never relist blind.
    outcomes.push({ itemId, rows: rows.length, action: status === 'not-found' ? 'gone' : 'unknown', dryRun });
    logger.warn({ storeId, itemId, status }, 'Candidate not relisted (could not confirm it is genuinely ended)');
  }

  const count = (a: RelistAction) => outcomes.filter((o) => o.action === a).length;
  const result: RelistJobResult = {
    storeId,
    dryRun,
    candidateRows: candidates.length,
    distinctItems: byItem.size,
    reactivated: count('reactivate'),
    relisted: count('relist'),
    failed: count('failed'),
    gone: count('gone'),
    unknown: count('unknown'),
    skipped: count('skipped'),
    outcomes,
  };

  logger.info(
    { ...result, outcomes: undefined },
    'eBay relist/recover job complete'
  );
  return result;
}

export type { EbayRelistCandidate };
