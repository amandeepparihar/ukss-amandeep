/**
 * Marketplace Sync Routes
 * 
 * HTTP endpoints for triggering marketplace inventory and price sync
 */

import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as marketplaceSyncService from './marketplace-sync.service';
import { runWithExecution, getLogger } from '../../lib/logger-context';

// Schema for store ID parameter
const StoreIdParamSchema = z.object({
  storeId: z.coerce.number().int().positive(),
});

export const marketplaceSyncRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/marketplace_listings/syncStoreInventory/:storeId
   * 
   * Trigger marketplace sync for a specific store
   * 
   * NO AUTHENTICATION REQUIRED - Designed for cron job access
   * 
   * Returns plain text summary
   */
  app.get('/syncStoreInventory/:storeId', async (request: FastifyRequest, reply: FastifyReply) => {
    // Run entire handler within execution context (including validation)
    return runWithExecution('marketplace-sync', async () => {
      try {
        // Validation happens INSIDE execution context for proper logging
        const { storeId } = StoreIdParamSchema.parse(request.params);
        
        const result = await marketplaceSyncService.syncStoreInventory(storeId);

        // Return plain text response
        reply.type('text/plain');
        return result.message;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Log ALL errors (including validation) with executionId from context
        getLogger().error({ error, params: request.params }, 'Marketplace sync failed');

        // Return appropriate status: 400 for validation errors, 500 for sync errors
        const statusCode = error instanceof z.ZodError ? 400 : 500;
        reply.type('text/plain').status(statusCode);
        return `Marketplace Sync Failed\nError: ${errorMessage}`;
      }
    });
  });

};
