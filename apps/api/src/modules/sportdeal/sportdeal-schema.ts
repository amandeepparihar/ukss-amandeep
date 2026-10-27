/**
 * Sportdeal Zod Validation Schemas
 *
 * Defines request/response shapes for Sportdeal API routes and CLI commands.
 */

import { z } from 'zod';

/**
 * Result of fetching orders from Sportdeal API.
 * Matches the shared FetchOrdersResult type from marketplaces/orders/types.ts.
 */
export const FetchSportdealOrderResultSchema = z.object({
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

export type FetchSportdealOrderResult = z.infer<typeof FetchSportdealOrderResultSchema>;

// Status Update Types

export const UpdateSportdealOrderStatusInputSchema = z.object({
  mopId: z.number().int().positive(),
  orderId: z.string(),
  statusToUpdate: z.string(),
});

export const UpdateSportdealOrderStatusResultSchema = z.object({
  success: z.boolean(),
  mopId: z.number(),
  status: z.string(),
  error: z.string().optional(),
});

export const BatchUpdateSportdealOrderStatusResultSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(UpdateSportdealOrderStatusResultSchema),
  error: z.string().optional(),
});

export type UpdateSportdealOrderStatusInput = z.infer<typeof UpdateSportdealOrderStatusInputSchema>;
export type UpdateSportdealOrderStatusResult = z.infer<typeof UpdateSportdealOrderStatusResultSchema>;
export type BatchUpdateSportdealOrderStatusResult = z.infer<typeof BatchUpdateSportdealOrderStatusResultSchema>;
