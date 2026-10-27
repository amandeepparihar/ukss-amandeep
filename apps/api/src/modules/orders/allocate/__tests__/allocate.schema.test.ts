import { describe, it, expect } from 'vitest';
import { createSupplierOrderSchema } from '../allocate.schema';

describe('createSupplierOrderSchema', () => {
  it('accepts a valid payload', () => {
    const r = createSupplierOrderSchema.safeParse({ supplierId: 12, orderProductIds: [34, 56], quantity: 2 });
    expect(r.success).toBe(true);
  });
  it('rejects supplierId <= 0', () => {
    expect(createSupplierOrderSchema.safeParse({ supplierId: 0, orderProductIds: [1], quantity: 1 }).success).toBe(false);
  });
  it('rejects empty orderProductIds', () => {
    expect(createSupplierOrderSchema.safeParse({ supplierId: 1, orderProductIds: [], quantity: 1 }).success).toBe(false);
  });
  it('rejects quantity < 1', () => {
    expect(createSupplierOrderSchema.safeParse({ supplierId: 1, orderProductIds: [1], quantity: 0 }).success).toBe(false);
  });
});
