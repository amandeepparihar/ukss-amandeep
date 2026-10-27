import type { FastifyPluginAsync } from "fastify";
import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createLogger } from "../../lib/logger";

const logger = createLogger('toffs-routes');

const GetToffsOrdersQuerySchema = z.object({
    orderId: z.string().optional(),
});
import { getToffsOrders, updateToffsOrderStatusesToToffs } from "./toffs-orders.service";

export const toffsRoutes: FastifyPluginAsync = async (app) => {
    /**
     * GET /api/toffs/getToffsOrders
     * Fetch orders from TOFFS (Magento2)
     */
    app.get('/getToffsOrders',{
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { orderId } = GetToffsOrdersQuerySchema.parse(request.query);
            const toffsOrdersResults = await getToffsOrders(orderId || '');

            return reply.status(200).send({ data: toffsOrdersResults });
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal server error' });
        }
    });

    /**
     * POST /api/toffs/update-order-statuses
     * Update order statuses (Shipped/Cancelled) to TOFFS (Magento2)
     */
    app.post('/update-order-statuses', {
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            logger.info('Update TOFFS order statuses request received');

            const result = await updateToffsOrderStatusesToToffs();

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
            logger.error({ error }, `Failed to update TOFFS order statuses - message: ${message}`);
            throw error;
        }
    });
};