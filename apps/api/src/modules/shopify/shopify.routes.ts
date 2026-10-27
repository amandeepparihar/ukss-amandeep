/**
 * Shopify Module Routes
 *
 * API endpoints for Shopify store management and sync operations
 */

import type { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  FetchOrdersSchema,
  StoreIdNumericParamSchema,
} from './shopify.schema';
import { fetchShopifyOrders, updateOrderStatusesToShopify } from './shopify-orders.service';
import { createLogger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

const logger = createLogger('shopify-orders');

export const shopifyRoutes: FastifyPluginAsync = async (app) => {

  // ===========================================
  // Order Fetch Routes
  // ===========================================

  /**
   * POST /api/shopify/stores/:id/fetch-orders
   * Fetch orders from Shopify for a specific store
   *
   * @param id - Numeric store ID from StoreManagement table
   * @body fetchType - 'All' to fetch all orders, 'Partial' to fetch since last ID (default: 'Partial')
   */
  app.post('/stores/:id/fetch-orders', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = StoreIdNumericParamSchema.parse(request.params);
        const { fetchType } = FetchOrdersSchema.parse(request.body || {});

        logger.info({ storeId: id, fetchType }, 'Fetch orders request received');

        const result = await fetchShopifyOrders(id.toString(), fetchType);

        if (!result.success) {
          return reply.status(500).send({
            error: {
              code: 'FETCH_FAILED',
              message: result.error || 'Failed to fetch orders'
            },
            data: result,
          });
        }

        return reply.status(200).send({ data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch orders';
        logger.error({ error }, `Failed to fetch orders - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }

        throw error;
      }
  });

  // ===========================================
  // Order Status Update Routes
  // ===========================================

  /**
   * POST /api/shopify/update-order-statuses
   * Update order statuses (Fulfilled/Cancelled) to Shopify stores
   */
  app.post('/update-order-statuses', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('Update order statuses request received');

      const result = await updateOrderStatusesToShopify();

      if (!result.success) {
        return reply.status(500).send({
          error: {
            code: 'UPDATE_FAILED',
            message: result.error || 'Failed to update order statuses',
          },
          data: result,
        });
      }

      return reply.status(200).send({
        data: result,
        message: `Processed ${result.processed} orders: ${result.succeeded} succeeded, ${result.failed} failed`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update order statuses';
      logger.error({ error }, `Failed to update order statuses - message: ${message}`);
      throw error;
    }
  });

  // ===========================================
  // Store Management Routes
  // ===========================================

  /**
   * GET /api/shopify/stores
   * Get list of Shopify stores from StoreManagement table
   */
  app.get('/stores', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stores = await prisma.storeManagement.findMany({
        where: {
          smAppAccessToken: {
            not: '',
          },
        },
        select: {
          storeId: true,
          storeName: true,
          storeUrl: true,
        },
        orderBy: {
          storeName: 'asc',
        },
      });

      return reply.status(200).send({ data: stores });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch stores';
      logger.error({ error }, `Failed to fetch stores - message: ${message}`);
      throw error;
    }
  });
};