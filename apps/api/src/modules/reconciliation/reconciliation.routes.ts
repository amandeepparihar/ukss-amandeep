import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as cronParser from 'cron-parser';
import { redis } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { runReconciliation } from './reconciliation.service';
import { ReconciliationLogCollector } from './reconciliation.log-collector';
import { exportReconciliationCsv, exportReconciliationXlsx } from './reconciliation.export';
import { auditRoutes } from './audit.routes';
import type { ReconcileOptions, MarketplaceName, ReconciliationReport } from './reconciliation.types';
import { config } from '../../config';
import { safeStringify } from './reconciliation.utils';
import { SHOPIFY_STORE_IDS } from './adapters/shopify.adapter';

const logger = createLogger('reconciliation-routes');

// Redis keys
const REDIS_KEY_STATUS = 'reconciliation:status';
const REDIS_KEY_LAST_RUN = 'reconciliation:last-run';
const REDIS_KEY_LOCK = 'reconciliation:lock';
const REDIS_KEY_CURRENT_RUN_ID = 'reconciliation:current-run-id';
const REDIS_KEY_CRON_SCHEDULE = 'reconciliation:cron-schedule';

// TTLs in seconds
const STATUS_TTL = 24 * 60 * 60; // 24h
const LAST_RUN_TTL = 7 * 24 * 60 * 60; // 7d
const LOCK_TTL = 10 * 60; // 10min
const LAST_RUN_PER_MP_TTL = 30 * 24 * 60 * 60; // 30d
const CURRENT_RUN_ID_TTL = 24 * 60 * 60; // 24h

// Zod schema for POST /run body
const runBodySchema = z.object({
  marketplace: z.enum(['shopify', 'toffs', 'fruugo', 'debenhams', 'all']).optional(),
  storeIds: z.array(z.number().int()).optional(),
  hours: z.number().int().min(1).max(720).optional(),
  stuckThreshold: z.number().int().min(1).max(168).optional(),
  unconvertedThreshold: z.number().int().min(1).max(168).optional(),
}).optional();

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']),
});

