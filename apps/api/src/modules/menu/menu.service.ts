import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { NotFoundError } from '../../lib/errors';
import type { CreateMenuItemInput, UpdateMenuItemInput } from '@admin/shared';

const logger = createLogger('menu');

interface MenuItem {
  id: string;
  label: string;
  icon: string | null;
  path: string | null;
  isExternal: boolean;
  parentId: string | null;
  permission: string | null;
  badgeKey: string | null;
  sortOrder: number;
  isActive: boolean;
  children?: MenuItem[];
}

export class MenuService {
  async getMenuTree(userPermissions?: string[]) {
    const items = await prisma.menuItem.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    // Build tree structure
    const buildTree = (parentId: string | null): MenuItem[] => {
      return items
        .filter((item) => item.parentId === parentId)
        .filter((item) => {
          // Filter by permission if provided
          if (!userPermissions) return true;
          if (!item.permission) return true;
          return userPermissions.includes(item.permission);
        })
        .map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          path: item.path,
          isExternal: item.isExternal,
          parentId: item.parentId,
          permission: item.permission,
          badgeKey: item.badgeKey,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          children: buildTree(item.id),
        }))
        .filter((item) => {
          // Include parent items only if they have children or a valid path
          if (item.children && item.children.length > 0) return true;
          return item.path !== null;
        });
    };

    return buildTree(null);
  }

  async getAllItems() {
    const items = await prisma.menuItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    return items.map((item) => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      path: item.path,
      isExternal: item.isExternal,
      parentId: item.parentId,
      permission: item.permission,
      badgeKey: item.badgeKey,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  async findById(id: string) {
    const item = await prisma.menuItem.findUnique({ where: { id } });

    if (!item) {
      throw new NotFoundError('Menu item');
    }

    return {
      id: item.id,
      label: item.label,
      icon: item.icon,
      path: item.path,
      isExternal: item.isExternal,
      parentId: item.parentId,
      permission: item.permission,
      badgeKey: item.badgeKey,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async create(data: CreateMenuItemInput, createdBy: string) {
    const item = await prisma.menuItem.create({
      data: {
        label: data.label,
        icon: data.icon,
        path: data.path,
        isExternal: data.isExternal ?? false,
        parentId: data.parentId,
        permission: data.permission,
        badgeKey: data.badgeKey,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: createdBy,
        action: 'create',
        resource: 'menu_item',
        resourceId: item.id,
        newValues: data,
      },
    });

    logger.info({ menuItemId: item.id }, 'Menu item created');

    return {
      id: item.id,
      label: item.label,
      icon: item.icon,
      path: item.path,
      isExternal: item.isExternal,
      parentId: item.parentId,
      permission: item.permission,
      badgeKey: item.badgeKey,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async update(id: string, data: UpdateMenuItemInput, updatedBy: string) {
    const item = await prisma.menuItem.findUnique({ where: { id } });

    if (!item) {
      throw new NotFoundError('Menu item');
    }

    const updated = await prisma.menuItem.update({
      where: { id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        userId: updatedBy,
        action: 'update',
        resource: 'menu_item',
        resourceId: id,
        oldValues: {
          label: item.label,
          icon: item.icon,
          path: item.path,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
        },
        newValues: data,
      },
    });

    logger.info({ menuItemId: id }, 'Menu item updated');

    return {
      id: updated.id,
      label: updated.label,
      icon: updated.icon,
      path: updated.path,
      isExternal: updated.isExternal,
      parentId: updated.parentId,
      permission: updated.permission,
      badgeKey: updated.badgeKey,
      sortOrder: updated.sortOrder,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async delete(id: string, deletedBy: string) {
    const item = await prisma.menuItem.findUnique({ where: { id } });

    if (!item) {
      throw new NotFoundError('Menu item');
    }

    // Delete children first
    await prisma.menuItem.deleteMany({ where: { parentId: id } });
    await prisma.menuItem.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: deletedBy,
        action: 'delete',
        resource: 'menu_item',
        resourceId: id,
        oldValues: { label: item.label, path: item.path },
      },
    });

    logger.info({ menuItemId: id }, 'Menu item deleted');
  }

  async reorder(items: { id: string; sortOrder: number }[], updatedBy: string) {
    await prisma.$transaction(
      items.map((item) =>
        prisma.menuItem.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    await prisma.auditLog.create({
      data: {
        userId: updatedBy,
        action: 'reorder',
        resource: 'menu_item',
        newValues: { items },
      },
    });

    logger.info('Menu items reordered');
  }
}
