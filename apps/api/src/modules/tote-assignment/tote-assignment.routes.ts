import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sharedSessionService } from '../auth/shared-session.instance';
import { prisma } from '../../lib/prisma';
import {
  OrderLookupParamSchema,
  BatchLookupParamSchema,
  AssignOrderToteSchema,
  AssignBatchToteSchema,
} from './tote-assignment.schema';
import {
  getOrderForToteAssignment,
  getBatchForToteAssignment,
  assignToteToOrder,
  assignToteToBatch,
} from './tote-assignment.service';

async function resolveAdminName(request: FastifyRequest): Promise<string> {
  const sharedToken = request.cookies.shared_admin_session;
  if (sharedToken) {
    const session = await sharedSessionService.validateSession(sharedToken);
    if (session?.userEmail) return session.userEmail;
  }

  // refs: #165290 (Abhinav Gautam) - the JWT payload here only contains { sub, permissions }
  // (see auth.service.ts generateTokens), so request.user.email is undefined. Look up the user
  // from the admin DB as the reliable fallback.
  const sub = request.user?.sub;
  if (sub) {
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { firstName: true, lastName: true, email: true },
    });
    if (user) {
      const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      return fullName || user.email || 'Unknown';
    }
  }

  return 'Unknown';
}

export const toteAssignmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/order/:orderId', {
    preHandler: [app.requirePermission('tote-assignment:manage')],
  }, async (request) => {
    const { orderId } = OrderLookupParamSchema.parse(request.params);
    const data = await getOrderForToteAssignment(orderId);
    return { data };
  });

  app.get('/batch/:batchName', {
    preHandler: [app.requirePermission('tote-assignment:manage')],
  }, async (request) => {
    const { batchName } = BatchLookupParamSchema.parse(request.params);
    const data = await getBatchForToteAssignment(batchName);
    return { data };
  });

  app.post('/order', {
    preHandler: [app.requirePermission('tote-assignment:manage')],
  }, async (request) => {
    const body = AssignOrderToteSchema.parse(request.body);
    const adminName = await resolveAdminName(request);
    const result = await assignToteToOrder(body, adminName);
    return {
      status: 'success',
      message: 'TOTE assigned successfully',
      data: result,
    };
  });

  app.post('/batch', {
    preHandler: [app.requirePermission('tote-assignment:manage')],
  }, async (request) => {
    const body = AssignBatchToteSchema.parse(request.body);
    const adminName = await resolveAdminName(request);
    const result = await assignToteToBatch(body, adminName);
    return {
      status: 'success',
      message: 'TOTE assigned successfully',
      data: result,
    };
  });
};
