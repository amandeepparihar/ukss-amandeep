import { FastifyPluginAsync } from "fastify";
import { FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "../../lib/logger";
import { fetchSportdealOrders } from "./sportdeal-order-service";
import { updateSportdealOrderStatusesToSportdeal } from "./sportdeal-status-update.service";

const logger = createLogger('sportdeal-order');

export const sportdealRoutes: FastifyPluginAsync = async (app) => {
    /**
     * Fetch Sportdeal Orders
     *
     * GET /api/sportdeal/getSportdealOrders
     * Fetch sportdeal orders using api
     */

    app.get('/getSportdealOrders', {
        preHandler: [app.authenticate]
    }, async (request: FastifyRequest, reply: FastifyReply) => {

        logger.info('Fetch Sportdeal Order Request Received from routes.');

        try {
            const result = await fetchSportdealOrders();

            if (result.success) {
                return reply.status(200).send({
                    message: 'Sportdeal orders fetched successfully',
                    data: result
                })
            } else {
                return reply.status(400).send({
                    error: {
                        code: 'FETCH_FAILED',
                        message: result.message || 'Failed to fetch sportdeal orders'
                    },
                    data: result
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch sportdeal orders';
            logger.error({ message }, 'Failed to fetch sportdeal orders');
            return reply.status(500).send({
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: error instanceof Error ? error.message : 'Failed to fetch sportdeal orders'
                }
            })
        }
    })

    /**
     * POST /api/sportdeal/updateOrderStatus
     * Push order status updates (Confirmed/Cancelled) to Sportdeal API.
     * Triggered manually from admin UI or via CLI cron.
     */
    app.post('/updateOrderStatus', {
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            logger.info('Update Sportdeal order statuses request received');

            const result = await updateSportdealOrderStatusesToSportdeal();

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
            logger.error({ error }, `Failed to update Sportdeal order statuses - message: ${message}`);
            return reply.status(500).send({
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message,
                }
            });
        }
    });
}
