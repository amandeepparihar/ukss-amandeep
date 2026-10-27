/**
 * Order Status Sync Module Schemas
 *
 * Zod validation schemas for syncing marketplace order statuses from UKSS
 */

import { z } from 'zod';

// ===========================================
// Status Sync Schemas
// ===========================================

export const SyncOrderStatusSchema = z.object({
  limit: z.coerce.number().int().positive().optional().default(100),
});

// ===========================================
// Type Exports
// ===========================================

export type SyncOrderStatusInput = z.infer<typeof SyncOrderStatusSchema>;
