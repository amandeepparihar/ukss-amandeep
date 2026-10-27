/**
 * Pure row-to-type mappers for allocate queries.
 * Kept separate so they can be unit-tested without a DB connection.
 */

import type { SupplierOption } from './allocate.types';

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/**
 * Map a raw `suppliers` row to a typed SupplierOption.
 * Handles BigInt coercion (MySQL COUNT returns BigInt) and null manufacturer_id.
 */
export function mapSupplierRow(row: {
  suppliers_id: bigint | number;
  suppliers_name: string;
  manufacturer_id: bigint | number | null;
}): SupplierOption {
  return {
    id: n(row.suppliers_id),
    name: row.suppliers_name,
    manufacturerId: row.manufacturer_id == null ? null : n(row.manufacturer_id),
  };
}
