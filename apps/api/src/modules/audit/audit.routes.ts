import type { FastifyPluginAsync } from 'fastify';
import { listQuerySchema } from '@admin/shared';
import { prisma } from '../../lib/prisma';
import { calculatePaginationMeta } from '@admin/shared';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/audit-logs - List audit logs with filtering
  app.get('/', {
    preHandler: [app.requirePermission('audit-logs:view')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const rawQuery = request.query as Record<string, unknown>;
    const { page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc', search } = query;

    const where: Record<string, unknown> = {};

    // Search across user email, action, resource
    if (search) {
      where.OR = [
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { action: { contains: search, mode: 'insensitive' } },
        { resource: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by action
    if (rawQuery.action) {
      where.action = rawQuery.action;
    }

    // Filter by resource
    if (rawQuery.resource) {
      where.resource = rawQuery.resource;
    }

    // Filter by userId
    if (rawQuery.userId) {
      where.userId = rawQuery.userId;
    }

    // Date range filter
    if (rawQuery.dateFrom || rawQuery.dateTo) {
      where.createdAt = {};
      if (rawQuery.dateFrom) {
        (where.createdAt as Record<string, Date>).gte = new Date(rawQuery.dateFrom as string);
      }
      if (rawQuery.dateTo) {
        (where.createdAt as Record<string, Date>).lte = new Date(rawQuery.dateTo as string);
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        user: log.user ? {
          id: log.user.id,
          email: log.user.email,
          name: `${log.user.firstName} ${log.user.lastName}`,
        } : null,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        oldValues: log.oldValues,
        newValues: log.newValues,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: calculatePaginationMeta(total, page, pageSize),
    };
  });

  // GET /api/audit-logs/:id - Get single audit log detail
  app.get('/:id', {
    preHandler: [app.requirePermission('audit-logs:view')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!log) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Audit log not found' },
      });
    }

    return {
      data: {
        id: log.id,
        userId: log.userId,
        user: log.user ? {
          id: log.user.id,
          email: log.user.email,
          name: `${log.user.firstName} ${log.user.lastName}`,
        } : null,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        oldValues: log.oldValues,
        newValues: log.newValues,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      },
    };
  });

  // GET /api/audit-logs/stats - Get audit log statistics
  app.get('/stats', {
    preHandler: [app.requirePermission('audit-logs:view')],
  }, async () => {
    const [totalLogs, actionStats, resourceStats, recentActivity] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['resource'],
        _count: { resource: true },
        orderBy: { _count: { resource: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      totalLogs,
      actionStats: actionStats.map((s) => ({ action: s.action, count: s._count.action })),
      resourceStats: resourceStats.map((s) => ({ resource: s.resource, count: s._count.resource })),
      recentActivity: recentActivity.map((log) => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
        createdAt: log.createdAt.toISOString(),
      })),
    };
  });
};
