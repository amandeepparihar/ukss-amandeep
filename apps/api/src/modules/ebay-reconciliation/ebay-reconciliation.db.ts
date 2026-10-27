/**
 * DB layer for the eBay reconciliation dashboard. All writes for snapshot runs,
 * results, the action audit log, and the mark-gone mutation live here.
 */
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { EBAY_RULE_TARGET_ZERO_SELECT } from './ebay-rule-target';
import type { ClassifierDbRow, ClassifierSnapshotRow, ClassifiedResult } from './ebay-classifier';

export const STALE_RUN_MS = 2 * 60 * 60 * 1000; // spec §4: stale lock takeover after 2h
const INSERT_CHUNK = 1000;

export class SnapshotRunInProgressError extends Error {
  constructor(public runId: number) {
    super(`eBay snapshot run ${runId} is already in progress`);
    this.name = 'SnapshotRunInProgressError';
  }
}

export function isRunStale(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() > STALE_RUN_MS;
}

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The `running` row is the lock. Stale (>2h) running rows are failed and superseded. */
export async function acquireSnapshotRun(
  storeId: number,
  trigger: 'cron' | 'manual',
  triggeredBy?: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const running = await tx.ebaySnapshotRun.findFirst({ where: { storeId, status: 'running' } });
    if (running) {
      if (!isRunStale(running.startedAt, new Date())) throw new SnapshotRunInProgressError(running.id);
      await tx.ebaySnapshotRun.update({
        where: { id: running.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: 'Stale: exceeded 2h without finishing; superseded by a new run' },
      });
      await tx.ebayListingSnapshot.deleteMany({ where: { runId: running.id } });
      await tx.ebayReconciliationResult.deleteMany({ where: { runId: running.id } });
    }
    const run = await tx.ebaySnapshotRun.create({
      data: { storeId, triggerSource: trigger, triggeredBy: triggeredBy ?? null, status: 'running' },
    });
    return run.id;
  });
}

export async function insertSnapshotRows(runId: number, rows: ClassifierSnapshotRow[]): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const res = await prisma.ebayListingSnapshot.createMany({
      data: batch.map((r) => ({
        runId,
        itemId: r.itemId,
        sku: r.sku,
        title: r.title,
        isVariation: r.isVariation,
        price: r.price,
        currency: r.currency,
        qtyListed: r.qtyListed,
        qtySold: r.qtySold,
        qtyAvailable: r.qtyAvailable,
      })),
    });
    inserted += res.count;
  }
  return inserted;
}

/**
 * All store-94 listing rows with an ItemID, plus the precomputed
 * rule_target_zero flag (shared arms — see ebay-rule-target.ts).
 * Collation: products_sku (utf8mb4) -> CONVERT(... USING latin1) for the npv join.
 */
export async function getDbListingRows(storeId: number): Promise<ClassifierDbRow[]> {
  const sql = `
    SELECT
      ml.marketplace_item_identifier AS item_id,
      ml.products_sku                AS sku,
      ml.marketplace_listing_status  AS listing_status,
      ml.last_synced_quantity        AS last_synced_qty,
      ml.last_synced_price           AS last_synced_price,
      ml.api_last_error_code         AS error_code,
      ${EBAY_RULE_TARGET_ZERO_SELECT} AS rule_target_zero
    FROM marketplace_listings ml
    LEFT JOIN new_products_variations npv
      ON npv.npv_products_sku = CONVERT(ml.products_sku USING latin1)
    LEFT JOIN new_products np
      ON np.products_id = ml.products_id
    WHERE ml.store_id = ?
      AND ml.marketplace_item_identifier IS NOT NULL
      AND ml.marketplace_item_identifier != ''
  `;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, storeId);
  return rows.map((r) => ({
    itemId: String(r.item_id),
    sku: r.sku != null && String(r.sku).length > 0 ? String(r.sku) : null,
    listingStatus: String(r.listing_status),
    lastSyncedQty: r.last_synced_qty != null ? Number(r.last_synced_qty) : null,
    lastSyncedPrice: r.last_synced_price != null ? Number(r.last_synced_price) : null,
    errorCode: r.error_code != null && String(r.error_code).length > 0 ? String(r.error_code) : null,
    ruleTargetZero: Number(r.rule_target_zero ?? 0) === 1,
  }));
}

/**
 * ClassifiedResult optionally enriched with the in-run Browse verification
 * (the snapshot service checks suspects BEFORE persisting, so browse state
 * rides along on the insert — no post-insert id round-trip needed).
 */
export type ResultWithBrowse = ClassifiedResult & {
  browseChecked?: boolean;
  browseStatus?: string | null;
  browseQty?: number | null;
};

export async function insertResults(runId: number, storeId: number, rows: ResultWithBrowse[]): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const res = await prisma.ebayReconciliationResult.createMany({
      data: batch.map((r) => ({
        runId,
        storeId,
        itemId: r.itemId,
        sku: r.sku,
        category: r.category,
        dbListingStatus: r.dbListingStatus,
        dbLastSyncedQty: r.dbLastSyncedQty,
        dbLastSyncedPrice: r.dbLastSyncedPrice,
        dbErrorCode: r.dbErrorCode,
        ebayQtyAvailable: r.ebayQtyAvailable,
        ebayPrice: r.ebayPrice,
        ebayTitle: r.ebayTitle,
        browseChecked: r.browseChecked ?? false,
        browseStatus: r.browseStatus ?? null,
        browseQty: r.browseQty ?? null,
      })),
    });
    inserted += res.count;
  }
  return inserted;
}

