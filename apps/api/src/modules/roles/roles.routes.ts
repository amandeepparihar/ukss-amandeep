import type { FastifyPluginAsync } from 'fastify';
import { createRoleSchema, updateRoleSchema, updateRolePermissionsSchema, listQuerySchema } from '@admin/shared';
import { RolesService } from './roles.service';

export const roleRoutes: FastifyPluginAsync = async (app) => {
  const rolesService = new RolesService();

  // GET /api/roles
  app.get('/', {
    preHandler: [app.requirePermission('roles:view')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const result = await rolesService.findAll(query);
    return result;
  });

  // GET /api/roles/:id
  app.get('/:id', {
    preHandler: [app.requirePermission('roles:view')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const role = await rolesService.findById(id);
    return { data: role };
  });

  // POST /api/roles
  app.post('/', {
    preHandler: [app.requirePermission('roles:create')],
  }, async (request, reply) => {
    const data = createRoleSchema.parse(request.body);
    const role = await rolesService.create(data, request.user.sub);
    return reply.status(201).send({ data: role });
  });

  // PUT /api/roles/:id
  app.put('/:id', {
    preHandler: [app.requirePermission('roles:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const data = updateRoleSchema.parse(request.body);
    const role = await rolesService.update(id, data, request.user.sub);
    return { data: role };
  });

  // DELETE /api/roles/:id
  app.delete('/:id', {
    preHandler: [app.requirePermission('roles:delete')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await rolesService.delete(id, request.user.sub);
    return reply.status(204).send();
  });

  // PUT /api/roles/:id/permissions
  app.put('/:id/permissions', {
    preHandler: [app.requirePermission('roles:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { permissions } = updateRolePermissionsSchema.parse(request.body);
    const role = await rolesService.updatePermissions(id, permissions, request.user.sub);
    return { data: role };
  });
};
