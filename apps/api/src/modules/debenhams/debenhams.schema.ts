/**
 * Debenhams Zod Validation Schemas
 */

import { z } from 'zod';

/**
 * Query params for order fetch endpoint
 */
export const GetDebenhamsOrdersQuerySchema = z.object({
  orderId: z.string().optional(),
});

/**
 * Response schema for order fetch
 */
export const GetDebenhamsOrdersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  orderCount: z.number().optional(),
});

/**
 * Response schema for status update
 */
export const UpdateDebenhamsStatusResponseSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(z.object({
    mopId: z.number(),
    orderId: z.string(),
    status: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
});

// Export types
export type GetDebenhamsOrdersQuery = z.infer<typeof GetDebenhamsOrdersQuerySchema>;
export type GetDebenhamsOrdersResponse = z.infer<typeof GetDebenhamsOrdersResponseSchema>;
export type UpdateDebenhamsStatusResponse = z.infer<typeof UpdateDebenhamsStatusResponseSchema>;
