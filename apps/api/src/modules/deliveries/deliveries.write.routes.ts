/**
 * Deliveries write-path routes.
 *
 * Endpoints (see documentation/deliveries-write-path-plan.md §4):
 *
 *   PATCH /api/deliveries/cells                   — inline cell edit (season, price, option_<N>)
 *   PATCH /api/deliveries/image-added/:productCode — toggle added_product_code_image
 *   GET   /api/deliveries/image-urls/:productCode  — read-only image URL viewer
 *   POST  /api/deliveries/link-quantity/:productCode — link/unlink/toggle quantity_map
 *
 * Per-endpoint permission gating is server-side (legacy is wide open under
 * Auth->allow — see audit ProductQuantitiesController §2). For the cell-edit
 * endpoint we resolve the permission AFTER parsing the body since the
 * permission required depends on the `column` value.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthorizationError } from '../../lib/errors';
import {
  DeliveryInlineEditBodySchema,
  ImageAddedBodySchema,
  LinkQuantityBodySchema,
  ProductCodeParamSchema,
  DELIVERY_CELL_COLUMN_PERMISSION,
} from './deliveries.write.schema';
import {
  applyInlineCellEdit,
  applyImageAddedToggle,
  applyLinkQuantity,
  getImageUrls,
  DeliveryWriteError,
} from './deliveries.write.service';
import { resolveSmsUserId } from './deliveries.user';

function ensurePermission(request: { user: { permissions: string[] } }, permission: string) {
  if (!request.user.permissions?.includes(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
}

/**
 * Map a thrown service-level error to a JSON response. Service throws
 * DeliveryWriteError for tractable errors; everything else bubbles to Fastify's
 * default error handler.
 */
function handleServiceError(err: unknown, reply: { status: (n: number) => any }) {
  if (err instanceof DeliveryWriteError) {
    return reply.status(err.status).send({ ok: false, error: err.message, code: err.code });
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      ok: false,
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    });
  }
  throw err;
}

export const deliveriesWriteRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------
  // PATCH /api/deliveries/cells — inline cell edit
  //
  // Body: { productQuantitiesId, column, value }. We `authenticate` here
  // (rather than `requirePermission` at preHandler) so we can pick the
  // right permission string based on the parsed `column`.
  // ---------------------------------------------------------------------
  app.patch(
    '/cells',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        const body = DeliveryInlineEditBodySchema.parse(request.body);
        const permission = DELIVERY_CELL_COLUMN_PERMISSION[body.column];
        ensurePermission(request, permission);

        const smsUserId = await resolveSmsUserId(request);
        const result = await applyInlineCellEdit(body, smsUserId, request.ip);
        return { ok: true, data: result };
      } catch (err) {
        return handleServiceError(err, reply);
      }
    }
  );

  // ---------------------------------------------------------------------
  // PATCH /api/deliveries/image-added/:productCode
  // ---------------------------------------------------------------------
  app.patch(
    '/image-added/:productCode',
    { preHandler: [app.requirePermission('deliveries:add_image')] },
    async (request, reply) => {
      try {
        const { productCode } = ProductCodeParamSchema.parse(request.params);
        const body = ImageAddedBodySchema.parse(request.body);
        const smsUserId = await resolveSmsUserId(request);
        const result = await applyImageAddedToggle(productCode, body, smsUserId);
        return { ok: true, data: result };
      } catch (err) {
        return handleServiceError(err, reply);
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/deliveries/image-urls/:productCode — read-only
  // ---------------------------------------------------------------------
  app.get(
    '/image-urls/:productCode',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request, reply) => {
      try {
        const { productCode } = ProductCodeParamSchema.parse(request.params);
        const result = await getImageUrls(productCode);
        if (!result) {
          return reply.status(404).send({ ok: false, error: 'product code not found', code: 'PL_NOT_FOUND' });
        }
        return { ok: true, data: result };
      } catch (err) {
        return handleServiceError(err, reply);
      }
    }
  );

  // ---------------------------------------------------------------------
  // POST /api/deliveries/link-quantity/:productCode
  // ---------------------------------------------------------------------
  app.post(
    '/link-quantity/:productCode',
    { preHandler: [app.requirePermission('deliveries:link_quantity')] },
    async (request, reply) => {
      try {
        const { productCode } = ProductCodeParamSchema.parse(request.params);
        const body = LinkQuantityBodySchema.parse(request.body ?? {});
        const smsUserId = await resolveSmsUserId(request);
        const result = await applyLinkQuantity(productCode, body, smsUserId);
        return { ok: true, data: result };
      } catch (err) {
        return handleServiceError(err, reply);
      }
    }
  );
};
