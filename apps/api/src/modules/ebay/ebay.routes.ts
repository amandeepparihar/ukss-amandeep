/**
 * eBay API Routes
 *
 * HTTP endpoints for eBay marketplace operations.
 */

import type { FastifyPluginAsync } from 'fastify';
import { createLogger } from '../../lib/logger';
import { fetchEbayOrders } from './ebay-order-service';
import { updateEbayOrderStatusesToEbay } from './ebay-status-update.service';

const logger = createLogger('ebay-routes');

export const ebayRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/ebay/getEbayOrders
   * Fetch orders from eBay Trading API into marketplace order tables
   * (same as CLI: pnpm cli ebay fetch-orders)
   */
  app.get('/getEbayOrders', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (_request, reply) => {
    logger.info('Fetch eBay orders request received');

    try {
      const result = await fetchEbayOrders();

      if (result.success) {
        return reply.status(200).send({
          message: 'eBay orders fetched successfully',
          data: result,
        });
      }

      return reply.status(400).send({
        error: {
          code: 'FETCH_FAILED',
          message: result.message || 'Failed to fetch eBay orders',
        },
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch eBay orders';
      logger.error({ message }, 'Failed to fetch eBay orders');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message,
        },
      });
    }
  });

  /**
   * POST /api/ebay/update-status
   * Push order status updates to eBay Trading API
   */
  app.post('/update-status', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (_request, reply) => {
    try {
      const result = await updateEbayOrderStatusesToEbay();
      const withOptionalError = result as typeof result & { error?: string };

      if (result.success) {
        return reply.status(200).send({
          status: 'success',
          message: 'eBay status update completed',
          data: {
            processed: result.processed,
            succeeded: result.succeeded,
            failed: result.failed,
            duration: result.duration,
            results: result.results,
          },
        });
      } else {
        return reply.status(500).send({
          status: 'error',
          message: withOptionalError.error || 'Status update failed',
          data: {
            processed: result.processed,
            succeeded: result.succeeded,
            failed: result.failed,
            duration: result.duration,
            results: result.results,
          },
        });
      }
    } catch (error) {
      const err = error as Error;
      return reply.status(500).send({
        status: 'error',
        message: err.message,
      });
    }
  });
};
