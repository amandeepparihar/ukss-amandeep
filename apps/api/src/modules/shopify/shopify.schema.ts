/**
 * Shopify Module Schemas
 *
 * Zod validation schemas for Shopify store management and sync operations
 */

import { z } from 'zod';

// ===========================================
// Order Fetch Schemas
// ===========================================

export const FetchOrdersSchema = z.object({
  fetchType: z.enum(['All', 'Partial']).optional().default('Partial'),
});

export const StoreIdNumericParamSchema = z.object({
  id: z.coerce.number().int().positive(), // Numeric store ID from StoreManagement table
});

// ===========================================
// Service Result Schemas
// ===========================================

export const FetchOrdersResultSchema = z.object({
  success: z.boolean(),
  ordersFetched: z.number(),
  ordersProcessed: z.number(),
  error: z.string().optional(),
  lastOrderId: z.string().optional(),
});

export const TokenCredentialsSchema = z.object({
  ShopUrl: z.string(),
  ApiKey: z.string(),
  SharedSecret: z.string(),
  AccessToken: z.string(),
  StoreName: z.string(),
});

// ===========================================
// Order Status Update Schemas
// ===========================================

export const OrderStatusTypeSchema = z.enum(['Fulfilled', 'Cancelled']);

export const UpdateOrderStatusInputSchema = z.object({
  mopId: z.number().int().positive(),
  storeId: z.number().int().positive(),
  marketplaceOrderId: z.string(),
  marketplaceOrderProductId: z.string(), // Can be comma-separated for personalized orders
  statusToUpdate: OrderStatusTypeSchema,
  trackingNumber: z.string().optional(),
  trackingCompany: z.string().optional(),
  storeName: z.string().optional(),
});

export const UpdateOrderStatusResultSchema = z.object({
  success: z.boolean(),
  mopId: z.number(),
  status: z.string(),
  error: z.string().optional(),
});

export const BatchUpdateOrderStatusResultSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(UpdateOrderStatusResultSchema),
  error: z.string().optional(),
});

// ===========================================
// Type Exports
// ===========================================

export type FetchOrdersInput = z.infer<typeof FetchOrdersSchema>;
export type FetchOrdersResult = z.infer<typeof FetchOrdersResultSchema>;
export type TokenCredentials = z.infer<typeof TokenCredentialsSchema>;
export type OrderStatusType = z.infer<typeof OrderStatusTypeSchema>;
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusInputSchema>;
export type UpdateOrderStatusResult = z.infer<typeof UpdateOrderStatusResultSchema>;
export type BatchUpdateOrderStatusResult = z.infer<typeof BatchUpdateOrderStatusResultSchema>;