/**
 * SPEC-13: Order Processing Engine — route handlers.
 * Requirements: REQ-13-001 through REQ-13-009
 *
 * Endpoints:
 *   GET  /api/orders/unallocated-stock     — Unallocated stock (REQ-13-009)
 *   POST /api/orders/batch-process         — Batch processing (REQ-13-006)
 *   POST /api/orders/:id/simulate          — Run simulation (REQ-13-001/002)
 *   POST /api/orders/:id/simulate/disagree — Record disagreement (REQ-13-003)
 *   POST /api/orders/:id/simulate/execute  — Execute after approval (REQ-13-004)
 *   GET  /api/orders/:id/invoice-log       — Invoice log (REQ-13-005)
 *   POST /api/orders/:id/remote-process    — Remote processing (REQ-13-008)
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  OrderIdParamSchema,
  SimulationDisagreeSchema,
  RemoteProcessSchema,
  BatchProcessSchema,
} from '../orders.schema';
import { resolvePhpAdminId, resolveAdminName } from '../orders.helpers';
import {
  simulateOrderProcessing,
  recordDisagreement,
  executeProcessing,
  batchProcessOrders,
  processOrderQueue,
  getUnallocatedStock,
} from './processing.service';
import {
  remoteOrderProcessing,
  getInvoiceLog,
} from './processing.remote';

export const processingRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // Static routes FIRST (before parametric /:id routes)
  // -------------------------------------------------------------------------

  // REQ-13-009: Unallocated Stock Detection
  // GET /api/orders/unallocated-stock
  app.get('/unallocated-stock', {
    preHandler: [app.requirePermission('orders:view')],
  }, async () => {
    const items = await getUnallocatedStock();
    return { status: 'success', data: items };
  });

  // REQ-13-006: Batch Processing (caller supplies explicit order IDs)
  // POST /api/orders/batch-process
  app.post('/batch-process', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { orderIds } = BatchProcessSchema.parse(request.body);
    const adminId = await resolvePhpAdminId(request.cookies);

    const result = await batchProcessOrders(orderIds, adminId);
    return { status: 'success', data: result };
  });

  // #1061 P2: Process the full eligible queue (server selects + archives + orders).
  // POST /api/orders/process-queue
  app.post('/process-queue', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const adminId = await resolvePhpAdminId(request.cookies);

    const result = await processOrderQueue(adminId);
    return { status: 'success', data: result };
  });

  // -------------------------------------------------------------------------
  // Parametric routes (/:id)
  // -------------------------------------------------------------------------

  // REQ-13-001 / REQ-13-002: Run Simulation
  // POST /api/orders/:id/simulate
  app.post('/:id/simulate', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    try {
      const { id: orderId } = OrderIdParamSchema.parse(request.params);
      const result = await simulateOrderProcessing(orderId);
      return { status: 'success', data: result };
    } catch (err) {
      request.log.error({ err }, 'Simulation failed');
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({
        error: { code: 'SIMULATION_ERROR', message },
      });
    }
  });

  // REQ-13-003: Record Disagreement
  // POST /api/orders/:id/simulate/disagree
  app.post('/:id/simulate/disagree', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const { comment } = SimulationDisagreeSchema.parse(request.body);
    const name = await resolveAdminName(request.cookies, request.user as { email?: string } | undefined);

    await recordDisagreement(orderId, name, comment);
    return { status: 'success', message: 'Disagreement recorded' };
  });

  // REQ-13-004: Execute Processing (after simulation approval)
  // POST /api/orders/:id/simulate/execute
  app.post('/:id/simulate/execute', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const adminId = await resolvePhpAdminId(request.cookies);

    const result = await executeProcessing(orderId, adminId);
    return { status: 'success', data: result };
  });

  // REQ-13-005: Invoice Log
  // GET /api/orders/:id/invoice-log
  app.get('/:id/invoice-log', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const entries = await getInvoiceLog(orderId);
    return { status: 'success', data: entries };
  });

  // REQ-13-008: Remote Order Processing
  // POST /api/orders/:id/remote-process
  app.post('/:id/remote-process', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const body = RemoteProcessSchema.parse(request.body);
    const name = await resolveAdminName(request.cookies, request.user as { email?: string } | undefined);

    const result = await remoteOrderProcessing(orderId, body, name);
    return { status: 'success', data: result };
  });
};
