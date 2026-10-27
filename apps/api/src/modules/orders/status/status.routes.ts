/**
 * Status management routes — order status transitions, history, templates, touchpoints.
 * Requirements: REQ-07-001, REQ-07-018, REQ-07-023, REQ-07-025
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  OrderIdParamSchema,
  StatusUpdateSchema,
  TouchpointSchema,
} from '../orders.schema';
import { sharedSessionService } from '../../auth/shared-session.instance';
import {
  updateOrderStatus,
  getStatusHistory,
  getStatusTemplates,
  getTemplateById,
  setTouchpoint,
} from './status.service';

export const statusRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // REQ-07-001: Status Update Handler
  // POST /api/orders/:id/status
  // -------------------------------------------------------------------------

  app.post('/:id/status', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const body = StatusUpdateSchema.parse(request.body);

    // Resolve admin name from shared session for audit log
    let adminName = 'Unknown';
    const sharedToken = request.cookies.shared_admin_session;
    if (sharedToken) {
      const session = await sharedSessionService.validateSession(sharedToken);
      if (session?.userEmail) {
        adminName = session.userEmail;
      }
    }
    // Fallback to JWT user email if shared session not available
    if (adminName === 'Unknown') {
      const user = request.user as { email?: string } | undefined;
      if (user?.email) adminName = user.email;
    }

    // REQ-07-011: Reject requires reject permission
    if (body.status === 112) {
      const { getOrderFeaturePermissions } = await import('../orders.permissions');
      let phpAdminId = 0;
      if (sharedToken) {
        const session = await sharedSessionService.validateSession(sharedToken);
        if (session?.phpUserId) phpAdminId = session.phpUserId;
      }
      const perms = await getOrderFeaturePermissions(phpAdminId);
      if (!perms.rejectPermission) {
        return reply.status(403).send({
          status: 'error',
          message: 'You do not have permission to reject orders',
        });
      }
    }

    const result = await updateOrderStatus({
      orderId,
      newStatus: body.status,
      previousOrderStatus: body.previousOrderStatus,
      comments: body.comments,
      notify: body.notify,
      notifyComments: body.notifyComments,
      privateComment: body.privateComment,
      useOriginalEmail: body.useOriginalEmail,
      sendMessageAutomatically: body.sendMessageAutomatically,
      pageForLog: body.pageForLog,
      adminName,
    });

    if (!result.success) {
      return reply.status(400).send({
        status: 'error',
        message: result.message,
      });
    }

    return {
      status: 'success',
      message: result.message,
      data: {
        statusChanged: result.statusChanged,
        historyInserted: result.historyInserted,
        marketplaceErrors: result.marketplaceErrors,
      },
    };
  });

  // -------------------------------------------------------------------------
  // REQ-07-018: Status History
  // GET /api/orders/:id/status-history
  // -------------------------------------------------------------------------

  app.get('/:id/status-history', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const history = await getStatusHistory(orderId);

    return {
      data: history.map((row) => ({
        id: row.orders_status_history_id,
        orderId: row.orders_id,
        statusId: row.orders_status_id,
        statusName: row.orders_status_name ?? `Status ${row.orders_status_id}`,
        dateAdded: row.date_added instanceof Date
          ? row.date_added.toISOString()
          : String(row.date_added),
        customerNotified: row.customer_notified === 1,
        comments: row.comments || '',
        commentBy: row.comment_by,
        commentPrivate: row.comment_private,
        statusChangeFrom: row.status_change_from,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // REQ-07-023: Predefined Comment Templates
  // GET /api/orders/templates
  // -------------------------------------------------------------------------

  app.get('/templates', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const query = z.object({
      type: z.enum(['0', '1']).default('0'),
    }).parse(request.query);

    const templates = await getStatusTemplates(query.type);

    return {
      data: templates.map((t) => ({
        id: t.id,
        title: t.title,
        content: t.content,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // REQ-07-023: Single Template by ID
  // GET /api/orders/templates/:templateId
  // -------------------------------------------------------------------------

  app.get('/templates/:templateId', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    const { templateId } = z.object({
      templateId: z.coerce.number().int().positive(),
    }).parse(request.params);

    const template = await getTemplateById(templateId);
    if (!template) {
      return reply.status(404).send({
        status: 'error',
        message: 'Template not found',
      });
    }

    return {
      data: {
        id: template.id,
        title: template.title,
        content: template.content,
      },
    };
  });

  // -------------------------------------------------------------------------
  // REQ-07-025: Touchpoint Counter
  // POST /api/orders/:id/touchpoint
  // Mirrors PHP orders.php 'touchpoint' action: SET touchpoints = :touchpoint
  // where :touchpoint is the absolute value from the request body.
  // -------------------------------------------------------------------------

  app.post('/:id/touchpoint', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const { touchpoints } = TouchpointSchema.parse(request.body);

    await setTouchpoint(orderId, touchpoints);

    return {
      status: 'success',
      message: 'Touchpoint updated',
      data: { orderId, touchpoints },
    };
  });
};
