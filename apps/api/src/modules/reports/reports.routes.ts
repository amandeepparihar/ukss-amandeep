import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Readable } from 'stream';
import { reportsService, ReportFormat } from './reports.service';
import { createLogger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  buildBreakdownQuery, buildDailyTrendQuery, buildHourlyByChannelQuery, previousRange,
  defaultRange, type MarketplaceSalesParams,
} from './marketplace-sales.query';
import { getMarketplaceSyncPerformance, resetFailedMarketplaceListings } from './marketplace-sync.query';
import { getShopifySyncPerformance } from './shopify-sync.query';
import { getShopifySyncFailures, streamShopifySyncFailuresCsv } from './shopify-sync.failures';

const logger = createLogger('reports-routes');

// ── Dropdown helpers (exported for unit testing) ──────────────────────────────
// Read the shared MySQL master tables via the Prisma MySQL client (same
// connection the orders module uses) — no separate driver/connection pool.

export interface DropdownRow { id: number | string; name: string }

export async function fetchOrderStatuses(): Promise<DropdownRow[]> {
  const rows = await prisma.$queryRawUnsafe<DropdownRow[]>(
    `SELECT orders_status_id AS id, orders_status_name AS name
       FROM orders_status WHERE language_id = 1`
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchMarketplaces(): Promise<DropdownRow[]> {
  const rows = await prisma.$queryRawUnsafe<DropdownRow[]>(
    `SELECT store_id AS id, store_name AS name FROM store_management`
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Marketplace-sales exported helper ────────────────────────────────────────

export interface MsBreakdownRow {
  orderSite: string; channel: string; orders: number; revenue: number; aov: number;
  sharePercent: number; vsPrevPercent: number | null;
}
export interface MsDailyRow { day: string; orderSite: string; orders: number }
export interface MsHourlyRow { orderSite: string; hour: number; ordersAvg: number }

const num = (v: unknown) => Number((v as number | bigint | string) ?? 0);

export async function getMarketplaceSales(p: MarketplaceSalesParams): Promise<{
  breakdown: MsBreakdownRow[]; dailyTrend: MsDailyRow[]; hourly: MsHourlyRow[];
}> {
  const def = defaultRange();
  const dateFrom = p.dateFrom || def.from;
  const dateTo = p.dateTo || def.to;
  const rp = { ...p, dateFrom, dateTo };

  const bq = buildBreakdownQuery(rp);
  const curr = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(bq.sql, ...bq.values);

  const prev = previousRange(dateFrom, dateTo);
  const pbq = buildBreakdownQuery({ ...rp, dateFrom: prev.from, dateTo: prev.to });
  const prevRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(pbq.sql, ...pbq.values);
  const prevRevBySite = new Map(prevRows.map((r) => [String(r.order_site), num(r.revenue)]));

  const totalRevenue = curr.reduce((s, r) => s + num(r.revenue), 0) || 1;
  const breakdown: MsBreakdownRow[] = curr.map((r) => {
    const revenue = num(r.revenue);
    const prevRev = prevRevBySite.get(String(r.order_site));
    return {
      orderSite: String(r.order_site),
      channel: String(r.channel),
      orders: num(r.orders),
      revenue,
      aov: num(r.aov),
      sharePercent: Math.round((revenue / totalRevenue) * 1000) / 10,
      vsPrevPercent: prevRev && prevRev > 0 ? Math.round(((revenue - prevRev) / prevRev) * 1000) / 10 : null,
    };
  });

  const dq = buildDailyTrendQuery(rp);
  const dRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(dq.sql, ...dq.values);
  const dailyTrend: MsDailyRow[] = dRows.map((r) => ({
    day: String(r.day), orderSite: String(r.order_site), orders: num(r.orders),
  }));

  // days in the requested range (inclusive) — used to average hourly totals
  const distinctDays = Math.round((new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86400000) + 1;
  const hq = buildHourlyByChannelQuery(rp);
  const hRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(hq.sql, ...hq.values);
  const hourly: MsHourlyRow[] = hRows.map((r) => ({
    orderSite: String(r.order_site),
    hour: num(r.hour),
    ordersAvg: Math.round((num(r.orders) / distinctDays) * 10) / 10,
  }));

  return { breakdown, dailyTrend, hourly };
}

// Validation schemas
const shopifySyncQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
});

const shopifyFailuresQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['lastSeen', 'sku', 'productStatus']).default('lastSeen'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).default('json'),
});

