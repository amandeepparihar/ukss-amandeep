import { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '../../lib/logger';
import { fetchWalmartOrders } from './walmart-order-service';
import { updateWalmartOrderStatusesToWalmart } from './walmart-status-update.service';

const logger = createLogger('walmart-order');

export const walmartRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/walmart/getWalmartOrders
   * Fetch Walmart orders (status=Created) and persist them to the marketplace order tables.
   */
  app.get(
    '/getWalmartOrders',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Fetch Walmart orders request received');

      try {
        const result = await fetchWalmartOrders();

        if (result.success) {
          return reply.status(200).send({
            message: 'Walmart orders fetched successfully',
            data: result,
          });
        }

        return reply.status(400).send({
          error: {
            code: 'FETCH_FAILED',
            message: result.message || 'Failed to fetch Walmart orders',
          },
          data: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch Walmart orders';
        logger.error({ message }, 'Failed to fetch Walmart orders');
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );

  /**
   * POST /api/walmart/updateOrderStatus
   * Push pending status updates (Confirmed / Shipped / Cancelled) to Walmart.
   */
  app.post(
    '/updateOrderStatus',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Update Walmart order statuses request received');

      try {
        const result = await updateWalmartOrderStatusesToWalmart();

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
        logger.error({ error }, `Failed to update Walmart order statuses - message: ${message}`);
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );
};
