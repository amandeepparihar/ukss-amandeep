import type { FastifyPluginAsync } from "fastify";
import { FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "../../lib/logger";
import { GetFruugoOrdersQuerySchema } from "./fruugo.schema";
import { getFruugoOrders } from "./fruugo-order-service";
import { updateFruugoOrderStatusesToFruugo } from "./fruugo-status-update-service";

const logger = createLogger('fruugo-routes');


export const fruugoRoutes: FastifyPluginAsync = async (app) => {
    app.get('/getFruugoOrders', {
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {

        logger.info('Getting Fruugo orders')

        try {
            let { staticFromTime, staticEndTime, lastSevenDays } = GetFruugoOrdersQuerySchema.parse(request.query);

            logger.info({ staticFromTime, staticEndTime, lastSevenDays }, 'Fruugo orders query parameters');

            if (lastSevenDays==='true') {
                const pastDate = new Date();
                pastDate.setDate(pastDate.getDate() - 7);
                // Convert to Unix timestamp (seconds since epoch) as expected by getFruugoOrders
                staticFromTime = Math.floor(pastDate.getTime() / 1000).toString();
                staticEndTime = Math.floor(Date.now() / 1000).toString();
                logger.info({ staticFromTime, staticEndTime, lastSevenDays }, 'Fruugo orders query parameters');
            }

            const result = await getFruugoOrders(staticFromTime, staticEndTime);

            return reply.status(200).send({ data: result });
        } catch (error) {
            logger.error({ error }, 'Failed to get Fruugo orders');
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal server error' });
        }
    })

    app.get('/updateFruugoOrderStatusesToFruugo', {
        preHandler: [app.authenticate],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        logger.info('Updating Fruugo order statuses to Fruugo');

        try {
            const result = await updateFruugoOrderStatusesToFruugo();

            if (!result.success) {
                return reply.status(500).send({
                    error: {
                        code: 'UPDATE_FAILED',
                        message: result.error || 'Failed to update Fruugo order statuses to Fruugo',
                    },
                    data: result,
                });
            }

            return reply.status(200).send({ data: result, message: `Processed ${result.processed} orders: ${result.succeeded} succeeded, ${result.failed} failed` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update Fruugo order statuses to Fruugo';
            logger.error({ error }, `Failed to update Fruugo order statuses to Fruugo - message: ${message}`);
            return reply.status(500).send({
                error: {
                    code: 'UPDATE_FAILED',
                    message: message || 'Failed to update Fruugo order statuses to Fruugo',
                },
            });
        }
    });
};