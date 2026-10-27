/**
 * Notification routes — email queue monitoring, query templates,
 * inter-admin queries, and store config lookup.
 *
 * Requirements: REQ-08-001, REQ-08-008, REQ-08-011, REQ-08-013
 */

import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { OrderIdParamSchema } from '../orders.schema';
import { toIso } from '../orders.helpers';
import { resolveStoreBrand, processEmailQueue } from './notifications.service';
import {
  getQueryTemplates,
  getAdminUsers,
  resolveAdminById,
  createOrderQuery,
  getOrderQueries,
} from './notifications.queries';

// ---------------------------------------------------------------------------
// Zod schemas for notification endpoints
// ---------------------------------------------------------------------------

const CreateQuerySchema = z.object({
  queryTo: z.coerce.number().int().positive(),
  queryContent: z.string().min(1).max(65535),
  isTemplate: z.boolean().default(false),
  templateName: z.string().max(700).default(''),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // REQ-08-001: Store brand config for an order
  // GET /api/orders/:id/store-config
  // -------------------------------------------------------------------------

  app.get('/:id/store-config', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);

    // Fetch order_site for this order
    const rows = await prisma.$queryRaw<{ order_site: number }[]>(
      Prisma.sql`SELECT order_site FROM orders WHERE orders_id = ${orderId} LIMIT 1`
    );

    if (rows.length === 0) {
      return { data: null };
    }

    const storeBrand = await resolveStoreBrand(rows[0].order_site);

    return {
      data: {
        storeId: storeBrand.storeId,
        storeName: storeBrand.storeName,
        storeEmail: storeBrand.storeEmail,
        storeUrl: storeBrand.storeUrl,
        storeLogo: storeBrand.storeLogo,
      },
    };
  });

  // -------------------------------------------------------------------------
  // REQ-08-008: Process email queue (admin/cron endpoint)
  // POST /api/orders/notifications/process-queue
  // -------------------------------------------------------------------------

  app.post('/notifications/process-queue', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async () => {
    const result = await processEmailQueue();

    return {
      status: 'success',
      message: `Processed ${result.processed} emails: ${result.succeeded} sent, ${result.failed} failed`,
      data: result,
    };
  });

  // -------------------------------------------------------------------------
  // REQ-08-011: Query templates
  // GET /api/orders/query-templates
  // -------------------------------------------------------------------------

  app.get('/query-templates', {
    preHandler: [app.requirePermission('orders:view')],
  }, async () => {
    const templates = await getQueryTemplates();

    return {
      data: templates.map((t) => ({
        id: t.query_id,
        name: t.template_name,
        content: t.query_content,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // REQ-08-013: Admin users for query recipient dropdown
  // GET /api/orders/query-admins
  // -------------------------------------------------------------------------

  app.get('/query-admins', {
    preHandler: [app.requirePermission('orders:view')],
  }, async () => {
    const admins = await getAdminUsers();

    return {
      data: admins.map((a) => ({
        id: a.admin_id,
        name: a.admin_name,
        email: a.admin_email,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // REQ-08-013: Submit inter-admin query
  // POST /api/orders/:id/queries
  // -------------------------------------------------------------------------

  app.post('/:id/queries', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const body = CreateQuerySchema.parse(request.body);

    // Resolve current admin name from session
    let adminName = 'Unknown';
    const user = request.user as { email?: string } | undefined;
    if (user?.email) adminName = user.email;

    // Resolve recipient admin_id → admin_name (PHP: get_all_admin resolves IDs to names)
    const recipientAdmin = await resolveAdminById(body.queryTo);
    if (!recipientAdmin) {
      return { status: 'error', message: 'Recipient admin not found' };
    }

    const result = await createOrderQuery({
      orderId,
      queryFrom: adminName,
      queryTo: recipientAdmin.admin_name,
      queryToEmail: recipientAdmin.admin_email,
      queryContent: body.queryContent,
      isTemplate: body.isTemplate,
      templateName: body.templateName,
    });

    return {
      status: 'success',
      message: result.emailSent
        ? 'Query sent and email notification delivered'
        : 'Query saved (email notification skipped)',
      data: { queryId: result.queryId },
    };
  });

  // -------------------------------------------------------------------------
  // REQ-08-013: Query history for an order
  // GET /api/orders/:id/queries
  // -------------------------------------------------------------------------

  app.get('/:id/queries', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const queries = await getOrderQueries(orderId);

    return {
      data: queries.map((q) => ({
        id: q.query_id,
        from: q.query_from,
        to: q.query_to,
        content: q.query_content,
        orderId: q.order_id,
        dateAdded: toIso(q.date_added) || '',
      })),
    };
  });
};
