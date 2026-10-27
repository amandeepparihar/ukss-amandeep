import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exportService, ExportFormat, ExportColumn } from './export.service';
import { prisma } from '../../lib/prisma';
import { ValidationError, AuthorizationError } from '../../lib/errors';

const ExportRequestSchema = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  resource: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      header: z.string(),
      width: z.number().optional(),
    })
  ).optional(),
  filters: z.record(z.unknown()).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
});

type ExportRequest = z.infer<typeof ExportRequestSchema>;

interface ResourceHandler {
  getData: (filters?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  defaultColumns: ExportColumn[];
  // Resource-scoped permission gate, checked against request.user.permissions
  // in addition to the blanket `fastify.authenticate` preHandler on the shared
  // /exports and /exports/preview routes. Optional: no field = no extra check
  // (matches prior behavior for users/roles/audit-logs).
  requiredPermission?: string;
}

// Resource handlers - extend as needed
const resourceHandlers: Record<string, ResourceHandler> = {
  users: {
    getData: async (filters) => {
      const users = await prisma.user.findMany({
        where: filters as any,
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      });
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role?.name || 'N/A',
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      }));
    },
    defaultColumns: [
      { key: 'email', header: 'Email', width: 30 },
      { key: 'firstName', header: 'First Name', width: 15 },
      { key: 'lastName', header: 'Last Name', width: 15 },
      { key: 'role', header: 'Role', width: 15 },
      { key: 'isActive', header: 'Active', width: 10 },
      { key: 'createdAt', header: 'Created At', width: 20 },
    ],
  },
  roles: {
    getData: async () => {
      const roles = await prisma.role.findMany({
        include: {
          _count: { select: { users: true, permissions: true } },
        },
        orderBy: { name: 'asc' },
      });
      return roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        userCount: role._count.users,
        permissionCount: role._count.permissions,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
      }));
    },
    defaultColumns: [
      { key: 'name', header: 'Role Name', width: 20 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'userCount', header: 'Users', width: 10 },
      { key: 'permissionCount', header: 'Permissions', width: 10 },
      { key: 'isSystem', header: 'System Role', width: 10 },
    ],
  },
  'audit-logs': {
    getData: async (filters) => {
      const logs = await prisma.auditLog.findMany({
        where: filters as any,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take: 1000, // Limit to prevent massive exports
      });
      return logs.map((log) => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      }));
    },
    defaultColumns: [
      { key: 'action', header: 'Action', width: 15 },
      { key: 'resource', header: 'Resource', width: 20 },
      { key: 'resourceId', header: 'Resource ID', width: 15 },
      { key: 'user', header: 'User', width: 25 },
      { key: 'ipAddress', header: 'IP Address', width: 15 },
      { key: 'createdAt', header: 'Date', width: 20 },
    ],
  },
};

export async function exportsRoutes(fastify: FastifyInstance) {
  // Export data
  fastify.post(
    '/exports',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate request body
      const result = ExportRequestSchema.safeParse(request.body);
      if (!result.success) {
        throw new ValidationError(
          result.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          }))
        );
      }

      const { format, resource, columns, filters, title, subtitle, orientation } =
        result.data;

      // Check if resource handler exists
      const handler = resourceHandlers[resource];
      if (!handler) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_RESOURCE',
            message: `Resource '${resource}' is not supported for export`,
          },
        });
      }

      // Resource-scoped permission check (in addition to the blanket
      // fastify.authenticate above). Mirrors the check in
      // fastify.requirePermission (apps/api/src/plugins/auth.ts) so the
      // status code stays consistent with the rest of the app.
      if (
        handler.requiredPermission &&
        !request.user.permissions.includes(handler.requiredPermission)
      ) {
        throw new AuthorizationError('Insufficient permissions');
      }

      try {
        // Get data
        const data = await handler.getData(filters);

        // Use provided columns or default columns
        const exportColumns =
          columns && columns.length > 0 ? columns : handler.defaultColumns;

        // Generate export
        const { buffer, mimeType, extension } = await exportService.export(
          format as ExportFormat,
          {
            filename: `${resource}-export`,
            columns: exportColumns,
            data,
            title: title || `${resource.charAt(0).toUpperCase() + resource.slice(1)} Export`,
            subtitle: subtitle || `Generated on ${new Date().toLocaleDateString()}`,
            orientation: orientation || 'portrait',
          }
        );

        // Send file
        const filename = `${resource}-${Date.now()}.${extension}`;
        return reply
          .header('Content-Type', mimeType)
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(buffer);
      } catch (error) {
        fastify.log.error(error, 'Export failed');
        return reply.status(500).send({
          error: {
            code: 'EXPORT_ERROR',
            message: 'Failed to generate export',
          },
        });
      }
    }
  );

  // Export preview - get a small sample of data
  fastify.post(
    '/exports/preview',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { resource: string; filters?: Record<string, unknown> };
      const { resource, filters } = body;

      const handler = resourceHandlers[resource];
      if (!handler) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_RESOURCE',
            message: `Resource '${resource}' is not supported for export`,
          },
        });
      }

      if (
        handler.requiredPermission &&
        !request.user.permissions.includes(handler.requiredPermission)
      ) {
        throw new AuthorizationError('Insufficient permissions');
      }

      try {
        const allData = await handler.getData(filters);
        const preview = allData.slice(0, 5);

        return reply.send({
          columns: handler.defaultColumns,
          preview,
          totalCount: allData.length,
        });
      } catch (error) {
        fastify.log.error(error, 'Export preview failed');
        return reply.status(500).send({
          error: {
            code: 'PREVIEW_ERROR',
            message: 'Failed to generate preview',
          },
        });
      }
    }
  );

  // Get available export resources
  fastify.get(
    '/exports/resources',
    {
      preHandler: [fastify.authenticate],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const resources = Object.entries(resourceHandlers).map(([key, handler]) => ({
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
        columns: handler.defaultColumns,
      }));

      return reply.send({ resources });
    }
  );
}
