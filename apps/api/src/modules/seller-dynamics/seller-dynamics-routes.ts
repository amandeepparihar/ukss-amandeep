import { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '../../lib/logger';
import { fetchSdOrders } from './sd-order-service';
import { updateSdOrderStatuses } from './sd-status-update.service';

const logger = createLogger('seller-dynamics-order');

export const sellerDynamicsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/seller-dynamics/getSdOrders
   * Fetch Seller Dynamics orders and persist them to the marketplace order tables.
   */
  app.get(
    '/getSdOrders',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Fetch Seller Dynamics orders request received');

      try {
        const result = await fetchSdOrders();

        if (result.success) {
          return reply.status(200).send({
            message: 'Seller Dynamics orders fetched successfully',
            data: result,
          });
        }

        return reply.status(400).send({
          error: {
            code: 'FETCH_FAILED',
            message: result.message || 'Failed to fetch Seller Dynamics orders',
          },
          data: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch Seller Dynamics orders';
        logger.error({ message }, 'Failed to fetch Seller Dynamics orders');
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );

  /**
   * POST /api/seller-dynamics/updateOrderStatus
   * Push pending status updates (Shipped) to Seller Dynamics; email for cancel/reject.
   */
  app.post(
    '/updateOrderStatus',
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      logger.info('Update Seller Dynamics order statuses request received');

      try {
        const result = await updateSdOrderStatuses();

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
        logger.error({ error }, `Failed to update Seller Dynamics order statuses - message: ${message}`);
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message },
        });
      }
    }
  );
};
