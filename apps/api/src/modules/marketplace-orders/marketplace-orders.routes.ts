/**
 * Marketplace Orders to UKSS Orders Module Routes
 *
 * API endpoints for converting marketplace orders to UKSS orders
 */

import type { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ProcessOrdersSchema } from './marketplace-orders.schema';
import { processMarketplaceOrdersToUKSS } from './marketplace-orders.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger('marketplace-orders-routes');

export const marketplaceOrdersRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/marketplace-orders/process
   * Process pending marketplace orders and convert them to UKSS orders
   * 
   * This endpoint:
   * 1. Fetches pending marketplace orders (where mo_ukss_order_id IS NULL)
   * 2. Converts them to UKSS orders format
   * 3. Inserts into orders and orders_products tables
   * 4. Updates marketplace orders with UKSS order IDs
   * 
   * @body limit - Maximum number of orders to process (default: 100)
   *  app.requirePermission('orders:create')
   */
  app.post('/process', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      logger.info({ body: request.body }, 'Received request to process marketplace orders');

      const input = ProcessOrdersSchema.parse(request.body || {});
      
      logger.info({ 
        limit: input.limit, 
      }, 'Starting marketplace orders to UKSS processing');

      const result = await processMarketplaceOrdersToUKSS(input.limit);

      const duration = Date.now() - startTime;

      if (!result.success) {
        logger.warn({ 
          duration, 
          processed: result.processed, 
          failed: result.failed,
          error: result.error 
        }, 'Marketplace orders processing completed with errors');

        return reply.status(500).send({
          error: {
            code: 'PROCESSING_FAILED',
            message: result.error || 'Failed to process marketplace orders',
          },
          data: result,
        });
      }

      logger.info({ 
        duration, 
        processed: result.processed, 
        failed: result.failed 
      }, 'Marketplace orders processing completed successfully');

      return reply.status(200).send({
        data: result,
        message: `Processed ${result.processed} orders successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Failed to process orders';
      
      logger.error({ 
        error, 
        duration,
        body: request.body 
      }, 'Failed to process marketplace orders');

      if (error instanceof ZodError) {
        logger.warn({ 
          errors: error.errors 
        }, 'Request validation failed');

        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: message || 'Invalid request parameters',
            details: error.errors,
          },
        });
      }

      throw error;
    }
  });
};
