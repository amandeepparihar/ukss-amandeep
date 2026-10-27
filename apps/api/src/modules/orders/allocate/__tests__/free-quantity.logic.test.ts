/**
 * Unit tests for the pure supplier free-quantity arithmetic.
 * Faithful to legacy common_orders_operations.php airo_placed_and_open_order():
 *   free_quantity (raw) = COUNT(product_id) - COUNT(order_id)
 *   total_free_quantity = free_quantity - restricted   (PM 131725 comment lock)
 *   assigned            = total_quantity - free_quantity (raw)
 */
import { describe, it, expect } from 'vitest';
import {
  parseOrderIds,
  summariseFreeQuantity,
  type FreeQuantityAggregate,
} from '../free-quantity.logic';

describe('parseOrderIds', () => {
  it('returns [] for null/empty', () => {
    expect(parseOrderIds(null)).toEqual([]);
    expect(parseOrderIds('')).toEqual([]);
    expect(parseOrderIds(undefined)).toEqual([]);
  });

  it('parses a comma-separated GROUP_CONCAT list', () => {
    expect(parseOrderIds('1980980,1981122,1981132')).toEqual([1980980, 1981122, 1981132]);
  });

  it('trims whitespace and preserves duplicates (matches legacy display)', () => {
    expect(parseOrderIds('100, 100, 250')).toEqual([100, 100, 250]);
  });

  it('drops non-numeric fragments', () => {
    expect(parseOrderIds('100,,abc,250')).toEqual([100, 250]);
  });
});

describe('summariseFreeQuantity', () => {
  it('returns null when nothing matched (total_quantity 0)', () => {
    const agg: FreeQuantityAggregate = {
      totalQuantity: 0,
      freeRawQuantity: 0,
      restrictedQuantity: 0,
      orderIdsConcat: null,
    };
    expect(summariseFreeQuantity(agg)).toBeNull();
  });

  it('all free, none assigned, none restricted (fixture product 192920: 43/43)', () => {
    const agg: FreeQuantityAggregate = {
      totalQuantity: 43,
      freeRawQuantity: 43,
      restrictedQuantity: 0,
      orderIdsConcat: null,
    };
    expect(summariseFreeQuantity(agg)).toEqual({
      totalQuantity: 43,
      assignedQuantity: 0,
      freeQuantity: 43,
      restrictedQuantity: 0,
      orderIds: [],
      supplierOrderNumber: null,
    });
  });

  it('mix of assigned and free with no restriction', () => {
    // 10 total, 4 assigned to two orders, 6 free.
    const agg: FreeQuantityAggregate = {
      totalQuantity: 10,
      freeRawQuantity: 6,
      restrictedQuantity: 0,
      orderIdsConcat: '500,500,777,777',
    };
    expect(summariseFreeQuantity(agg)).toEqual({
      totalQuantity: 10,
      assignedQuantity: 4,
      freeQuantity: 6,
      restrictedQuantity: 0,
      orderIds: [500, 500, 777, 777],
      supplierOrderNumber: null,
    });
  });

  it('subtracts comment-locked (restricted) rows from free quantity (PM 131725)', () => {
    // 10 total, 2 assigned, 8 free raw, 3 locked by size comment → 5 truly free.
    const agg: FreeQuantityAggregate = {
      totalQuantity: 10,
      freeRawQuantity: 8,
      restrictedQuantity: 3,
      orderIdsConcat: '900,901',
    };
    const result = summariseFreeQuantity(agg);
    expect(result).not.toBeNull();
    expect(result!.assignedQuantity).toBe(2);
    expect(result!.freeQuantity).toBe(5);
    expect(result!.restrictedQuantity).toBe(3);
  });

  it('carries the supplier order number through for the placed bucket', () => {
    const agg: FreeQuantityAggregate = {
      totalQuantity: 5,
      freeRawQuantity: 2,
      restrictedQuantity: 0,
      orderIdsConcat: '1,2,3',
      supplierOrderNumber: 'SO-12345',
    };
    expect(summariseFreeQuantity(agg)?.supplierOrderNumber).toBe('SO-12345');
  });

  it('can yield negative free quantity when restrictions exceed raw free (faithful to legacy subtraction)', () => {
    // Legacy does a plain subtraction with no floor; preserve that behaviour so
    // the UI surfaces the same numbers and we do not silently mask data issues.
    const agg: FreeQuantityAggregate = {
      totalQuantity: 4,
      freeRawQuantity: 1,
      restrictedQuantity: 3,
      orderIdsConcat: null,
    };
    expect(summariseFreeQuantity(agg)?.freeQuantity).toBe(-2);
  });
});
