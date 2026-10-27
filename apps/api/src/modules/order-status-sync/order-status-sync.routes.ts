/**
 * Order Status Sync Module Routes
 *
 * API endpoints for syncing marketplace order statuses from UKSS
 */

import type { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { SyncOrderStatusSchema } from './order-status-sync.schema';
import { syncMarketplaceOrderStatus } from './order-status-sync.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger('order-status-sync-routes');

export const orderStatusSyncRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/order-status-sync/sync
   * Sync marketplace order statuses from UKSS orders
   *
   * This endpoint:
   * 1. Fetches order products that need status sync
   * 2. Checks UKSS order status and maps to marketplace status
   * 3. Updates marketplace order statuses (Confirmed, Shipped, Return, Cancelled)
   * 4. Creates status history records
   *
   * @body limit - Maximum number of orders to process (default: 100)
   * @body dryRun - If true, validates but doesn't update (default: false)
   */
  app.post('/sync', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = SyncOrderStatusSchema.parse(request.body || {});

      logger.info({ limit: input.limit}, 'Syncing marketplace order statuses');

      const result = await syncMarketplaceOrderStatus(input.limit);

      if (!result.success) {
        return reply.status(500).send({
          error: {
            code: 'SYNC_FAILED',
            message: result.error || 'Failed to sync marketplace order statuses',
          },
          data: result,
        });
      }

      return reply.status(200).send({
        data: result,
        message: `Processed ${result.processed} orders: ${result.confirmed} confirmed, ${result.shipped} shipped, ${result.returned} returned, ${result.cancelled} cancelled${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync order statuses';
      logger.error({ error }, 'Failed to sync marketplace order statuses');

      if (error instanceof ZodError) {
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
