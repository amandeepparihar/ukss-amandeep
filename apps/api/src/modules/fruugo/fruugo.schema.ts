import { z } from "zod";

export const GetFruugoOrdersQuerySchema = z.object({
    staticFromTime: z.string().optional(),
    staticEndTime: z.string().optional(),
    lastSevenDays: z.string().optional(),
});

export const UpdateFruugoOrderStatusInputSchema = z.object({
    mopId: z.number(),
    storeId: z.number(),
    mopOrderId: z.string(),
    mopOrderProductId: z.string(),
    quantityOfOrderProduct: z.number(),
    cancelReason: z.string(),
    mopSkuId: z.string(),
    status: z.string(),
    trackingNo: z.string().optional(),
    trackingCompany: z.string().optional(),
});

export const UpdateFruugoOrderStatusResultSchema = z.object({
    success: z.boolean(),
    mopId: z.number(),
    status: z.string(),
    error: z.string().optional(),
});

export const BatchUpdateFruugoOrderStatusResultSchema = z.object({
    success: z.boolean(),
    processed: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    results: z.array(UpdateFruugoOrderStatusResultSchema),
    error: z.string().optional(),
});

export type BatchUpdateFruugoOrderStatusResult = z.infer<typeof BatchUpdateFruugoOrderStatusResultSchema>;
export type UpdateFruugoOrderStatusInput = z.infer<typeof UpdateFruugoOrderStatusInputSchema>;
export type UpdateFruugoOrderStatusResult = z.infer<typeof UpdateFruugoOrderStatusResultSchema>;
export type GetFruugoOrdersQuery = z.infer<typeof GetFruugoOrdersQuerySchema>;