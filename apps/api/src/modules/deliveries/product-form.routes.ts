/**
 * Add-SMS-Product form routes.
 *
 *   GET  /api/deliveries/product-form?pcode=...    — form pre-fill data
 *   POST /api/deliveries/product-form/submit       — Flow A submit
 *
 * Phase 3 ships Flow A only. Flow B (mappedProductId set) returns 501. The
 * legacy form remains the authoritative writer for mapped products until the
 * 12-table parity port lands.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthorizationError } from '../../lib/errors';
import {
  ProductFormLoadQuerySchema,
  SubmitForReviewBodySchema,
} from './product-form.schema';
import {
  loadCreateEditProductForm,
  submitForReview,
  FormSubmitError,
} from './product-form.service';
import { resolveSmsUserId } from './deliveries.user';

function ensureAnyPermission(
  request: { user: { permissions: string[] } },
  any: string[]
) {
  if (!any.some((p) => request.user.permissions?.includes(p))) {
    throw new AuthorizationError(`Missing permission: requires one of ${any.join(', ')}`);
  }
}

function handle(err: unknown, reply: { status: (n: number) => any }) {
  if (err instanceof FormSubmitError) {
    return reply.status(err.status).send({ ok: false, error: err.message, code: err.code });
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      ok: false,
      error: 'Invalid request',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    });
  }
  throw err;
}

const FORM_PERMISSIONS = ['deliveries:add_sms_product', 'pre_order:add_product'];

export const deliveriesProductFormRoutes: FastifyPluginAsync = async (app) => {
  // GET /product-form?pcode=...
  app.get(
    '/product-form',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        ensureAnyPermission(request, FORM_PERMISSIONS);
        const { pcode } = ProductFormLoadQuerySchema.parse(request.query);
        const data = await loadCreateEditProductForm(pcode.trim());
        return { ok: true, data };
      } catch (err) {
        return handle(err, reply);
      }
    }
  );

  // POST /product-form/submit
  app.post(
    '/product-form/submit',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        ensureAnyPermission(request, FORM_PERMISSIONS);
        const body = SubmitForReviewBodySchema.parse(request.body);
        const smsUserId = await resolveSmsUserId(request);
        const result = await submitForReview(body, smsUserId);
        return { ok: true, data: result };
      } catch (err) {
        return handle(err, reply);
      }
    }
  );
};
