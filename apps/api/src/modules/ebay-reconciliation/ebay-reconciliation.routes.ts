/**
 * eBay Reconciliation Dashboard API (spec §7).
 * Reads require reports:view; POSTs (refresh + actions) require marketplace-sync:reconcile.
 * Responses wrapped { data: ... } per repo convention.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { EBAY_RECON_CATEGORIES } from '@admin/shared';
import {
  getReconciliationItems,
  getReconciliationSummary,
  iterateAllItems,
} from './ebay-reconciliation.query';
import {
  getLatestCompletedRunId,
  SnapshotRunInProgressError,
  insertActionLog,
  markResultsActioned,
} from './ebay-reconciliation.db';
import { startEbaySnapshotAsync } from './ebay-snapshot.service';
import {
  reactivateVerifiedItems,
  relistGhostItems,
  markGoneItems,
  verifyOversellItems,
} from './ebay-reconciliation.service';

/** "a,b" | ["a","b"] | undefined -> validated string[] | undefined */
const csvArray = (allowed: readonly string[]) =>
  z.preprocess(
    (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').filter(Boolean)),
    z.array(z.enum(allowed as [string, ...string[]])).optional(),
  );

const itemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  category: csvArray(EBAY_RECON_CATEGORIES),
  browseStatus: csvArray(['IN_STOCK', 'OUT_OF_STOCK', 'LIMITED_STOCK'] as const),
  search: z.string().max(100).optional(),
  runId: z.coerce.number().int().positive().optional(),
});

const exportQuerySchema = itemsQuerySchema.omit({ page: true, limit: true });

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function requesterEmail(request: FastifyRequest): string {
  const user = request.user as { email?: string } | undefined;
  return user?.email ?? 'unknown';
}

export const ebayReconciliationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/summary', { preHandler: [app.requirePermission('reports', 'view')] }, async () => ({
    data: await getReconciliationSummary(config.EBAY_STORE_ID),
  }));

  app.get('/items', { preHandler: [app.requirePermission('reports', 'view')] }, async (request, reply) => {
    const parsed = itemsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const q = parsed.data;
    const runId = q.runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (runId === null) return reply.code(404).send({ error: 'No completed reconciliation run yet — trigger a snapshot first' });
    return {
      data: await getReconciliationItems({
        runId,
        page: q.page,
        limit: q.limit,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
        categories: q.category,
        browseStatus: q.browseStatus,
        search: q.search,
      }),
    };
  });

  app.get('/items/export', { preHandler: [app.requirePermission('reports', 'view')] }, async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const q = parsed.data;
    const runId = q.runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (runId === null) return reply.code(404).send({ error: 'No completed reconciliation run yet' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ebay-reconciliation-run-${runId}.csv"`,
    });
    reply.raw.write(
      'item_id,sku,category,db_status,db_qty,db_price,db_error_code,ebay_qty,ebay_price,ebay_title,browse_checked,browse_status,browse_qty,action_taken,action_at,action_by\n',
    );
    for await (const batch of iterateAllItems({
      runId,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      categories: q.category,
      browseStatus: q.browseStatus,
      search: q.search,
    })) {
      const lines = batch
        .map((r) =>
          [
            r.itemId, r.sku, r.category, r.dbListingStatus, r.dbLastSyncedQty, r.dbLastSyncedPrice,
            r.dbErrorCode, r.ebayQtyAvailable, r.ebayPrice, r.ebayTitle, r.browseChecked,
            r.browseStatus, r.browseQty, r.actionTaken, r.actionAt, r.actionBy,
          ]
            .map(csvEscape)
            .join(','),
        )
        .join('\n');
      reply.raw.write(lines + '\n');
    }
    reply.raw.end();
    return reply;
  });

  app.post('/refresh', { preHandler: [app.requirePermission('marketplace-sync', 'reconcile')] }, async (request, reply) => {
    try {
      const runId = await startEbaySnapshotAsync(config.EBAY_STORE_ID, requesterEmail(request));
      return { data: { runId } };
    } catch (error) {
      if (error instanceof SnapshotRunInProgressError) {
        return reply.code(409).send({ error: 'A snapshot run is already in progress', runId: error.runId });
      }
      throw error;
    }
  });

  // ---------- Actions (spec §7): dry-run default, audited, verify-first ----------
  const actionBodySchema = z.object({
    itemIds: z.array(z.string().min(3).max(20)).min(1).max(500),
    dryRun: z.boolean().default(true),
    runId: z.coerce.number().int().positive().optional(),
  });

  type ActionName = 'reactivate' | 'relist' | 'mark_gone' | 'verify_oversell';
  const registerAction = (
    path: string,
    action: ActionName,
    exec: (args: { itemIds: string[]; dryRun: boolean; runId: number | null }) => Promise<import('@admin/shared').EbayReconActionOutcome[]>,
  ) => {
    app.post(path, { preHandler: [app.requirePermission('marketplace-sync', 'reconcile')] }, async (request, reply) => {
      const parsed = actionBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const { itemIds, dryRun } = parsed.data;
      const runId = parsed.data.runId ?? null;
      const requestedBy = requesterEmail(request);
      try {
        const outcomes = await exec({ itemIds, dryRun, runId });
        await insertActionLog({ runId, action, itemIds, dryRun, requestedBy, outcomeJson: JSON.stringify(outcomes), status: 'completed' });
        if (!dryRun && runId !== null) await markResultsActioned(runId, itemIds, action, requestedBy);
        return { data: { action, dryRun, requested: itemIds.length, outcomes } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await insertActionLog({ runId, action, itemIds, dryRun, requestedBy, outcomeJson: JSON.stringify({ error: message }), status: 'failed' });
        throw error;
      }
    });
  };

  registerAction('/actions/reactivate', 'reactivate', ({ itemIds, dryRun }) =>
    reactivateVerifiedItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun }));

  registerAction('/actions/relist', 'relist', ({ itemIds, dryRun }) =>
    relistGhostItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun }));

  registerAction('/actions/mark-gone', 'mark_gone', ({ itemIds, dryRun, runId }) =>
    markGoneItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun, runId }));

  registerAction('/actions/verify-oversell', 'verify_oversell', async ({ itemIds, runId }) => {
    const effectiveRunId = runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (effectiveRunId === null) return [];
    return verifyOversellItems({ storeId: config.EBAY_STORE_ID, runId: effectiveRunId, itemIds });
  });
};
