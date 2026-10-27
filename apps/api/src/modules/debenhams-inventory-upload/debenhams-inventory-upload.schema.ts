/**
 * Debenhams Inventory Upload Zod Validation Schemas
 * @taskId #165096
 */

import { z } from 'zod';

export const SkippedRowSchema = z.object({
  row: z.number(),
  sku: z.string(),
  reason: z.string(),
});
export type SkippedRow = z.infer<typeof SkippedRowSchema>;

export const OfferErrorSchema = z.object({
  ean: z.string(),
  sku: z.string(),
  error: z.string(),
});
export type OfferError = z.infer<typeof OfferErrorSchema>;

export const UploadSummarySchema = z.object({
  totalRows: z.number(),
  inserted: z.number(),
  skippedInvalid: z.number(),
  skippedNotInNpv: z.number(),
  skippedDuplicates: z.number(),
  failedInserts: z.number(),
  offersCreated: z.number(),
  offersFailed: z.number(),
  processingTimeMs: z.number(),
});
export type UploadSummary = z.infer<typeof UploadSummarySchema>;

export const UploadResultSchema = z.object({
  summary: UploadSummarySchema,
  skippedRows: z.array(SkippedRowSchema),
  offerErrors: z.array(OfferErrorSchema),
  miraklImportIds: z.array(z.number()),
  downloadUrl: z.string(),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

export const DownloadFilenameParamsSchema = z.object({
  filename: z.string().regex(/^debenhams_offers_\d{15}\.csv$/, 'Invalid filename format'),
});
export type DownloadFilenameParams = z.infer<typeof DownloadFilenameParamsSchema>;