export interface RunCounts {
  pagesFetched: number;
  listingsFetched: number;
  variationsFetched: number;
  summaryJson: string;
}

export async function completeRun(runId: number, counts: RunCounts): Promise<void> {
  await prisma.ebaySnapshotRun.update({
    where: { id: runId },
    data: { status: 'completed', finishedAt: new Date(), ...counts },
  });
}

/** Abort: a partial snapshot must never masquerade as complete (spec §4). */
export async function failRun(runId: number, errorMessage: string): Promise<void> {
  await prisma.$transaction([
    prisma.ebayListingSnapshot.deleteMany({ where: { runId } }),
    prisma.ebayReconciliationResult.deleteMany({ where: { runId } }),
    prisma.ebaySnapshotRun.update({
      where: { id: runId },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: errorMessage.slice(0, 5000) },
    }),
  ]);
}

/** Purge child rows of completed runs beyond the newest `keepCompleted`. Run metadata stays. */
export async function purgeOldRuns(storeId: number, keepCompleted: number): Promise<number> {
  const keep = await prisma.ebaySnapshotRun.findMany({
    where: { storeId, status: 'completed' },
    orderBy: { startedAt: 'desc' },
    take: keepCompleted,
    select: { id: true },
  });
  const keepIds = keep.map((r) => r.id);
  const stale = await prisma.ebaySnapshotRun.findMany({
    where: { storeId, status: 'completed', id: { notIn: keepIds } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const staleIds = stale.map((r) => r.id);
  await prisma.$transaction([
    prisma.ebayListingSnapshot.deleteMany({ where: { runId: { in: staleIds } } }),
    prisma.ebayReconciliationResult.deleteMany({ where: { runId: { in: staleIds } } }),
  ]);
  getLogger().info({ storeId, purgedRuns: staleIds.length }, 'eBay recon: purged old snapshot child rows');
  return staleIds.length;
}

export async function getLatestCompletedRunId(storeId: number): Promise<number | null> {
  const run = await prisma.ebaySnapshotRun.findFirst({
    where: { storeId, status: 'completed' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

export async function updateResultBrowse(resultId: number, status: string | null, qty: number | null): Promise<void> {
  await prisma.ebayReconciliationResult.update({
    where: { id: resultId },
    data: { browseChecked: true, browseStatus: status, browseQty: qty },
  });
}

/** Denormalize the last action onto the result rows the user acted on. */
export async function markResultsActioned(
  runId: number,
  itemIds: string[],
  action: string,
  actionBy: string,
): Promise<number> {
  const res = await prisma.ebayReconciliationResult.updateMany({
    where: { runId, itemId: { in: itemIds } },
    data: { actionTaken: action, actionAt: new Date(), actionBy },
  });
  return res.count;
}

export async function insertActionLog(entry: {
  runId: number | null;
  action: string;
  itemIds: string[];
  dryRun: boolean;
  requestedBy: string;
  outcomeJson: string;
  status: 'completed' | 'failed';
}): Promise<void> {
  await prisma.ebayReconciliationAction.create({
    data: {
      runId: entry.runId,
      action: entry.action,
      itemIdsJson: JSON.stringify(entry.itemIds),
      dryRun: entry.dryRun,
      requestedBy: entry.requestedBy,
      outcomeJson: entry.outcomeJson,
      status: entry.status,
    },
  });
}

/** Dry-run preview for mark-gone: how many live rows the UPDATE would touch. */
export async function countGhostRowsForItems(storeId: number, itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<{ total: unknown }[]>(
    `SELECT COUNT(*) AS total FROM marketplace_listings
     WHERE store_id = ? AND marketplace_item_identifier IN (${placeholders})
       AND marketplace_listing_status IN ('active','confirmed')`,
    storeId,
    ...itemIds,
  );
  return Number(rows[0]?.total ?? 0);
}

/** Result rows eligible for a targeted Browse re-check. */
export async function getResultRowsForVerify(
  runId: number,
  itemIds: string[],
): Promise<{ id: number; itemId: string; sku: string | null }[]> {
  const rows = await prisma.ebayReconciliationResult.findMany({
    where: { runId, itemId: { in: itemIds }, category: { in: ['oversell_suspect', 'qty_mismatch'] } },
    select: { id: true, itemId: true, sku: true },
  });
  return rows.map((r) => ({ id: r.id, itemId: r.itemId, sku: r.sku }));
}

/**
 * DB-only ghost cleanup (spec §7 mark-gone): confirmed-dead ghosts stop being
 * considered by the sync. Terminal-status convention matches the sync's
 * terminal handling: status deleted, last_sync_status success, retry 0, error
 * kept for audit (marker code so the origin is traceable).
 */
export async function markEbayListingsGone(storeId: number, itemIds: string[], runId: number | null): Promise<number> {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => '?').join(',');
  const sql = `
    UPDATE marketplace_listings
    SET marketplace_listing_status = 'deleted',
        last_sync_status = 'success',
        retry_count = 0,
        api_last_error_code = 'RECON_MARK_GONE',
        api_last_error_message = CONCAT('[EBAY_RECON] marked gone via reconciliation run ', ?)
    WHERE store_id = ?
      AND marketplace_item_identifier IN (${placeholders})
      AND marketplace_listing_status IN ('active','confirmed')
  `;
  const affected = await (prisma.$executeRawUnsafe as (q: string, ...v: unknown[]) => Promise<number>)(
    sql,
    String(runId ?? 'manual'),
    storeId,
    ...itemIds,
  );
  getLogger().info({ storeId, itemIds: itemIds.length, affected, runId }, 'eBay recon: marked ghosts gone');
  return Number(affected);
}
