/**
 * eBay reconciliation snapshot job (spec §4).
 *
 * Sweeps GetMyeBaySelling ActiveList (variations included), classifies every
 * (ItemID, SKU) pair against marketplace_listings store 94, Browse-verifies
 * oversell suspects (capped), persists snapshot + results, purges old runs.
 *
 * Failure semantics: any unrecovered error aborts the run — failRun() deletes
 * the partial child rows so a half sweep can never masquerade as a complete
 * snapshot (everything unseen would misclassify as managed_ghost).
 *
 * OOS-control assumption: store 94 has Out-of-Stock Control ON, so hidden
 * qty-0 listings remain in ActiveList and absence == genuinely ended. Recorded
 * in the run summary for the dashboard footnote.
 */
import { config } from '../../config';
import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import { classifyListings, type ClassifierSnapshotRow } from './ebay-classifier';
import { parseActiveListingItem } from './ebay-snapshot.parse';
import {
  acquireSnapshotRun,
  insertSnapshotRows,
  getDbListingRows,
  insertResults,
  completeRun,
  failRun,
  purgeOldRuns,
  type ResultWithBrowse,
} from './ebay-reconciliation.db';

export const KEEP_COMPLETED_RUNS = 14;

export interface EbaySnapshotOptions {
  storeId: number;
  trigger: 'cron' | 'manual';
  triggeredBy?: string;
  /** When true: fetch + classify + report counts, but acquire no lock and write nothing. */
  dryRun?: boolean;
}

export interface EbaySnapshotResult {
  runId: number | null;
  dryRun: boolean;
  pages: number;
  listingsFetched: number;   // distinct ItemIDs seen on eBay
  variationRows: number;     // SKU-level snapshot rows
  categoryCounts: Record<string, number>;
  browseChecked: number;
  browseUnchecked: number;
}

export async function runEbaySnapshot(opts: EbaySnapshotOptions): Promise<EbaySnapshotResult> {
  const dryRun = opts.dryRun ?? false;
  const runId = dryRun ? null : await acquireSnapshotRun(opts.storeId, opts.trigger, opts.triggeredBy);
  return executeSnapshot(runId, opts.storeId, dryRun);
}

/** HTTP refresh path: acquire the lock NOW (409 surface), finish in background. */
export async function startEbaySnapshotAsync(storeId: number, triggeredBy: string): Promise<number> {
  const runId = await acquireSnapshotRun(storeId, 'manual', triggeredBy);
  void executeSnapshot(runId, storeId, false).catch((error) => {
    // executeSnapshot already failRun()s; this guard only prevents an unhandled rejection.
    getLogger().error({ runId, storeId, error }, 'eBay recon: background snapshot run failed');
  });
  return runId;
}

async function executeSnapshot(runId: number | null, storeId: number, dryRun: boolean): Promise<EbaySnapshotResult> {
  const logger = getLogger();
  try {
    const client = createEbayClient('ebay');
    await client.fetchAccessToken(`EBAY_SNAPSHOT_${storeId}`);

    // 1. Sweep ActiveList.
    const snapshotRows: ClassifierSnapshotRow[] = [];
    const itemIds = new Set<string>();
    let pages = 0;
    for await (const page of client.iterateActiveListings(storeId)) {
      pages = page.totalPages;
      for (const raw of page.items) {
        for (const row of parseActiveListingItem(raw)) {
          snapshotRows.push(row);
          itemIds.add(row.itemId);
        }
      }
      logger.info({ runId, storeId, page: page.pageNumber, of: page.totalPages, rows: snapshotRows.length }, 'eBay recon: page swept');
    }
    if (runId !== null) await insertSnapshotRows(runId, snapshotRows);

    // 2. Classify.
    const dbRows = await getDbListingRows(storeId);
    const results: ResultWithBrowse[] = classifyListings(snapshotRows, dbRows);

    // 3. Browse verification (buyer view) for the suspect set, capped (spec §6.3).
    const suspects = results.filter(
      (r) =>
        r.category === 'oversell_suspect' ||
        (r.category === 'qty_mismatch' && (r.dbLastSyncedQty ?? 0) === 0 && (r.ebayQtyAvailable ?? 0) > 0),
    );
    const cap = config.EBAY_RECON_BROWSE_CAP;
    const toCheck = suspects.slice(0, cap);
    for (const suspect of toCheck) {
      const avail = await client.getBrowseAvailability(storeId, suspect.itemId, suspect.sku ?? undefined);
      suspect.browseChecked = true;
      suspect.browseStatus = avail?.status ?? null;
      suspect.browseQty = avail?.qty ?? null;
    }
    const browseUnchecked = suspects.length - toCheck.length;
    if (browseUnchecked > 0) {
      logger.warn({ runId, storeId, browseUnchecked, cap }, 'eBay recon: Browse cap reached — remaining suspects left UNCHECKED (not safe)');
    }

    // 4. Finalize.
    const categoryCounts: Record<string, number> = {};
    for (const r of results) categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
    const summary = {
      categoryCounts,
      browseChecked: toCheck.length,
      browseUnchecked,
      oosControlAssumed: true,
      activeListingsOnEbay: itemIds.size,
    };
    if (runId !== null) {
      await insertResults(runId, storeId, results);
      await completeRun(runId, {
        pagesFetched: pages,
        listingsFetched: itemIds.size,
        variationsFetched: snapshotRows.length,
        summaryJson: JSON.stringify(summary),
      });
      await purgeOldRuns(storeId, KEEP_COMPLETED_RUNS);
    }

    const result: EbaySnapshotResult = {
      runId,
      dryRun,
      pages,
      listingsFetched: itemIds.size,
      variationRows: snapshotRows.length,
      categoryCounts,
      browseChecked: toCheck.length,
      browseUnchecked,
    };
    logger.info({ ...result }, dryRun ? 'eBay recon snapshot (dry-run) complete' : 'eBay recon snapshot complete');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId !== null) await failRun(runId, message);
    throw error;
  }
}
