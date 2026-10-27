/**
 * Deliveries grid per-row action routes.
 *
 *   GET  /api/deliveries/grid/map-candidates?productCode=&teamId=     — search ZC products
 *   POST /api/deliveries/grid/map                                      — apply map
 *   GET  /api/deliveries/grid/assign-font/:productCode                 — current state
 *   POST /api/deliveries/grid/assign-font                              — save fonts
 *   POST /api/deliveries/grid/special                                  — set special
 *   DELETE /api/deliveries/grid/special/:productCode                   — clear special
 *   GET  /api/deliveries/grid/ebay/:productCode                        — current state
 *   POST /api/deliveries/grid/ebay                                     — save eBay
 *
 * All endpoints enforce a server-side permission gate. Legacy is wide-open;
 * we deliberately tighten.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthorizationError } from '../../lib/errors';
import { resolveSmsUserId } from './deliveries.user';
import {
  applyMapToZc,
  applySetSpecial,
  applyClearSpecial,
  applyAssignFont,
  getAssignFontState,
  applySetEbay,
  getEbayState,
  searchMapCandidates,
  listTeamCategories,
  resolveMapPrefill,
  getSpecialState,
  searchFonts,
  GridActionError,
} from './grid-actions.service';

function ensurePermission(request: { user: { permissions: string[] } }, permission: string) {
  if (!request.user.permissions?.includes(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
}

function handleError(err: unknown, reply: { status: (n: number) => any }) {
  if (err instanceof GridActionError) {
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

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MapCandidatesQuery = z.object({
  productCode: z.string().trim().min(1),
  categoryId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const MapBody = z.object({
  productCode: z.string().trim().min(1),
  productIds: z.array(z.coerce.number().int().positive()).min(1),
  linkQuantity: z.boolean().default(false),
});

const SpecialSize = z.object({
  optionValueId: z.coerce.number().int().positive(),
  // Empty string from the UI ⇒ null (skip update).
  price: z.union([z.coerce.number().nonnegative(), z.null()]).default(null),
  prefix: z.enum(['+', '-']).default('-'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('0000-00-00'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('0000-00-00'),
});

const SpecialProduct = z.object({
  productsId: z.coerce.number().int().positive(),
  price: z.union([z.coerce.number().nonnegative(), z.null()]).default(null),
  thursdayDeal: z.boolean().default(false),
  blackFridayDeal: z.boolean().default(false),
  cyberMondayDeal: z.boolean().default(false),
  megaFridayDeal: z.boolean().default(false),
  sizes: z.array(SpecialSize).default([]),
});

const SpecialBody = z.object({
  productCode: z.string().trim().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  products: z.array(SpecialProduct).min(1),
});

const AssignFontBody = z.object({
  productCode: z.string().trim().min(1),
  assignments: z
    .array(
      z.object({
        fontName: z.string().trim().max(200),
        sizeIds: z.array(z.coerce.number().int().positive()).min(1),
      })
    )
    .default([]),
});

const SetEbayBody = z.object({
  productCode: z.string().trim().min(1),
  skuStates: z
    .array(
      z.object({
        pa_sku: z.string().trim().min(1),
        sentToEbay: z.enum(['yes', 'no']),
        stockLevel: z.coerce.number().int().nonnegative().optional(),
      })
    )
    .min(1),
});

const ProductCodeParam = z.object({ productCode: z.string().trim().min(1) });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const deliveriesGridActionsRoutes: FastifyPluginAsync = async (app) => {
  // ---- MAP ----
  app.get('/grid/map-candidates', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:map_products');
      const q = MapCandidatesQuery.parse(request.query);
      const rows = await searchMapCandidates(q.productCode, {
        categoryId: q.categoryId ?? null,
        limit: q.limit ?? 500,
      });
      return { ok: true, data: rows };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/grid/team-categories', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:map_products');
      const rows = await listTeamCategories();
      return { ok: true, data: rows };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Map dialog pre-fill: default category from product_lists.teams_id and the
  // list of already-mapped categories (for the "mapped" badge in the dropdown).
  app.get(
    '/grid/map-prefill/:productCode',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        ensurePermission(request, 'deliveries:map_products');
        const { productCode } = ProductCodeParam.parse(request.params);
        const data = await resolveMapPrefill(productCode);
        return { ok: true, data };
      } catch (err) {
        return handleError(err, reply);
      }
    }
  );

  app.post('/grid/map', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:map_products');
      const body = MapBody.parse(request.body);
      const smsUserId = await resolveSmsUserId(request);
      const result = await applyMapToZc(body, smsUserId);
      return { ok: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- SPECIAL ----
  app.get('/grid/special-state/:productCode', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:set_special');
      const { productCode } = ProductCodeParam.parse(request.params);
      const data = await getSpecialState(productCode);
      return { ok: true, data };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/grid/special', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:set_special');
      const body = SpecialBody.parse(request.body);
      const smsUserId = await resolveSmsUserId(request);
      const result = await applySetSpecial(body, smsUserId);
      return { ok: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.delete('/grid/special/:productCode', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:set_special');
      const { productCode } = ProductCodeParam.parse(request.params);
      const smsUserId = await resolveSmsUserId(request);
      const result = await applyClearSpecial(productCode, smsUserId);
      return { ok: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- ASSIGN FONT ----
  app.get('/grid/assign-font/:productCode', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:assign_fonts');
      const { productCode } = ProductCodeParam.parse(request.params);
      const data = await getAssignFontState(productCode);
      return { ok: true, data };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/grid/assign-font', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:assign_fonts');
      const body = AssignFontBody.parse(request.body);
      const smsUserId = await resolveSmsUserId(request);
      const result = await applyAssignFont(body, smsUserId);
      return { ok: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Searchable font dropdown source for the Assign Fonts dialog.
  // Reuses the same `assign_fonts` permission since this is only used inside
  // that flow.
  app.get('/grid/fonts/search', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:assign_fonts');
      const { q, limit } = z
        .object({
          q: z.string().trim().max(100).optional().default(''),
          limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        })
        .parse(request.query);
      const rows = await searchFonts(q, limit);
      return { ok: true, data: rows };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- EBAY ----
  app.get('/grid/ebay/:productCode', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:set_ebay');
      const { productCode } = ProductCodeParam.parse(request.params);
      const data = await getEbayState(productCode);
      return { ok: true, data };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/grid/ebay', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      ensurePermission(request, 'deliveries:set_ebay');
      const body = SetEbayBody.parse(request.body);
      const smsUserId = await resolveSmsUserId(request);
      const result = await applySetEbay(body, smsUserId);
      return { ok: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });
};
