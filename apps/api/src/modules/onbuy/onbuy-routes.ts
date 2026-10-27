import { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '../../lib/logger';
import { fetchOnbuyOrders } from './onbuy-order-service';
import { updateOnbuyOrderStatusesToOnbuy } from './onbuy-status-update.service';

const logger = createLogger('onbuy-order');

export const onbuyRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/onbuy/getOnbuyOrders
   * Fetch OnBuy orders and persist them to the marketplace order tables.
   */
  app.get(
    '/getOnbuyOrders',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Fetch OnBuy orders request received');

      try {
        const result = await fetchOnbuyOrders();

        if (result.success) {
          return reply.status(200).send({
            message: 'OnBuy orders fetched successfully',
            data: result,
          });
        }

        return reply.status(400).send({
          error: {
            code: 'FETCH_FAILED',
            message: result.message || 'Failed to fetch OnBuy orders',
          },
          data: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch OnBuy orders';
        logger.error({ message }, 'Failed to fetch OnBuy orders');
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );

  /**
   * POST /api/onbuy/updateOrderStatus
   * Push pending status updates (Shipped/Cancelled) to OnBuy.
   */
  app.post(
    '/updateOrderStatus',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Update OnBuy order statuses request received');

      try {
        const result = await updateOnbuyOrderStatusesToOnbuy();

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
        logger.error({ error }, `Failed to update OnBuy order statuses - message: ${message}`);
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );
};
