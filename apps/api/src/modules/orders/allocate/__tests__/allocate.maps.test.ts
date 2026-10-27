import { describe, it, expect } from 'vitest';
import { mapSupplierRow } from '../allocate.maps';

describe('mapSupplierRow', () => {
  it('maps a raw suppliers row to a SupplierOption', () => {
    expect(mapSupplierRow({ suppliers_id: 7n, suppliers_name: 'Fans Culture', manufacturer_id: 82n }))
      .toEqual({ id: 7, name: 'Fans Culture', manufacturerId: 82 });
  });
  it('coerces null manufacturer_id', () => {
    expect(mapSupplierRow({ suppliers_id: 7, suppliers_name: 'X', manufacturer_id: null }).manufacturerId).toBeNull();
  });
});
