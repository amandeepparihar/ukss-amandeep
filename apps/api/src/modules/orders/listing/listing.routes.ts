/**
 * Orders listing routes — paginated listing, tabs, alerts, stores.
 * Requirements: REQ-02-001 (page layout), REQ-02-006-023 (filters, search, pagination),
 *   REQ-02-017 (tabs), REQ-02-002-005 (alerts), REQ-02-007 (stores)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrderListQuerySchema, OrderTabCountsQuerySchema } from '../orders.schema';
import {
  getOrderListing,
  getTabCounts,
  getStores,
  getFilterCategories,
  getFilterProducts,
  getFilterSizes,
} from './listing.service';
import { getOrderAlerts } from './listing.alerts';

const categoryIdSchema = z.object({ categoryId: z.coerce.number().int().positive() });
const productIdSchema = z.object({ productId: z.coerce.number().int().positive() });

export const listingRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/orders — Order listing with server-side pagination.
   * REQ-02-021: Priority-based query assembly with filters.
   * REQ-02-022: Post-query modifications (date interval, order type, sorting).
   * REQ-02-023: Pagination via LIMIT/OFFSET.
   */
  app.get('/', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const query = OrderListQuerySchema.parse(request.query);

      // REQ-02-014: Order ID search redirects to edit page
      if (query.orderId) {
        return { data: { redirect: `/orders/${query.orderId}` } };
      }

      const result = await getOrderListing(query);
      return result;
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ status: 'error', message: 'Invalid query parameters', details: err.errors });
      }
      request.log.error(err, 'Order listing query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load orders' });
    }
  });

  /**
   * GET /api/orders/tabs — Tab counts for ship-by-date filtering.
   * REQ-02-017: Five tabs with counts.
   */
  app.get('/tabs', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const query = OrderTabCountsQuerySchema.parse(request.query);
      const counts = await getTabCounts(query);
      return { data: counts };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ status: 'error', message: 'Invalid query parameters', details: err.errors });
      }
      request.log.error(err, 'Tab counts query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load tab counts' });
    }
  });

  /**
   * GET /api/orders/alerts — Marketplace alerts and FC status panels.
   * REQ-02-002 through REQ-02-005.
   * REQ-02-024: Alerts execute independently, don't block listing.
   */
  app.get('/alerts', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const alerts = await getOrderAlerts();
      return { data: alerts };
    } catch (err) {
      request.log.error(err, 'Alerts query failed');
      // REQ-02-025: Alert failure doesn't block the page
      return {
        data: {
          amazon: {
            uk: { lateShipments: [], expectedLateOrange: [], expectedLateYellow: [] },
            us: { lateShipments: [], avoidableLate: [], expectedLate: [] },
          },
          fc: { errorOrders: 0, manualPending: 0 },
        },
      };
    }
  });

  /**
   * GET /api/orders/stores — Store/seller dropdown data.
   * REQ-02-007: Stores from DB + hardcoded entries.
   */
  app.get('/stores', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const stores = await getStores();
      return { data: stores };
    } catch (err) {
      request.log.error(err, 'Stores query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load stores' });
    }
  });

  /**
   * GET /api/orders/filter/categories — all categories for the Filter Products cascade.
   */
  app.get('/filter/categories', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const data = await getFilterCategories();
      return { data };
    } catch (err) {
      request.log.error(err, 'Filter categories query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load filter categories' });
    }
  });

  /**
   * GET /api/orders/filter/products?categoryId=<n> — products in a category.
   */
  app.get('/filter/products', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const { categoryId } = categoryIdSchema.parse(request.query);
      const data = await getFilterProducts(categoryId);
      return { data };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ status: 'error', message: 'categoryId must be a positive integer', details: err.errors });
      }
      request.log.error(err, 'Filter products query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load filter products' });
    }
  });

  /**
   * GET /api/orders/filter/sizes?productId=<n> — sizes for a specific product.
   */
  app.get('/filter/sizes', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request, reply) => {
    try {
      const { productId } = productIdSchema.parse(request.query);
      const data = await getFilterSizes(productId);
      return { data };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ status: 'error', message: 'productId must be a positive integer', details: err.errors });
      }
      request.log.error(err, 'Filter sizes query failed');
      return reply.status(500).send({ status: 'error', message: 'Failed to load filter sizes' });
    }
  });
};
