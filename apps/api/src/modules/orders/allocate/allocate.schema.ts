import { z } from 'zod';

export const createSupplierOrderSchema = z.object({
  supplierId: z.number().int().positive(),
  orderProductIds: z.array(z.number().int().positive()).min(1),
  quantity: z.number().int().min(1),
});

export type CreateSupplierOrderInput = z.infer<typeof createSupplierOrderSchema>;
