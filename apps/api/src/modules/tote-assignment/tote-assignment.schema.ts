import { z } from 'zod';

export const OrderLookupParamSchema = z.object({
  orderId: z.coerce.number().int().positive(),
});
export type OrderLookupParam = z.infer<typeof OrderLookupParamSchema>;

export const BatchLookupParamSchema = z.object({
  batchName: z.string().trim().min(1).max(100),
});
export type BatchLookupParam = z.infer<typeof BatchLookupParamSchema>;

// refs: #165290 - orders_products.fc_batch_id is MySQL INT(11) signed,
// so valid range is 1..2147483647. Reject anything that can't round-trip
// into that column to prevent silent truncation / "Out of range" errors.
const INT11_SIGNED_MAX = 2147483647;

const fcBatchIdSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const raw = typeof v === 'number' ? String(v) : v.trim();
    if (raw === '' || !/^\d+$/.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FC Batch ID must be a whole number',
      });
      return z.NEVER;
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > INT11_SIGNED_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `FC Batch ID must be between 1 and ${INT11_SIGNED_MAX}`,
      });
      return z.NEVER;
    }
    return n;
  });

export const AssignOrderToteSchema = z.object({
  ordersId: z.coerce.number().int().positive(),
  ordersProductsIds: z.array(z.coerce.number().int().positive()).min(1),
  fcOrderId: z.string().trim().min(1).max(100),
  fcBatchId: fcBatchIdSchema,
  fcToteId: z.string().trim().min(1).max(100),
});
export type AssignOrderToteInput = z.infer<typeof AssignOrderToteSchema>;

export const AssignBatchToteSchema = z.object({
  mfoId: z.coerce.number().int().positive(),
  multipartToteId: z.string().trim().min(1).max(100),
});
export type AssignBatchToteInput = z.infer<typeof AssignBatchToteSchema>;
