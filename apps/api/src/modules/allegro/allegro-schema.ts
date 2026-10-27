/**
 * Allegro Zod Validation Schemas
 *
 * Defines request/response shapes for Allegro API routes and CLI commands.
 */

import { z } from 'zod';

/**
 * Result of fetching orders from Allegro API.
 * Matches the shared FetchOrdersResult type from marketplaces/orders/types.ts.
 */
export const FetchAllegroOrderResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  ordersFound: z.number().default(0),
  ordersInserted: z.number().default(0),
  ordersSkipped: z.number().default(0),
  ordersFailed: z.number().default(0),
  errors: z.array(z.object({
    orderId: z.string(),
    error: z.string(),
  })).default([]),
  duration: z.number().default(0),
});

export type FetchAllegroOrderResult = z.infer<typeof FetchAllegroOrderResultSchema>;

// Status Update Types

export const UpdateAllegroOrderStatusInputSchema = z.object({
  mopId: z.number().int().positive(),
  orderId: z.string(),
  statusToUpdate: z.string(),
});

export const UpdateAllegroOrderStatusResultSchema = z.object({
  success: z.boolean(),
  mopId: z.number(),
  status: z.string(),
  error: z.string().optional(),
});

export const BatchUpdateAllegroOrderStatusResultSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(UpdateAllegroOrderStatusResultSchema),
  error: z.string().optional(),
});

export type UpdateAllegroOrderStatusInput = z.infer<typeof UpdateAllegroOrderStatusInputSchema>;
export type UpdateAllegroOrderStatusResult = z.infer<typeof UpdateAllegroOrderStatusResultSchema>;
export type BatchUpdateAllegroOrderStatusResult = z.infer<typeof BatchUpdateAllegroOrderStatusResultSchema>;
