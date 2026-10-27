/**
 * Product-level action routes — box number, JIT, backorder, toggles.
 * Requirements: REQ-06-001 through REQ-06-026
 *
 * Endpoints:
 * - POST /:id/products/:productId/box-number  (REQ-06-001 through REQ-06-007)
 * - POST /:id/products/:productId/jit         (REQ-06-008 through REQ-06-011)
 * - POST /:id/products/backorder              (REQ-06-014 through REQ-06-020)
 * - POST /:id/products/:productId/ship-check  (REQ-06-021)
 * - POST /:id/products/:productId/printing-status (REQ-06-022)
 * - POST /:id/products/:productId/arrived-status  (REQ-06-023)
 * - POST /:id/products/:productId/box1        (REQ-06-025)
 * - POST /:id/products/:productId/box2        (REQ-06-026)
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  ProductIdParamSchema,
  OrderIdParamSchema,
  BoxNumberSchema,
  JitToggleSchema,
  BackorderToggleSchema,
  ShipCheckSchema,
  PrintingStatusSchema,
  ArrivedStatusSchema,
  BoxFieldSchema,
} from '../orders.schema';
import { resolvePhpAdminId } from '../orders.helpers';
import {
  updateBoxNumber,
  toggleJit,
  updateShipCheck,
  updatePrintingStatus,
  updateArrivedStatus,
  updateBox1,
  updateBox2,
} from './product-actions.service';
import { toggleBackorder } from './product-actions.backorder';

export const productActionsRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // REQ-06-001: Box Number Assignment
  // POST /api/orders/:id/products/:productId/box-number
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/box-number', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId, productId } = ProductIdParamSchema.parse(request.params);
    const { boxNumber } = BoxNumberSchema.parse(request.body);

    const result = await updateBoxNumber(orderId, productId, boxNumber);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-008: JIT Toggle
  // POST /api/orders/:id/products/:productId/jit
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/jit', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { productId } = ProductIdParamSchema.parse(request.params);
    const { checkBit } = JitToggleSchema.parse(request.body);

    const result = await toggleJit(productId, checkBit);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-014: Backorder Toggle
  // POST /api/orders/:id/products/backorder
  // -------------------------------------------------------------------------

  app.post('/:id/products/backorder', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId } = OrderIdParamSchema.parse(request.params);
    const { orderProductId, backorder } = BackorderToggleSchema.parse(request.body);

    const phpAdminId = await resolvePhpAdminId(request.cookies);

    const result = await toggleBackorder(orderId, orderProductId, backorder, phpAdminId);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-021: Ship Check Toggle
  // POST /api/orders/:id/products/:productId/ship-check
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/ship-check', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId, productId } = ProductIdParamSchema.parse(request.params);
    const { shipChk } = ShipCheckSchema.parse(request.body);

    const result = await updateShipCheck(orderId, productId, shipChk);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-022: Printing Status Toggle
  // POST /api/orders/:id/products/:productId/printing-status
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/printing-status', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId, productId } = ProductIdParamSchema.parse(request.params);
    const { printed } = PrintingStatusSchema.parse(request.body);

    const result = await updatePrintingStatus(orderId, productId, printed);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-023: Arrived Status Toggle
  // POST /api/orders/:id/products/:productId/arrived-status
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/arrived-status', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { id: orderId, productId } = ProductIdParamSchema.parse(request.params);
    const { arrived } = ArrivedStatusSchema.parse(request.body);

    const result = await updateArrivedStatus(orderId, productId, arrived);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-025: Box1 Update
  // POST /api/orders/:id/products/:productId/box1
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/box1', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { productId } = ProductIdParamSchema.parse(request.params);
    const { value } = BoxFieldSchema.parse(request.body);

    const result = await updateBox1(productId, value);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // REQ-06-026: Box2 Update
  // POST /api/orders/:id/products/:productId/box2
  // -------------------------------------------------------------------------

  app.post('/:id/products/:productId/box2', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request, reply) => {
    const { productId } = ProductIdParamSchema.parse(request.params);
    const { value } = BoxFieldSchema.parse(request.body);

    const result = await updateBox2(productId, value);

    if (result.status === 'error') {
      return reply.status(400).send(result);
    }
    return result;
  });
};
