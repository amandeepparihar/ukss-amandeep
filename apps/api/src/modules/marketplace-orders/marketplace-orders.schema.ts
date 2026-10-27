/**
 * Marketplace Orders to UKSS Orders Module Schemas
 *
 * Zod validation schemas for converting marketplace orders to UKSS orders
 */

import { z } from 'zod';

// ===========================================
// Order Conversion Schemas
// ===========================================

export const ProcessOrdersSchema = z.object({
  limit: z.coerce.number().int().positive().optional().default(100)
});

// ===========================================
// Type Exports
// ===========================================

export type ProcessOrdersInput = z.infer<typeof ProcessOrdersSchema>;
