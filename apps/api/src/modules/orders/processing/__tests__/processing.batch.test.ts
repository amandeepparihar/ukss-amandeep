/**
 * Unit tests for mergeQueueOrder() — the pre-order-first queue ordering rule.
 *
 * Faithful to legacy order_processing_new.php: pre-orders (orders_status 12,
 * L129) are arranged FIRST, then the remaining eligible orders by date_added
 * (L360/374). An order that is both a pre-order and present in the remaining
 * set must appear once, in its pre-order position.
 */
import { describe, it, expect } from 'vitest';
import { mergeQueueOrder } from '../processing.batch';

describe('mergeQueueOrder — pre-order priority + dedup', () => {
  it('places pre-orders before the remaining queue', () => {
    expect(mergeQueueOrder([12, 7], [3, 5])).toEqual([12, 7, 3, 5]);
  });

  it('de-duplicates an order present in both lists, keeping the pre-order slot', () => {
    // 7 is a pre-order AND comes back in the remaining SELECT (status 0/4).
    expect(mergeQueueOrder([12, 7], [3, 7, 5])).toEqual([12, 7, 3, 5]);
  });

  it('returns only the remaining queue when there are no pre-orders', () => {
    expect(mergeQueueOrder([], [3, 5, 9])).toEqual([3, 5, 9]);
  });

  it('returns only pre-orders when the remaining queue is empty', () => {
    expect(mergeQueueOrder([12, 7], [])).toEqual([12, 7]);
  });

  it('preserves date_added ordering of the remaining queue', () => {
    // remaining arrives already ordered by date_added ASC from SQL.
    expect(mergeQueueOrder([], [100, 50, 75])).toEqual([100, 50, 75]);
  });

  it('handles duplicates within the remaining list itself', () => {
    expect(mergeQueueOrder([], [3, 3, 5])).toEqual([3, 5]);
  });

  it('returns an empty list when both inputs are empty', () => {
    expect(mergeQueueOrder([], [])).toEqual([]);
  });
});
