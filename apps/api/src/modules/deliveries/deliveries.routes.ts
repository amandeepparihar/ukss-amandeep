/**
 * Deliveries module routes.
 *
 * Read endpoints (phase 1 — already live):
 *  - GET /api/deliveries              — paginated grid rows (spec §4)
 *  - GET /api/deliveries/teams        — team dropdown (spec §5.4)
 *  - GET /api/deliveries/countries    — country-of-origin dropdown
 *  - GET /api/deliveries/permissions  — 11 per-cell flags (spec §10)
 *
 * Write endpoints (phase 2 — see documentation/deliveries-write-path-plan.md):
 *  - PATCH /api/deliveries/cells                       — inline cell edits
 *  - PATCH /api/deliveries/image-added/:productCode    — toggle image-added flag
 *  - GET   /api/deliveries/image-urls/:productCode     — view URLs
 *  - POST  /api/deliveries/link-quantity/:productCode  — link / unlink / toggle
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DeliveryListQuerySchema } from './deliveries.schema';
import { getDeliveriesListing, getTeams, getCountries } from './deliveries.service';
import { deriveDeliveryPermissions } from './deliveries.permissions';
import { deliveriesWriteRoutes } from './deliveries.write.routes';
import { deliveriesProductFormRoutes } from './product-form.routes';
import { deliveriesGridActionsRoutes } from './grid-actions.routes';
import { printLabelRoutes } from './print-label.routes';

export const deliveriesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request, reply) => {
      try {
        const query = DeliveryListQuerySchema.parse(request.query);
        const result = await getDeliveriesListing(query);
        return result;
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({
            status: 'error',
            message: 'Invalid query parameters',
            details: err.errors,
          });
        }
        request.log.error(err, 'Deliveries listing query failed');
        return reply
          .status(500)
          .send({ status: 'error', message: 'Failed to load deliveries' });
      }
    }
  );

  app.get(
    '/teams',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request, reply) => {
      try {
        const teams = await getTeams();
        return { data: teams };
      } catch (err) {
        request.log.error(err, 'Teams dropdown query failed');
        return reply
          .status(500)
          .send({ status: 'error', message: 'Failed to load teams' });
      }
    }
  );

  app.get(
    '/countries',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request, reply) => {
      try {
        const countries = await getCountries();
        return { data: countries };
      } catch (err) {
        request.log.error(err, 'Countries dropdown query failed');
        return reply
          .status(500)
          .send({ status: 'error', message: 'Failed to load countries' });
      }
    }
  );

  app.get(
    '/permissions',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request) => {
      const permissions = deriveDeliveryPermissions(request.user.permissions ?? []);
      return { data: permissions };
    }
  );

  // Write-path routes (PATCH/POST). Registered as a child plugin so their
  // own preHandlers can choose per-endpoint authentication patterns — some
  // endpoints need `authenticate` only (column-dependent permission check),
  // others use `requirePermission` directly.
  await app.register(deliveriesWriteRoutes);
  await app.register(deliveriesProductFormRoutes);
  await app.register(deliveriesGridActionsRoutes);
  await app.register(printLabelRoutes);
};