const generateReportSchema = z.object({
  reportId: z.string().min(1),
  format: z.enum(['csv', 'json', 'excel']),
  params: z.record(z.unknown()).optional(),
});

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication and appropriate permissions
  app.addHook('preHandler', app.authenticate);

  // GET /api/reports - List available reports
  app.get('/', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async () => {
    const reports = reportsService.getReports();
    return { data: reports };
  });

  // GET /api/reports/stats - Get report statistics
  app.get('/stats', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async () => {
    const stats = await reportsService.getStats();
    return { data: stats };
  });

  // GET /api/reports/:reportId - Get report definition
  app.get<{
    Params: { reportId: string };
  }>('/:reportId', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const report = reportsService.getReport(request.params.reportId);

    if (!report) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    return { data: report };
  });

  // POST /api/reports/:reportId/preview - Preview report data (limited)
  app.post<{
    Params: { reportId: string };
    Body: { params?: Record<string, unknown> };
  }>('/:reportId/preview', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const { reportId } = request.params;
    const { params } = request.body || {};

    try {
      const result = await reportsService.generate({
        reportId,
        format: 'json',
        params,
        userId: request.user.id,
      });

      // Return limited preview (first 100 rows)
      return {
        data: {
          report: result.report,
          generatedAt: result.generatedAt,
          totalRows: result.data.length,
          preview: result.data.slice(0, 100),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate report';
      return reply.status(400).send({
        error: { code: 'REPORT_ERROR', message },
      });
    }
  });

  // POST /api/reports/:reportId/generate - Generate and download report
  app.post<{
    Params: { reportId: string };
    Body: z.infer<typeof generateReportSchema>;
  }>('/:reportId/generate', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const { reportId } = request.params;
    const input = generateReportSchema.parse({ ...request.body, reportId });

    const report = reportsService.getReport(reportId);
    if (!report) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    try {
      // Log the report generation
      await prisma.auditLog.create({
        data: {
          userId: request.user.id,
          action: 'generate',
          resource: 'report',
          resourceId: reportId,
          metadata: {
            format: input.format,
            params: input.params,
            ip: request.ip,
          },
        },
      });

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${report.name.replace(/\s+/g, '-').toLowerCase()}_${timestamp}`;

      switch (input.format) {
        case 'csv': {
          const stream = await reportsService.generateCSV({
            reportId,
            format: 'csv',
            params: input.params,
            userId: request.user.id,
          });

          reply.header('Content-Type', 'text/csv');
          reply.header('Content-Disposition', `attachment; filename="${filename}.csv"`);
          return reply.send(stream);
        }

        case 'json': {
          const result = await reportsService.generateJSON({
            reportId,
            format: 'json',
            params: input.params,
            userId: request.user.id,
          });

          reply.header('Content-Type', 'application/json');
          reply.header('Content-Disposition', `attachment; filename="${filename}.json"`);
          return result;
        }

        case 'excel': {
          // For Excel, we'll return JSON with instructions to use ExcelJS on client
          // Or implement server-side Excel generation with ExcelJS package
          const result = await reportsService.generate({
            reportId,
            format: 'excel',
            params: input.params,
            userId: request.user.id,
          });

          // Simple Excel-compatible CSV with UTF-8 BOM for Excel
          const BOM = '\uFEFF';
          const header = result.report.columns.map(c => `"${c.label}"`).join('\t');
          const rows = result.data.map(row =>
            result.report.columns.map(col => {
              const value = row[col.key];
              if (value === null || value === undefined) return '';
              if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
              if (value instanceof Date) return value.toISOString();
              return String(value);
            }).join('\t')
          ).join('\n');

          const content = BOM + header + '\n' + rows;

          reply.header('Content-Type', 'application/vnd.ms-excel');
          reply.header('Content-Disposition', `attachment; filename="${filename}.xls"`);
          return content;
        }

        default:
          return reply.status(400).send({
            error: { code: 'INVALID_FORMAT', message: 'Unsupported format' },
          });
      }
    } catch (error) {
      logger.error({ error, reportId }, 'Report generation failed');
      const message = error instanceof Error ? error.message : 'Failed to generate report';
      return reply.status(500).send({
        error: { code: 'REPORT_ERROR', message },
      });
    }
  });

  // GET /api/reports/data-sources - List available data sources
  app.get('/data-sources', {
    preHandler: [app.requirePermission('settings', 'view')],
  }, async () => {
    const stats = await reportsService.getStats();
    return { data: stats.availableDataSources };
  });

  // GET /api/reports/order-statuses - Dropdown: order statuses from DB
  app.get('/order-statuses', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async () => ({ data: await fetchOrderStatuses() }));

  // GET /api/reports/marketplaces - Dropdown: marketplaces/stores from DB
  app.get('/marketplaces', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async () => ({ data: await fetchMarketplaces() }));

  // POST /api/reports/marketplace-sales - Composite data endpoint
  app.post<{ Body: { params?: MarketplaceSalesParams } }>('/marketplace-sales', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request) => ({ data: await getMarketplaceSales(request.body?.params ?? {}) }));

  // POST /api/reports/marketplace-sales/export - CSV stream of breakdown
  app.post<{ Body: { params?: MarketplaceSalesParams } }>('/marketplace-sales/export', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const { breakdown } = await getMarketplaceSales(request.body?.params ?? {});
    const stream = new Readable({ read() {} });
    stream.push('"Channel","Orders","Revenue","AOV","% Share","vs Prev %"\n');
    for (const r of breakdown) {
      stream.push(`"${r.channel.replace(/"/g, '""')}",${r.orders},${r.revenue},${r.aov},${r.sharePercent},${r.vsPrevPercent ?? ''}\n`);
    }
    stream.push(null);
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="marketplace-sales.csv"');
    return reply.send(stream);
  });

  // GET /api/reports/marketplace-sync-performance - Live marketplace sync health
  // & daily-sync activity, read straight from marketplace_listings. No params:
  // the BA refreshes manually. generatedAt is stamped per request.
  app.get('/marketplace-sync-performance', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async () => ({
    data: await getMarketplaceSyncPerformance(new Date().toISOString()),
  }));

  // POST /api/reports/marketplace-sync-performance/:storeId/reset-failed
  // Resets failed marketplace listings for one marketplace so the next sync can retry them.
  app.post<{ Params: { storeId: string } }>('/marketplace-sync-performance/:storeId/reset-failed', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const storeId = Number(request.params.storeId);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return reply.code(400).send({ error: 'Invalid storeId' });
    }

    return {
      data: await resetFailedMarketplaceListings(storeId),
    };
  });

  // GET /api/reports/shopify-sync-performance - Shopify sync health over the
  // shopify_tracking_history event log. windowHours 1..168 (default 24).
  app.get('/shopify-sync-performance', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const parsed = shopifySyncQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid windowHours' });
    return {
      data: await getShopifySyncPerformance(new Date().toISOString(), parsed.data.windowHours),
    };
  });

  // GET /api/reports/shopify-sync-performance/:storeId/failures - drill-down list
  // of failing products for one store (paginated JSON, or ?format=csv stream).
  app.get<{ Params: { storeId: string } }>('/shopify-sync-performance/:storeId/failures', {
    preHandler: [app.requirePermission('reports', 'view')],
  }, async (request, reply) => {
    const storeId = Number(request.params.storeId);
    if (!Number.isInteger(storeId) || storeId <= 0) return reply.code(400).send({ error: 'Invalid storeId' });
    const parsed = shopifyFailuresQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query' });
    const { windowHours, page, pageSize, sort, dir, format } = parsed.data;

    if (format === 'csv') {
      const stream = await streamShopifySyncFailuresCsv({ storeId, windowHours });
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="shopify-sync-failures-${storeId}.csv"`);
      return reply.send(stream);
    }
    return { data: await getShopifySyncFailures({ storeId, windowHours, page, pageSize, sort, dir }) };
  });
};
