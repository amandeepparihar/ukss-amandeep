/**
 * Walmart Zod Validation Schemas
 *
 * Result shapes for Walmart order routes and CLI commands.
 */

import { z } from 'zod';

export const FetchWalmartOrderResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  ordersFound: z.number().default(0),
  ordersInserted: z.number().default(0),
  ordersSkipped: z.number().default(0),
  ordersFailed: z.number().default(0),
  errors: z
    .array(
      z.object({
        orderId: z.string(),
        error: z.string(),
      })
    )
    .default([]),
  duration: z.number().default(0),
});

export type FetchWalmartOrderResult = z.infer<typeof FetchWalmartOrderResultSchema>;

export const UpdateWalmartOrderStatusResultSchema = z.object({
  success: z.boolean(),
  mopId: z.number(),
  /** Lowercase action: 'acknowledged' | 'cancelled' | 'shipped' */
  status: z.string(),
  error: z.string().optional(),
});

export const BatchUpdateWalmartOrderStatusResultSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(UpdateWalmartOrderStatusResultSchema),
  error: z.string().optional(),
});

export type UpdateWalmartOrderStatusResult = z.infer<typeof UpdateWalmartOrderStatusResultSchema>;
export type BatchUpdateWalmartOrderStatusResult = z.infer<typeof BatchUpdateWalmartOrderStatusResultSchema>;
