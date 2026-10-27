/**
 * OnBuy Zod Validation Schemas
 *
 * Defines result shapes for OnBuy order routes and CLI commands.
 */

import { z } from 'zod';

export const FetchOnbuyOrderResultSchema = z.object({
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

export type FetchOnbuyOrderResult = z.infer<typeof FetchOnbuyOrderResultSchema>;

export const UpdateOnbuyOrderStatusResultSchema = z.object({
  success: z.boolean(),
  mopId: z.number(),
  status: z.string(),
  error: z.string().optional(),
});

export const BatchUpdateOnbuyOrderStatusResultSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(UpdateOnbuyOrderStatusResultSchema),
  error: z.string().optional(),
});

export type UpdateOnbuyOrderStatusResult = z.infer<typeof UpdateOnbuyOrderStatusResultSchema>;
export type BatchUpdateOnbuyOrderStatusResult = z.infer<typeof BatchUpdateOnbuyOrderStatusResultSchema>;
