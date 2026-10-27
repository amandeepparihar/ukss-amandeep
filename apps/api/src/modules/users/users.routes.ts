import type { FastifyPluginAsync } from 'fastify';
import { createUserSchema, updateUserSchema, listQuerySchema } from '@admin/shared';
import { UsersService } from './users.service';

export const userRoutes: FastifyPluginAsync = async (app) => {
  const usersService = new UsersService();

  // GET /api/users
  app.get('/', {
    preHandler: [app.requirePermission('users:view')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const rawQuery = request.query as Record<string, unknown>;

    // Build filter from query params (supports both filter.x and direct params)
    const filter: Record<string, unknown> = {};
    if (rawQuery.isActive !== undefined) {
      filter.isActive = rawQuery.isActive;
    }
    if (rawQuery.roleId !== undefined) {
      filter.roleId = rawQuery.roleId;
    }
    // Also support filter[key] format
    if (typeof rawQuery.filter === 'object' && rawQuery.filter !== null) {
      Object.assign(filter, rawQuery.filter);
    }

    const result = await usersService.findAll({
      ...query,
      filter: Object.keys(filter).length > 0 ? filter : undefined
    });
    return result;
  });

  // GET /api/users/:id
  app.get('/:id', {
    preHandler: [app.requirePermission('users:view')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const user = await usersService.findById(id);
    return { data: user };
  });

  // POST /api/users
  app.post('/', {
    preHandler: [app.requirePermission('users:create')],
  }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);
    const user = await usersService.create(data, request.user.sub);
    return reply.status(201).send({ data: user });
  });

  // PUT /api/users/:id
  app.put('/:id', {
    preHandler: [app.requirePermission('users:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const data = updateUserSchema.parse(request.body);
    const user = await usersService.update(id, data, request.user.sub);
    return { data: user };
  });

  // DELETE /api/users/:id
  app.delete('/:id', {
    preHandler: [app.requirePermission('users:delete')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await usersService.delete(id, request.user.sub);
    return reply.status(204).send();
  });

  // =============================================
  // Bulk Operations
  // =============================================

  // POST /api/users/bulk/activate
  app.post<{
    Body: { ids: string[] };
  }>('/bulk/activate', {
    preHandler: [app.requirePermission('users:edit')],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { ids } = request.body;
    const result = await usersService.bulkActivate(ids, request.user.sub);
    return { data: result };
  });

  // POST /api/users/bulk/deactivate
  app.post<{
    Body: { ids: string[] };
  }>('/bulk/deactivate', {
    preHandler: [app.requirePermission('users:edit')],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { ids } = request.body;
    const result = await usersService.bulkDeactivate(ids, request.user.sub);
    return { data: result };
  });

  // POST /api/users/bulk/delete
  app.post<{
    Body: { ids: string[] };
  }>('/bulk/delete', {
    preHandler: [app.requirePermission('users:delete')],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { ids } = request.body;
    const result = await usersService.bulkDelete(ids, request.user.sub);
    return { data: result };
  });

  // POST /api/users/bulk/assign-role
  app.post<{
    Body: { ids: string[]; roleId: string };
  }>('/bulk/assign-role', {
    preHandler: [app.requirePermission('users:edit')],
    schema: {
      body: {
        type: 'object',
        required: ['ids', 'roleId'],
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string' },
          },
          roleId: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { ids, roleId } = request.body;
    const result = await usersService.bulkAssignRole(ids, roleId, request.user.sub);
    return { data: result };
  });

  // POST /api/users/bulk/reset-2fa
  app.post<{
    Body: { ids: string[] };
  }>('/bulk/reset-2fa', {
    preHandler: [app.requirePermission('users:edit')],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { ids } = request.body;
    const result = await usersService.bulkReset2FA(ids, request.user.sub);
    return { data: result };
  });
};
