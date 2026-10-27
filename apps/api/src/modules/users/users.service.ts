import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { calculatePaginationMeta } from '@admin/shared';
import type { CreateUserInput, UpdateUserInput, ListQueryInput } from '@admin/shared';

const logger = createLogger('users');

export class UsersService {
  async findAll(query: ListQueryInput & { filter?: Record<string, unknown> }) {
    const { page = 1, pageSize = 20, sortBy, sortOrder = 'asc', search, filter } = query;

    const where: Record<string, unknown> = {
      deletedAt: null,
    };

    // Search
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filters
    if (filter) {
      if (filter.roleId) {
        where.roleId = filter.roleId;
      }
      if (filter.isActive !== undefined) {
        where.isActive = filter.isActive === 'true' || filter.isActive === true;
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: sortBy ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        roleId: user.roleId,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
      meta: calculatePaginationMeta(total, page, pageSize),
    };
  }

  async findById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roleId: user.roleId,
      role: {
        id: user.role.id,
        name: user.role.name,
        description: user.role.description,
        isSystem: user.role.isSystem,
        permissions: user.role.permissions,
      },
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async create(data: CreateUserInput, createdBy: string) {
    // Check if email exists
    const existing = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictError('Email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 12);

    // Use transaction to ensure user + audit log are atomic
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          roleId: data.roleId,
          isActive: data.isActive ?? true,
        },
        include: {
          role: true,
        },
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: createdBy,
          action: 'create',
          resource: 'user',
          resourceId: newUser.id,
          newValues: {
            email: newUser.email,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            roleId: newUser.roleId,
          },
        },
      });

      return newUser;
    });

    logger.info({ userId: user.id }, 'User created');

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roleId: user.roleId,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async update(id: string, data: UpdateUserInput, updatedBy: string) {
    const user = await prisma.user.findUnique({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Check email uniqueness if changing
    if (data.email && data.email.toLowerCase() !== user.email) {
      const existing = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictError('Email already exists');
      }
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.email) {
      updateData.email = data.email.toLowerCase();
    }

    // Use transaction to ensure update + audit log are atomic
    const updated = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
        include: {
          role: true,
        },
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: updatedBy,
          action: 'update',
          resource: 'user',
          resourceId: id,
          oldValues: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            roleId: user.roleId,
            isActive: user.isActive,
          },
          newValues: data,
        },
      });

      return updatedUser;
    });

    logger.info({ userId: id }, 'User updated');

    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      avatar: updated.avatar,
      isActive: updated.isActive,
      emailVerified: updated.emailVerified,
      twoFactorEnabled: updated.twoFactorEnabled,
      roleId: updated.roleId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async delete(id: string, deletedBy: string) {
    const user = await prisma.user.findUnique({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Use transaction to ensure delete + session cleanup + audit log are atomic
    await prisma.$transaction(async (tx) => {
      // Soft delete
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // Delete all sessions
      await tx.session.deleteMany({
        where: { userId: id },
      });

      // Create audit log within transaction
      await tx.auditLog.create({
        data: {
          userId: deletedBy,
          action: 'delete',
          resource: 'user',
          resourceId: id,
          oldValues: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        },
      });
    });

    logger.info({ userId: id }, 'User deleted');
  }

  /**
   * Bulk activate users
   */
  async bulkActivate(ids: string[], activatedBy: string): Promise<{ affected: number }> {
    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.user.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          isActive: false,
        },
        data: { isActive: true },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: activatedBy,
          action: 'bulk_activate',
          resource: 'user',
          newValues: { userIds: ids, affected: affected.count },
        },
      });

      return affected.count;
    });

    logger.info({ userIds: ids, affected: result }, 'Users bulk activated');
    return { affected: result };
  }

  /**
   * Bulk deactivate users
   */
  async bulkDeactivate(ids: string[], deactivatedBy: string): Promise<{ affected: number }> {
    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.user.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          isActive: true,
        },
        data: { isActive: false },
      });

      // Terminate sessions for deactivated users
      await tx.session.deleteMany({
        where: { userId: { in: ids } },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: deactivatedBy,
          action: 'bulk_deactivate',
          resource: 'user',
          newValues: { userIds: ids, affected: affected.count },
        },
      });

      return affected.count;
    });

    logger.info({ userIds: ids, affected: result }, 'Users bulk deactivated');
    return { affected: result };
  }

  /**
   * Bulk delete users (soft delete)
   */
  async bulkDelete(ids: string[], deletedBy: string): Promise<{ affected: number }> {
    const result = await prisma.$transaction(async (tx) => {
      // Get users to be deleted for audit log
      const users = await tx.user.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      const affected = await tx.user.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });

      // Terminate sessions for deleted users
      await tx.session.deleteMany({
        where: { userId: { in: ids } },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: deletedBy,
          action: 'bulk_delete',
          resource: 'user',
          oldValues: { users },
          newValues: { userIds: ids, affected: affected.count },
        },
      });

      return affected.count;
    });

    logger.info({ userIds: ids, affected: result }, 'Users bulk deleted');
    return { affected: result };
  }

  /**
   * Bulk assign role to users
   */
  async bulkAssignRole(ids: string[], roleId: string, assignedBy: string): Promise<{ affected: number }> {
    // Verify role exists
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundError('Role');
    }

    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.user.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        data: { roleId },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: assignedBy,
          action: 'bulk_assign_role',
          resource: 'user',
          newValues: { userIds: ids, roleId, roleName: role.name, affected: affected.count },
        },
      });

      return affected.count;
    });

    logger.info({ userIds: ids, roleId, affected: result }, 'Users bulk role assigned');
    return { affected: result };
  }

  /**
   * Bulk reset 2FA for users
   */
  async bulkReset2FA(ids: string[], resetBy: string): Promise<{ affected: number }> {
    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.user.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          twoFactorEnabled: true,
        },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: resetBy,
          action: 'bulk_reset_2fa',
          resource: 'user',
          newValues: { userIds: ids, affected: affected.count },
        },
      });

      return affected.count;
    });

    logger.info({ userIds: ids, affected: result }, 'Users bulk 2FA reset');
    return { affected: result };
  }
}
