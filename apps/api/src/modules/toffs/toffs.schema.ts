import { z } from 'zod';

export const UpdateToffsOrderStatusInputSchema = z.object({
    mopId: z.number().int().positive(),
    storeId: z.number().int().positive(),
    entity_id: z.string(),
    order_item_id: z.string(), // Can be comma-separated for personalized orders
    statusToUpdate: z.enum(['canceled', 'complete']),
    trackingNumber: z.string().optional(),
    trackingCompany: z.string().optional(),
    storeName: z.string().optional(),
    quantity: z.number().int().positive(),
});

export const UpdateToffsOrderStatusResultSchema = z.object({
    success: z.boolean(),
    mopId: z.number(),
    status: z.string(),
    error: z.string().optional(),
});

export const BatchUpdateToffsOrderStatusResultSchema = z.object({
    success: z.boolean(),
    processed: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    results: z.array(UpdateToffsOrderStatusResultSchema),
    error: z.string().optional(),
});

export type BatchUpdateToffsOrderStatusResult = z.infer<typeof BatchUpdateToffsOrderStatusResultSchema>;
export type UpdateToffsOrderStatusResult = z.infer<typeof UpdateToffsOrderStatusResultSchema>;
export type UpdateToffsOrderStatusInput = z.infer<typeof UpdateToffsOrderStatusInputSchema>;