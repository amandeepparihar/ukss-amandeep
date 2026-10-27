import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { listQuerySchema, calculatePaginationMeta } from '@admin/shared';

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  type: z.enum(['INFO', 'WARNING', 'SUCCESS', 'ERROR']).default('INFO'),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  targetRoles: z.array(z.string()).default([]),
  dismissable: z.boolean().default(true),
  showOnPages: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(10).default(5),
});

const updateAnnouncementSchema = createAnnouncementSchema.partial();

export const announcementRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/announcements - List all announcements (admin view)
  app.get('/', {
    preHandler: [app.requirePermission('announcements:view')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc', search } = query;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.announcement.count({ where }),
    ]);

    return {
      data: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        content: a.content,
        type: a.type,
        isActive: a.isActive,
        startsAt: a.startsAt?.toISOString() || null,
        endsAt: a.endsAt?.toISOString() || null,
        targetRoles: a.targetRoles,
        dismissable: a.dismissable,
        showOnPages: a.showOnPages,
        priority: a.priority,
        createdById: a.createdById,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      meta: calculatePaginationMeta(total, page, pageSize),
    };
  });

  // GET /api/announcements/active - Get active announcements for current user
  app.get('/active', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const now = new Date();

    // Get user's role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      return { data: [] };
    }

    // Get dismissed announcements for this user
    const dismissals = await prisma.announcementDismissal.findMany({
      where: { userId },
      select: { announcementId: true },
    });
    const dismissedIds = dismissals.map((d) => d.announcementId);

    // Get active announcements
    const announcements = await prisma.announcement.findMany({
      where: {
        isActive: true,
        OR: [
          { startsAt: null },
          { startsAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endsAt: null },
              { endsAt: { gte: now } },
            ],
          },
        ],
        // Exclude dismissed (unless not dismissable)
        NOT: {
          AND: [
            { dismissable: true },
            { id: { in: dismissedIds } },
          ],
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });

    // Filter by role targeting
    const filteredAnnouncements = announcements.filter((a) => {
      const roles = a.targetRoles as string[] | null;
      if (!roles || roles.length === 0) return true;
      return roles.includes(user.role.name);
    });

    return {
      data: filteredAnnouncements.map((a) => ({
        id: a.id,
        title: a.title,
        content: a.content,
        type: a.type,
        dismissable: a.dismissable,
        priority: a.priority,
      })),
    };
  });

  // POST /api/announcements - Create announcement
  app.post('/', {
    preHandler: [app.requirePermission('announcements:create')],
  }, async (request) => {
    const data = createAnnouncementSchema.parse(request.body);
    const userId = request.user.sub;

    const announcement = await prisma.announcement.create({
      data: {
        ...data,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        createdById: userId,
      },
    });

    return {
      data: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        type: announcement.type,
        isActive: announcement.isActive,
        startsAt: announcement.startsAt?.toISOString() || null,
        endsAt: announcement.endsAt?.toISOString() || null,
        targetRoles: announcement.targetRoles,
        dismissable: announcement.dismissable,
        showOnPages: announcement.showOnPages,
        priority: announcement.priority,
        createdById: announcement.createdById,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
      },
    };
  });

  // GET /api/announcements/:id - Get single announcement
  app.get('/:id', {
    preHandler: [app.requirePermission('announcements:view')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const announcement = await prisma.announcement.findUnique({
      where: { id },
    });

    if (!announcement) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Announcement not found' },
      });
    }

    return {
      data: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        type: announcement.type,
        isActive: announcement.isActive,
        startsAt: announcement.startsAt?.toISOString() || null,
        endsAt: announcement.endsAt?.toISOString() || null,
        targetRoles: announcement.targetRoles,
        dismissable: announcement.dismissable,
        showOnPages: announcement.showOnPages,
        priority: announcement.priority,
        createdById: announcement.createdById,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
      },
    };
  });

  // PUT /api/announcements/:id - Update announcement
  app.put('/:id', {
    preHandler: [app.requirePermission('announcements:edit')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateAnnouncementSchema.parse(request.body);

    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Announcement not found' },
      });
    }

    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...data,
        startsAt: data.startsAt !== undefined
          ? (data.startsAt ? new Date(data.startsAt) : null)
          : undefined,
        endsAt: data.endsAt !== undefined
          ? (data.endsAt ? new Date(data.endsAt) : null)
          : undefined,
      },
    });

    return {
      data: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        type: announcement.type,
        isActive: announcement.isActive,
        startsAt: announcement.startsAt?.toISOString() || null,
        endsAt: announcement.endsAt?.toISOString() || null,
        targetRoles: announcement.targetRoles,
        dismissable: announcement.dismissable,
        showOnPages: announcement.showOnPages,
        priority: announcement.priority,
        createdById: announcement.createdById,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
      },
    };
  });

  // DELETE /api/announcements/:id - Delete announcement
  app.delete('/:id', {
    preHandler: [app.requirePermission('announcements:delete')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Announcement not found' },
      });
    }

    // Delete dismissals first
    await prisma.announcementDismissal.deleteMany({
      where: { announcementId: id },
    });

    await prisma.announcement.delete({ where: { id } });

    return { data: { success: true } };
  });

  // POST /api/announcements/:id/dismiss - Dismiss announcement for current user
  app.post('/:id/dismiss', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;

    const announcement = await prisma.announcement.findUnique({ where: { id } });
    if (!announcement) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Announcement not found' },
      });
    }

    if (!announcement.dismissable) {
      return reply.status(400).send({
        error: { code: 'NOT_DISMISSABLE', message: 'This announcement cannot be dismissed' },
      });
    }

    await prisma.announcementDismissal.upsert({
      where: {
        userId_announcementId: { userId, announcementId: id },
      },
      create: { userId, announcementId: id },
      update: {},
    });

    return { data: { success: true } };
  });
};
