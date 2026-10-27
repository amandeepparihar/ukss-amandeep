import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { NotFoundError, ConflictError, AuthorizationError } from '../../lib/errors';
import { calculatePaginationMeta } from '@admin/shared';
import type { CreateRoleInput, UpdateRoleInput, PermissionInput, ListQueryInput } from '@admin/shared';

const logger = createLogger('roles');

export class RolesService {
  async findAll(query: ListQueryInput) {
    const { page = 1, pageSize = 20, sortBy, sortOrder = 'asc', search } = query;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [roles, total] = await Promise.all([
      prisma.role.findMany({
        where,
        include: {
          permissions: true,
          _count: {
            select: { users: true },
          },
        },
        orderBy: sortBy ? { [sortBy]: sortOrder } : { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.role.count({ where }),
    ]);

    return {
      data: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions.map((p) => ({
          id: p.id,
          resource: p.resource,
          action: p.action,
        })),
        userCount: role._count.users,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      })),
      meta: calculatePaginationMeta(total, page, pageSize),
    };
  }

  async findById(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        permissions: true,
        _count: {
          select: { users: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundError('Role');
    }

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((p) => ({
        id: p.id,
        resource: p.resource,
        action: p.action,
      })),
      userCount: role._count.users,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  async create(data: CreateRoleInput, createdBy: string) {
    // Check if name exists
    const existing = await prisma.role.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      throw new ConflictError('Role name already exists');
    }

    // Use transaction to ensure role + audit log are atomic
    const role = await prisma.$transaction(async (tx) => {
      const newRole = await tx.role.create({
        data: {
          name: data.name,
          description: data.description,
        },
        include: {
          permissions: true,
        },
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: createdBy,
          action: 'create',
          resource: 'role',
          resourceId: newRole.id,
          newValues: data,
        },
      });

      return newRole;
    });

    logger.info({ roleId: role.id }, 'Role created');

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: [],
      userCount: 0,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  async update(id: string, data: UpdateRoleInput, updatedBy: string) {
    const role = await prisma.role.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundError('Role');
    }

    if (role.isSystem) {
      throw new AuthorizationError('Cannot modify system roles');
    }

    // Check name uniqueness if changing
    if (data.name && data.name !== role.name) {
      const existing = await prisma.role.findUnique({
        where: { name: data.name },
      });
      if (existing) {
        throw new ConflictError('Role name already exists');
      }
    }

    // Use transaction to ensure update + audit log are atomic
    const updated = await prisma.$transaction(async (tx) => {
      const updatedRole = await tx.role.update({
        where: { id },
        data,
        include: {
          permissions: true,
          _count: {
            select: { users: true },
          },
        },
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: updatedBy,
          action: 'update',
          resource: 'role',
          resourceId: id,
          oldValues: { name: role.name, description: role.description },
          newValues: data,
        },
      });

      return updatedRole;
    });

    logger.info({ roleId: id }, 'Role updated');

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isSystem: updated.isSystem,
      permissions: updated.permissions.map((p) => ({
        id: p.id,
        resource: p.resource,
        action: p.action,
      })),
      userCount: updated._count.users,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async delete(id: string, deletedBy: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
      },
    });

    if (!role) {
      throw new NotFoundError('Role');
    }

    if (role.isSystem) {
      throw new AuthorizationError('Cannot delete system roles');
    }

    if (role._count.users > 0) {
      throw new ConflictError('Cannot delete role with assigned users');
    }

    // Use transaction to ensure delete + audit log are atomic
    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: deletedBy,
          action: 'delete',
          resource: 'role',
          resourceId: id,
          oldValues: { name: role.name, description: role.description },
        },
      });
    });

    logger.info({ roleId: id }, 'Role deleted');
  }

  async updatePermissions(id: string, permissions: PermissionInput[], updatedBy: string) {
    const role = await prisma.role.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundError('Role');
    }

    if (role.isSystem) {
      throw new AuthorizationError('Cannot modify system role permissions');
    }

    // Use transaction to ensure permissions update + audit log are atomic
    const updated = await prisma.$transaction(async (tx) => {
      // Delete existing permissions
      await tx.permission.deleteMany({ where: { roleId: id } });

      // Create new permissions
      await tx.permission.createMany({
        data: permissions.map((p) => ({
          roleId: id,
          resource: p.resource,
          action: p.action,
        })),
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: updatedBy,
          action: 'update_permissions',
          resource: 'role',
          resourceId: id,
          newValues: { permissions },
        },
      });

      // Fetch updated role
      return tx.role.findUnique({
        where: { id },
        include: {
          permissions: true,
          _count: { select: { users: true } },
        },
      });
    });

    logger.info({ roleId: id }, 'Role permissions updated');

    return {
      id: updated!.id,
      name: updated!.name,
      description: updated!.description,
      isSystem: updated!.isSystem,
      permissions: updated!.permissions.map((p) => ({
        id: p.id,
        resource: p.resource,
        action: p.action,
      })),
      userCount: updated!._count.users,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    };
  }
}
