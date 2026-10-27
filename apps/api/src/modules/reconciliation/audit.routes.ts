import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { redis } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import { runAudit } from './audit.service';
import { exportAuditCsv, exportAuditXlsx } from './audit.export';
import type { AuditReport, AuditOptions } from './audit.types';
import type { MarketplaceName } from './reconciliation.types';
import {
  REDIS_KEY_AUDIT_STATUS,
  REDIS_KEY_AUDIT_REPORT,
  REDIS_KEY_AUDIT_LOCK,
  AUDIT_STATUS_TTL,
  AUDIT_LOCK_TTL,
} from './reconciliation.utils';

const logger = createLogger('audit-routes');

// Zod schema for POST /run body
const auditRunSchema = z.object({
  marketplace: z.enum(['shopify', 'toffs', 'fruugo', 'debenhams']),
  storeIds: z.array(z.number().int()).optional(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
}).refine(
  (d) => new Date(d.toDate).getTime() - new Date(d.fromDate).getTime() <= 31 * 24 * 60 * 60 * 1000,
  { message: 'Date range must not exceed 31 days' }
).refine(
  (d) => new Date(d.fromDate) < new Date(d.toDate),
  { message: 'Start date must be before end date' }
);

const auditResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  filter: z.enum(['all', 'missing', 'unconverted', 'mismatch']).default('all'),
});

const auditExportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication
  app.addHook('preHandler', app.authenticate);

  // POST /api/reconciliation/audit/run - Trigger async audit report generation
  app.post<{
    Body: z.input<typeof auditRunSchema>;
  }>('/run', { preHandler: [app.requirePermission('reconciliation:create')] }, async (request, reply) => {
    // Try to acquire lock (SET NX EX)
    const acquired = await redis.set(REDIS_KEY_AUDIT_LOCK, '1', 'EX', AUDIT_LOCK_TTL, 'NX');
    if (!acquired) {
      return reply.status(409).send({
        error: {
          code: 'ALREADY_RUNNING',
          message: 'An audit report is already being generated',
        },
      });
    }

    // Parse and validate body
    const body = auditRunSchema.parse(request.body);

    const options: AuditOptions = {
      marketplace: body.marketplace as MarketplaceName,
      storeIds: body.storeIds,
      fromDate: new Date(body.fromDate),
      toDate: new Date(body.toDate),
    };

    const startedAt = new Date().toISOString();
    const triggeredBy = request.user?.email ?? 'unknown';

    // Set status to running
    await redis.set(
      REDIS_KEY_AUDIT_STATUS,
      JSON.stringify({ status: 'running', startedAt, triggeredBy }),
      'EX',
      AUDIT_STATUS_TTL
    );

    // Fire audit in background (not awaited)
    runAudit(options)
      .then(async ({ report, runId }) => {
        const completedAt = new Date().toISOString();

        // Update status to completed
        await redis.set(
          REDIS_KEY_AUDIT_STATUS,
          JSON.stringify({ status: 'completed', startedAt, completedAt, triggeredBy }),
          'EX',
          AUDIT_STATUS_TTL
        );

        // Release lock
        await redis.del(REDIS_KEY_AUDIT_LOCK);

        logger.info({ completedAt, triggeredBy, marketplace: options.marketplace }, 'Audit report completed via API');
      })
      .catch(async (error) => {
        const completedAt = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Update status to failed
        await redis.set(
          REDIS_KEY_AUDIT_STATUS,
          JSON.stringify({ status: 'failed', startedAt, completedAt, error: errorMessage, triggeredBy }),
          'EX',
          AUDIT_STATUS_TTL
        );

        // Release lock
        await redis.del(REDIS_KEY_AUDIT_LOCK);

        logger.error({ error: errorMessage, triggeredBy }, 'Audit report failed via API');
      });

    return reply.status(202).send({
      message: 'Audit report generation started',
      data: { status: 'running', startedAt, triggeredBy },
    });
  });

  // GET /api/reconciliation/audit/status - Current audit status
  app.get('/status', { preHandler: [app.requirePermission('reconciliation:view')] }, async () => {
    const raw = await redis.get(REDIS_KEY_AUDIT_STATUS);
    if (!raw) {
      return { data: { status: 'idle' } };
    }
    return { data: JSON.parse(raw) };
  });

  // GET /api/reconciliation/audit/results - Paginated audit results with filtering
  app.get<{
    Querystring: z.input<typeof auditResultsQuerySchema>;
  }>('/results', { preHandler: [app.requirePermission('reconciliation:view')] }, async (request, reply) => {
    const { page, pageSize, filter } = auditResultsQuerySchema.parse(request.query);

    // Get the full report from Redis
    const raw = await redis.get(REDIS_KEY_AUDIT_REPORT);
    if (!raw) {
      return reply.status(404).send({
        error: { code: 'NO_DATA', message: 'No audit report available' },
      });
    }

    const report = JSON.parse(raw) as AuditReport;

    // Apply filter
    let filteredOrders = report.orders;
    if (filter === 'missing') {
      filteredOrders = report.orders.filter((o) => o.flags.missingFromMo === true);
    } else if (filter === 'unconverted') {
      filteredOrders = report.orders.filter((o) => o.flags.unconverted === true);
    } else if (filter === 'mismatch') {
      filteredOrders = report.orders.filter((o) => o.flags.productCountMismatch === true);
    }

    // Paginate
    const start = (page - 1) * pageSize;
    const paginatedOrders = filteredOrders.slice(start, start + pageSize);

    return {
      data: {
        orders: paginatedOrders,
        summary: report.summary,
        generatedAt: report.generatedAt,
        marketplace: report.marketplace,
        fromDate: report.fromDate,
        toDate: report.toDate,
        pagination: {
          page,
          pageSize,
          totalItems: filteredOrders.length,
          totalPages: Math.ceil(filteredOrders.length / pageSize),
        },
        errors: report.errors,
      },
    };
  });

  // GET /api/reconciliation/audit/export - Export audit report as CSV or XLSX
  app.get<{
    Querystring: { format: string };
  }>('/export', { preHandler: [app.requirePermission('reconciliation:view')] }, async (request, reply) => {
    const { format } = auditExportQuerySchema.parse(request.query);

    // Get the full report from Redis
    const raw = await redis.get(REDIS_KEY_AUDIT_REPORT);
    if (!raw) {
      return reply.status(404).send({
        error: { code: 'NO_DATA', message: 'No audit report available' },
      });
    }

    const report = JSON.parse(raw) as AuditReport;
    const dateStr = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const buffer = exportAuditCsv(report);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="audit-${report.marketplace}-${dateStr}.csv"`)
        .send(buffer);
    }

    const buffer = exportAuditXlsx(report);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="audit-${report.marketplace}-${dateStr}.xlsx"`)
      .send(buffer);
  });
};
