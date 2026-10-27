import { FastifyPluginAsync } from "fastify";
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createLogger } from "../../lib/logger";
import { fetchAllegroOrders } from "./allegro-order-service";
import { updateAllegroOrderStatusesToAllegro } from "./allegro-status-update.service";

const logger = createLogger('allegro-order');

const GetAllegroOrdersQuerySchema = z.object({
    orderId: z.string().optional(),
});

export const allegroRoutes: FastifyPluginAsync = async (app) => {
    /**
     * Fetch Allegro Orders
     *
     * GET /api/allegro/getAllegroOrders
     * GET /api/allegro/getAllegroOrders?orderId={checkoutFormId}
     * Fetch allegro orders using api
     */

    app.get('/getAllegroOrders', {
        preHandler: [app.authenticate]
    }, async (request: FastifyRequest, reply: FastifyReply) => {

        const { orderId } = GetAllegroOrdersQuerySchema.parse(request.query);
        logger.info({ orderId }, 'Fetch Allegro Order Request Received from routes.');

        try {
            const result = await fetchAllegroOrders(orderId);

            if (result.success) {
                return reply.status(200).send({
                    message: 'Allegro orders fetched successfully',
                    data: result
                })
            } else {
                return reply.status(400).send({
                    error: {
                        code: 'FETCH_FAILED',
                        message: result.message || 'Failed to fetch allegro orders'
                    },
                    data: result
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch allegro orders';
            logger.error({ message }, 'Failed to fetch allegro orders');
            return reply.status(500).send({
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: error instanceof Error ? error.message : 'Failed to fetch allegro orders'
                }
            })
        }
    })

    /**
     * POST /api/allegro/updateOrderStatus
     * Push order status updates (Shipped/Cancelled) to Allegro API.
     * Triggered manually from admin UI or via CLI cron.
     */
    app.post('/updateOrderStatus', {
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            logger.info('Update Allegro order statuses request received');

            const result = await updateAllegroOrderStatusesToAllegro();

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
            logger.error({ error }, `Failed to update Allegro order statuses - message: ${message}`);
            return reply.status(500).send({
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message,
                }
            });
        }
    });
}