export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication
  app.addHook('preHandler', app.authenticate);

  // POST /api/reconciliation/run - Trigger async reconciliation
  app.post<{
    Body?: z.infer<typeof runBodySchema>;
  }>('/run', { preHandler: [app.requirePermission('reconciliation:create')] }, async (request, reply) => {
    // Try to acquire lock (SET NX EX)
    const acquired = await redis.set(REDIS_KEY_LOCK, '1', 'EX', LOCK_TTL, 'NX');
    if (!acquired) {
      return reply.status(409).send({
        error: {
          code: 'ALREADY_RUNNING',
          message: 'A reconciliation is already in progress',
        },
      });
    }

    // Parse optional body
    const body = runBodySchema.parse(request.body);

    const options: ReconcileOptions = {
      marketplace: (body?.marketplace as MarketplaceName | 'all') ?? 'all',
      storeIds: body?.storeIds,
      hours: body?.hours ?? 24,
      stuckThreshold: body?.stuckThreshold ?? 6,
      unconvertedThreshold: body?.unconvertedThreshold ?? 2,
      verbose: false,
      json: false,
      noEmail: true,
    };

    const startedAt = new Date().toISOString();
    const triggeredBy = request.user?.email ?? 'unknown';

    // Set status to running
    await redis.set(
      REDIS_KEY_STATUS,
      JSON.stringify({ status: 'running', startedAt, triggeredBy }),
      'EX',
      STATUS_TTL
    );

    // Fire reconciliation in background (not awaited)
    runReconciliation(options)
      .then(async ({ report, runId }) => {
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        // Store current runId for log retrieval
        await redis.set(REDIS_KEY_CURRENT_RUN_ID, runId, 'EX', CURRENT_RUN_ID_TTL);

        // Store last run report (global)
        await redis.set(
          REDIS_KEY_LAST_RUN,
          safeStringify({
            report,
            metadata: {
              triggeredBy,
              triggeredAt: startedAt,
              completedAt,
              durationMs,
              source: 'api',
              runId,
            },
          }),
          'EX',
          LAST_RUN_TTL
        );

        // Store per-marketplace last-run data
        for (const result of report.results) {
          const mpKey = `reconciliation:last-run:${result.marketplace.toLowerCase()}`;
          const issueCount =
            (result.missingOrders?.missingOrders.length ?? 0) +
            (result.missingProducts?.mismatches.length ?? 0) +
            result.statusSync.stuckStatuses.length +
            result.unconvertedOrders.unconvertedOrders.length;

          await redis.set(
            mpKey,
            JSON.stringify({
              timestamp: completedAt,
              triggeredBy,
              durationMs,
              issueCount,
            }),
            'EX',
            LAST_RUN_PER_MP_TTL
          );
        }

        // Update status to completed
        await redis.set(
          REDIS_KEY_STATUS,
          JSON.stringify({ status: 'completed', startedAt, completedAt, triggeredBy }),
          'EX',
          STATUS_TTL
        );

        // Release lock
        await redis.del(REDIS_KEY_LOCK);

        logger.info({ durationMs, triggeredBy, runId }, 'Reconciliation completed via API');
      })
      .catch(async (error) => {
        const completedAt = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Update status to failed
        await redis.set(
          REDIS_KEY_STATUS,
          JSON.stringify({ status: 'failed', startedAt, completedAt, error: errorMessage, triggeredBy }),
          'EX',
          STATUS_TTL
        );

        // Release lock
        await redis.del(REDIS_KEY_LOCK);

        logger.error({ error: errorMessage, triggeredBy }, 'Reconciliation failed via API');
      });

    return reply.status(202).send({
      message: 'Reconciliation started',
      data: { status: 'running', startedAt, triggeredBy },
    });
  });

  // GET /api/reconciliation/status - Current status
  app.get('/status', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    const raw = await redis.get(REDIS_KEY_STATUS);
    if (!raw) {
      return { data: { status: 'idle' } };
    }
    return { data: JSON.parse(raw) };
  });

  // GET /api/reconciliation/last-run - Full last run report
  app.get('/last-run', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    const raw = await redis.get(REDIS_KEY_LAST_RUN);
    if (!raw) {
      return { data: null };
    }
    return { data: JSON.parse(raw) };
  });

  // GET /api/reconciliation/stores - Active stores for run dialog
  app.get('/stores', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    // Fetch active Shopify stores
    const shopifyStores = await prisma.storeManagement.findMany({
      where: {
        storeId: { in: SHOPIFY_STORE_IDS },
        status: '1',
        storePlatform: 'Shopify',
      },
      select: {
        storeId: true,
        storeName: true,
        storeOrderIntegrationApiHostname: true,
      },
      orderBy: { storeName: 'asc' },
    });

    return {
      data: [
        {
          marketplace: 'shopify',
          stores: shopifyStores.map(s => ({
            storeId: s.storeId,
            storeName: s.storeName,
            shopDomain: s.storeOrderIntegrationApiHostname ?? undefined,
          })),
        },
        {
          marketplace: 'toffs',
          stores: config.TOFFS_STORE_ID
            ? [{ storeId: config.TOFFS_STORE_ID, storeName: config.TOFFS_STORE_NAME }]
            : [],
        },
        {
          marketplace: 'fruugo',
          stores: config.FRUUGO_STORE_ID
            ? [{ storeId: config.FRUUGO_STORE_ID, storeName: 'Fruugo' }]
            : [],
        },
        {
          marketplace: 'debenhams',
          stores: [{ storeId: config.DEBENHAMS_STORE_ID, storeName: config.DEBENHAMS_STORE_NAME }],
        },
      ],
    };
  });

  // GET /api/reconciliation/logs - Execution logs for current/last run
  app.get('/logs', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    try {
      const runId = await redis.get(REDIS_KEY_CURRENT_RUN_ID);
      if (!runId) {
        return { data: { runId: null, logs: [] } };
      }
      const logs = await ReconciliationLogCollector.getAll(runId);
      return { data: { runId, logs } };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch reconciliation logs');
      return { data: { runId: null, logs: [] } };
    }
  });

  // GET /api/reconciliation/schedule - Per-marketplace last run + next scheduled
  app.get('/schedule', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    const marketplaces = ['shopify', 'toffs', 'fruugo', 'debenhams'];

    let cronSchedule: Record<string, { cronExpression: string; lastRun?: string }> | null = null;
    try {
      const raw = await redis.get(REDIS_KEY_CRON_SCHEDULE);
      if (raw) cronSchedule = JSON.parse(raw);
    } catch {
      // Ignore parse errors
    }

    const results = await Promise.all(
      marketplaces.map(async (name) => {
        // Last run data
        let lastRun: { timestamp: string; triggeredBy: string; durationMs: number; issueCount: number } | null = null;
        try {
          const raw = await redis.get(`reconciliation:last-run:${name}`);
          if (raw) lastRun = JSON.parse(raw);
        } catch {
          // Ignore
        }

        // Next scheduled run
        let nextScheduledRun: string | null = null;
        if (cronSchedule?.[name]?.cronExpression) {
          try {
            const interval = cronParser.parseExpression(cronSchedule[name].cronExpression);
            nextScheduledRun = interval.next().toISOString();
          } catch {
            // Invalid cron expression
          }
        }

        return {
          name,
          lastRun,
          nextScheduledRun,
        };
      })
    );

    return { data: { marketplaces: results } };
  });

  // GET /api/reconciliation/export - Export reconciliation results
  app.get<{
    Querystring: { format: string };
  }>('/export', { preHandler: [app.requirePermission('reconciliation:view')] }, async (request, reply) => {
    const { format } = exportQuerySchema.parse(request.query);

    // Get the last run report
    const raw = await redis.get(REDIS_KEY_LAST_RUN);
    if (!raw) {
      return reply.status(404).send({
        error: { code: 'NO_DATA', message: 'No reconciliation report available' },
      });
    }

    const { report } = JSON.parse(raw) as { report: ReconciliationReport };
    const dateStr = new Date().toISOString().split('T')[0];
    const marketplace = report.results.length === 1
      ? report.results[0].marketplace.toLowerCase()
      : 'all';

    if (format === 'csv') {
      const buffer = exportReconciliationCsv(report);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="reconciliation-${marketplace}-${dateStr}.csv"`)
        .send(buffer);
    }

    const buffer = exportReconciliationXlsx(report);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="reconciliation-${marketplace}-${dateStr}.xlsx"`)
      .send(buffer);
  });

  // Register audit report routes under /audit prefix
  app.register(auditRoutes, { prefix: '/audit' });
};
