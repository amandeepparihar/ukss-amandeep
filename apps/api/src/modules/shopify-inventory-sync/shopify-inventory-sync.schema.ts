/**
 * Shopify Inventory Sync Zod Validation Schemas
 */

import { z } from 'zod';

export const StoreInfoSchema = z.object({
  storeId: z.number(),
  storeName: z.string(),
  hasExportFile: z.boolean(),
  fileName: z.string().optional(),
  fileModified: z.string().optional(),
});
export type StoreInfo = z.infer<typeof StoreInfoSchema>;

export const MismatchRowSchema = z.object({
  productId: z.number(),
  variantId: z.number(),
  excelQty: z.number(),
  dbQty: z.number(),
  diff: z.number(),
});
export type MismatchRow = z.infer<typeof MismatchRowSchema>;

export const CompareResultSchema = z.object({
  storeId: z.number(),
  storeName: z.string(),
  fileName: z.string(),
  totalExcelRows: z.number(),
  matched: z.number(),
  skipped: z.number(),
  mismatches: z.array(MismatchRowSchema),
  notFound: z.array(z.object({ productId: z.number(), variantId: z.number() })),
  processingTimeMs: z.number(),
});
export type CompareResult = z.infer<typeof CompareResultSchema>;

export const CompareRequestSchema = z.object({
  storeId: z.number(),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

export const ApplyUpdatesRequestSchema = z.object({
  storeId: z.number(),
  updates: z.array(z.object({
    variantId: z.number(),
    newQty: z.number(),
  })),
});
export type ApplyUpdatesRequest = z.infer<typeof ApplyUpdatesRequestSchema>;

export const ApplyUpdatesResultSchema = z.object({
  updated: z.number(),
  failed: z.number(),
  errors: z.array(z.object({ variantId: z.number(), error: z.string() })),
  processingTimeMs: z.number(),
});
export type ApplyUpdatesResult = z.infer<typeof ApplyUpdatesResultSchema>;
