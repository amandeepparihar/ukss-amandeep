import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notificationsService } from './notifications.service';
import { NotificationChannel } from '@prisma/client';
import { createLogger } from '../../lib/logger';

const logger = createLogger('notifications-routes');

// Validation schemas
const sendNotificationSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  templateCode: z.string().optional(),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP']),
  subject: z.string().optional(),
  content: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  scheduledFor: z.string().datetime().optional(),
  priority: z.number().min(1).max(10).optional(),
});

const sendBulkSchema = z.object({
  userIds: z.array(z.string()).min(1),
  templateCode: z.string(),
  variables: z.record(z.unknown()).optional(),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'])).optional(),
});

const updatePreferencesSchema = z.object({
  channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP']),
  enabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  timezone: z.string().nullable().optional(),
});

const upsertTemplateSchema = z.object({
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
  channels: z.array(z.object({
    channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP']),
    subject: z.string().optional(),
    content: z.string().min(1),
  })).min(1),
});

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // ===== Admin Endpoints =====

  // GET /api/notifications/stats - Get notification statistics
  app.get('/stats', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'view')],
  }, async () => {
    const stats = await notificationsService.getStats();
    return { data: stats };
  });

  // GET /api/notifications/templates - Get all templates
  app.get('/templates', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'view')],
  }, async () => {
    const templates = await notificationsService.getTemplates();
    return { data: templates };
  });

  // POST /api/notifications/templates - Create/update template
  app.post<{
    Body: z.infer<typeof upsertTemplateSchema>;
  }>('/templates', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request, reply) => {
    const { code, ...data } = upsertTemplateSchema.parse(request.body);

    const template = await notificationsService.upsertTemplate(code, data);

    logger.info({ code, userId: request.user.id }, 'Template upserted');

    return reply.status(201).send({
      message: 'Template saved successfully',
      data: template,
    });
  });

  // POST /api/notifications/send - Send a notification
  app.post<{
    Body: z.infer<typeof sendNotificationSchema>;
  }>('/send', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request, reply) => {
    const input = sendNotificationSchema.parse(request.body);

    if (!input.userId && !input.email && !input.phone) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Must provide userId, email, or phone' },
      });
    }

    if (!input.templateCode && !input.content) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Must provide templateCode or content' },
      });
    }

    const result = await notificationsService.send({
      ...input,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
    });

    logger.info({
      notificationId: result.notificationId,
      status: result.status,
      userId: request.user.id,
    }, 'Notification sent');

    return {
      message: 'Notification sent',
      data: result,
    };
  });

  // POST /api/notifications/send-bulk - Send bulk notifications
  app.post<{
    Body: z.infer<typeof sendBulkSchema>;
  }>('/send-bulk', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request) => {
    const input = sendBulkSchema.parse(request.body);

    const result = await notificationsService.sendBulk(
      input.userIds,
      input.templateCode,
      input.variables || {},
      input.channels as NotificationChannel[]
    );

    logger.info({
      userCount: input.userIds.length,
      sent: result.sent,
      failed: result.failed,
      userId: request.user.id,
    }, 'Bulk notifications sent');

    return {
      message: `Sent ${result.sent} notifications, ${result.failed} failed`,
      data: result,
    };
  });

  // POST /api/notifications/process - Process pending notifications (for cron job)
  app.post('/process', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async () => {
    const result = await notificationsService.processPending();
    return {
      message: `Processed ${result.processed} notifications, ${result.failed} failed`,
      data: result,
    };
  });

  // ===== User Endpoints =====

  // GET /api/notifications/preferences - Get current user's preferences
  app.get('/preferences', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const preferences = await notificationsService.getUserPreferences(request.user.sub);
    return { data: preferences };
  });

  // PUT /api/notifications/preferences - Update current user's preferences
  app.put<{
    Body: z.infer<typeof updatePreferencesSchema>;
  }>('/preferences', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { channel, ...preferences } = updatePreferencesSchema.parse(request.body);

    const updated = await notificationsService.updateUserPreferences(
      request.user.sub,
      channel,
      preferences
    );

    return {
      message: 'Preferences updated',
      data: updated,
    };
  });

  // GET /api/notifications/history - Get current user's notification history
  app.get<{
    Querystring: { limit?: number; channel?: NotificationChannel };
  }>('/history', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { limit, channel } = request.query;
    const notifications = await notificationsService.getUserNotifications(
      request.user.sub,
      { limit, channel }
    );
    return { data: notifications };
  });

  // POST /api/notifications/:id/delivered - Mark notification as delivered (webhook)
  app.post<{
    Params: { id: string };
  }>('/:id/delivered', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      await notificationsService.markDelivered(request.params.id);
      return { message: 'Marked as delivered' };
    } catch {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Notification not found' },
      });
    }
  });
};
