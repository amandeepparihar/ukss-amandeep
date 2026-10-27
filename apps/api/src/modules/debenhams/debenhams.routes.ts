/**
 * Debenhams HTTP Routes
 *
 * Provides REST endpoints for Debenhams marketplace integration.
 */

import type { FastifyPluginAsync } from 'fastify';
import { createLogger } from '../../lib/logger';
import { getDebenhamsOrders } from './debenhams-orders.service';
import { updateDebenhamsOrderStatuses } from './debenhams-status-update.service';
import type { GetDebenhamsOrdersQuery } from './debenhams.schema';

const logger = createLogger('debenhams-routes');

export const debenhamsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/debenhams/getOrders
   *
   * Fetch orders from Debenhams API and save to database.
   * Optionally fetch a specific order by ID.
   */
  app.get<{ Querystring: GetDebenhamsOrdersQuery }>('/getOrders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    logger.info('Fetching Debenhams orders via HTTP');

    try {
      const { orderId } = request.query;
      const result = await getDebenhamsOrders(orderId);

      return reply.status(200).send({
        data: result,
        message: result.success
          ? `Successfully processed ${result.orderCount || 0} orders`
          : result.message,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Debenhams orders');
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  });

  /**
   * GET /api/debenhams/updateStatuses
   *
   * Push pending status updates (Ship/Cancel) to Debenhams API.
   */
  app.get('/updateStatuses', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    logger.info('Updating Debenhams order statuses via HTTP');

    try {
      const result = await updateDebenhamsOrderStatuses();

      return reply.status(200).send({
        data: result,
        message: `Processed ${result.processed} orders: ${result.succeeded} succeeded, ${result.failed} failed`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to update Debenhams order statuses');
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  });
};
