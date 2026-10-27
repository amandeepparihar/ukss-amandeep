import type { FastifyPluginAsync } from 'fastify';
import { createMenuItemSchema, updateMenuItemSchema } from '@admin/shared';
import { MenuService } from './menu.service';
import { prisma } from '../../lib/prisma';

export const menuRoutes: FastifyPluginAsync = async (app) => {
  const menuService = new MenuService();

  // GET /api/menu - Get menu tree for current user
  app.get('/', {
    preHandler: [app.authenticate],
  }, async (request) => {
    // Get user permissions
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    const permissions = user?.role.permissions.map((p) => `${p.resource}:${p.action}`) || [];
    const menu = await menuService.getMenuTree(permissions);
    return { data: menu };
  });

  // GET /api/menu/all - Get all menu items (admin only)
  app.get('/all', {
    preHandler: [app.requirePermission('menu:view')],
  }, async () => {
    const items = await menuService.getAllItems();
    return { data: items };
  });

  // GET /api/menu/:id
  app.get('/:id', {
    preHandler: [app.requirePermission('menu:view')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const item = await menuService.findById(id);
    return { data: item };
  });

  // POST /api/menu
  app.post('/', {
    preHandler: [app.requirePermission('menu:create')],
  }, async (request, reply) => {
    const data = createMenuItemSchema.parse(request.body);
    const item = await menuService.create(data, request.user.sub);
    return reply.status(201).send({ data: item });
  });

  // PUT /api/menu/:id
  app.put('/:id', {
    preHandler: [app.requirePermission('menu:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const data = updateMenuItemSchema.parse(request.body);
    const item = await menuService.update(id, data, request.user.sub);
    return { data: item };
  });

  // DELETE /api/menu/:id
  app.delete('/:id', {
    preHandler: [app.requirePermission('menu:delete')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await menuService.delete(id, request.user.sub);
    return reply.status(204).send();
  });

  // POST /api/menu/reorder
  app.post('/reorder', {
    preHandler: [app.requirePermission('menu:edit')],
  }, async (request) => {
    const { items } = request.body as { items: { id: string; sortOrder: number }[] };
    await menuService.reorder(items, request.user.sub);
    return { data: { success: true } };
  });
};
