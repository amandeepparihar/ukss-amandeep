import { prisma } from '../prisma';

// Helper function to log audit events
export async function logAudit(
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  newValues?: unknown,
  request?: { ip: string; headers: Record<string, unknown> }
) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      resource,
      resourceId,
      newValues: newValues as object,
      metadata: request
        ? {
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          }
        : undefined,
    },
  });
}
