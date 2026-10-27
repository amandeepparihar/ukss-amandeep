/**
 * Read queries for the reconciliation dashboard. ONE builder powers both the
 * server-side DataTable (/items) and the CSV export (/items/export) — the
 * datatable-standards rule. Reads only jsa_ebay_* tables (precomputed diff).
 */
import { prisma } from '../../lib/prisma';
import type {
  EbayReconItem,
  EbayReconItemsResponse,
  EbayReconRunSummary,
  EbayReconSummaryResponse,
} from '@admin/shared';

const num = (v: unknown): number => Number((v as number | bigint | string) ?? 0);

/** UI sort key -> physical column. Anything else falls back to id (SQL-injection guard). */
const SORTABLE: Record<string, string> = {
  id: 'id',
  itemId: 'item_id',
  sku: 'sku',
  category: 'category',
  dbListingStatus: 'db_listing_status',
  dbLastSyncedQty: 'db_last_synced_qty',
  ebayQtyAvailable: 'ebay_qty_available',
  ebayPrice: 'ebay_price',
  browseStatus: 'browse_status',
  actionAt: 'action_at',
};

export interface ReconItemsParams {
  runId: number;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  categories?: string[];
  search?: string;
  browseStatus?: string[];
}

export function buildItemsWhere(
  p: Pick<ReconItemsParams, 'runId' | 'categories' | 'search' | 'browseStatus'>,
): { where: string; values: unknown[] } {
  const conds: string[] = ['r.run_id = ?'];
  const values: unknown[] = [p.runId];
  if (p.categories && p.categories.length > 0) {
    conds.push(`r.category IN (${p.categories.map(() => '?').join(',')})`);
    values.push(...p.categories);
  }
  if (p.browseStatus && p.browseStatus.length > 0) {
    conds.push(`r.browse_status IN (${p.browseStatus.map(() => '?').join(',')})`);
    values.push(...p.browseStatus);
  }
  if (p.search && p.search.trim().length > 0) {
    conds.push('(r.item_id LIKE ? OR r.sku LIKE ? OR r.ebay_title LIKE ?)');
    const term = `%${p.search.trim()}%`;
    values.push(term, term, term);
  }
  return { where: conds.join(' AND '), values };
}

export function buildOrderBy(sortBy?: string, sortOrder?: 'asc' | 'desc'): string {
  const col = SORTABLE[sortBy ?? ''] ?? 'id';
  const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY r.${col} ${dir}, r.id ASC`;
}

const SELECT_COLS = `
  r.id, r.run_id, r.item_id, r.sku, r.category,
  r.db_listing_status, r.db_last_synced_qty, r.db_last_synced_price, r.db_error_code,
  r.ebay_qty_available, r.ebay_price, r.ebay_title,
  r.browse_checked, r.browse_status, r.browse_qty,
  r.action_taken, r.action_at, r.action_by
`;

const rowToItem = (r: any): EbayReconItem => ({
  id: num(r.id),
  runId: num(r.run_id),
  itemId: String(r.item_id),
  sku: r.sku != null ? String(r.sku) : null,
  category: r.category,
  dbListingStatus: r.db_listing_status ?? null,
  dbLastSyncedQty: r.db_last_synced_qty != null ? num(r.db_last_synced_qty) : null,
  dbLastSyncedPrice: r.db_last_synced_price != null ? Number(r.db_last_synced_price) : null,
  dbErrorCode: r.db_error_code ?? null,
  ebayQtyAvailable: r.ebay_qty_available != null ? num(r.ebay_qty_available) : null,
  ebayPrice: r.ebay_price != null ? Number(r.ebay_price) : null,
  ebayTitle: r.ebay_title ?? null,
  browseChecked: Boolean(r.browse_checked),
  browseStatus: r.browse_status ?? null,
  browseQty: r.browse_qty != null ? num(r.browse_qty) : null,
  actionTaken: r.action_taken ?? null,
  actionAt: r.action_at ? new Date(r.action_at).toISOString() : null,
  actionBy: r.action_by ?? null,
});

export async function getReconciliationItems(p: ReconItemsParams): Promise<EbayReconItemsResponse> {
  const { where, values } = buildItemsWhere(p);
  const orderBy = buildOrderBy(p.sortBy, p.sortOrder);
  const offset = (p.page - 1) * p.limit;

  const countSql = `SELECT COUNT(*) AS total FROM jsa_ebay_reconciliation_results r WHERE ${where}`;
  const rowsSql = `SELECT ${SELECT_COLS} FROM jsa_ebay_reconciliation_results r WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe<{ total: unknown }[]>(countSql, ...values),
    prisma.$queryRawUnsafe<any[]>(rowsSql, ...values, p.limit, offset),
  ]);
  const total = num(countRows[0]?.total);
  return {
    runId: p.runId,
    rows: rows.map(rowToItem),
    total,
    page: p.page,
    totalPages: Math.max(1, Math.ceil(total / p.limit)),
  };
}

/** Keyset batches for the streaming CSV export — same WHERE as /items. */
export async function* iterateAllItems(
  p: Omit<ReconItemsParams, 'page' | 'limit'>,
): AsyncGenerator<EbayReconItem[]> {
  const { where, values } = buildItemsWhere(p);
  const batchSize = 5000;
  let lastId = 0;
  for (;;) {
    const sql = `SELECT ${SELECT_COLS} FROM jsa_ebay_reconciliation_results r WHERE ${where} AND r.id > ? ORDER BY r.id ASC LIMIT ?`;
    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...values, lastId, batchSize);
    if (rows.length === 0) return;
    lastId = num(rows[rows.length - 1].id);
    yield rows.map(rowToItem);
    if (rows.length < batchSize) return;
  }
}

const runToSummary = (run: any): EbayReconRunSummary => {
  let parsed: any = {};
  try {
    parsed = run.summaryJson ? JSON.parse(run.summaryJson) : {};
  } catch {
    parsed = {};
  }
  return {
    runId: run.id,
    status: run.status,
    triggerSource: run.triggerSource,
    triggeredBy: run.triggeredBy ?? null,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    pagesFetched: run.pagesFetched,
    listingsFetched: run.listingsFetched,
    variationsFetched: run.variationsFetched,
    errorMessage: run.errorMessage ?? null,
    categoryCounts: parsed.categoryCounts ?? {},
    browseChecked: parsed.browseChecked ?? 0,
    browseUnchecked: parsed.browseUnchecked ?? 0,
    oosControlAssumed: parsed.oosControlAssumed ?? true,
  };
};

export async function getReconciliationSummary(storeId: number): Promise<EbayReconSummaryResponse> {
  const runs = await prisma.ebaySnapshotRun.findMany({
    where: { storeId },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  const latestCompleted = runs.find((r) => r.status === 'completed') ?? null;
  const running = runs.find((r) => r.status === 'running') ?? null;
  return {
    latestRun: latestCompleted ? runToSummary(latestCompleted) : null,
    runningRun: running ? runToSummary(running) : null,
    previousRuns: runs
      .filter((r) => r.id !== latestCompleted?.id && r.status !== 'running')
      .slice(0, 14)
      .map(runToSummary),
  };
}
