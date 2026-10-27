import { describe, it, expect } from 'vitest';
import { classifyMessage, assembleRows } from '../shopify-sync.query';

describe('classifyMessage', () => {
  it('buckets the known Shopify error strings', () => {
    expect(classifyMessage('The specified inventory item could not be found.'))
      .toBe('could_not_be_found');
    expect(classifyMessage("Invalid global id 'gid://shopify/Location/'"))
      .toBe('invalid_location');
    expect(classifyMessage('Throttled')).toBe('throttled');
    expect(classifyMessage('Status Code - 429')).toBe('throttled');
    expect(classifyMessage('Some other error')).toBe('other');
  });
});

describe('assembleRows', () => {
  const now = new Date('2026-06-19T18:00:00Z');

  it('includes a Shopify store with zero log rows as stale', () => {
    const rows = assembleRows({
      now, windowHours: 24,
      stores: [{ store_id: 999, store_name: 'Quiet Store' }],
      agg: [], distinct: [], onset: [], buckets: [], trend: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storeId: 999, lastRunAt: null, isStale: true,
      successTotal: 0, failureTotal: 0, successRate: 0,
      distinctFailingItems: 0, failingSince: null,
    });
  });

  it('pivots counts, rate, distinct items and onset for a failing store', () => {
    const rows = assembleRows({
      now, windowHours: 24,
      stores: [{ store_id: 142, store_name: 'Mystery' }],
      agg: [
        { store_id: 142, sth_update_type: 'inventory', sth_status: 'success', cnt: 100, max_at: '2026-06-19 17:50:00' },
        { store_id: 142, sth_update_type: 'inventory', sth_status: 'failure', cnt: 50,  max_at: '2026-06-19 17:58:00' },
      ],
      distinct: [{ store_id: 142, distinct_failing_items: 7 }],
      onset: [{ store_id: 142, failing_since: '2026-06-19 16:00:00' }],
      buckets: [{ store_id: 142, sth_message: 'The specified inventory item could not be found.', cnt: 50 }],
      trend: [{ store_id: 142, hr: '2026-06-19 17:00', fails: 50, oks: 100 }],
    });
    const r = rows[0];
    expect(r.successTotal).toBe(100);
    expect(r.failureTotal).toBe(50);
    expect(r.successRate).toBe(66.7); // 100/150
    expect(r.distinctFailingItems).toBe(7);
    expect(r.failingSince).toBe('2026-06-19T16:00:00.000Z'); // input datetime treated as UTC by parseUtc
    expect(r.isStale).toBe(false); // last run 17:58 < 120 min before 18:00
    expect(r.errorBuckets[0]).toMatchObject({ key: 'could_not_be_found', count: 50 });
    expect(r.byType.find((t) => t.type === 'inventory')).toMatchObject({ success: 100, failure: 50 });
    expect(r.trend).toHaveLength(1);
  });

  it('sorts worst-first (failing stores above healthy)', () => {
    const rows = assembleRows({
      now, windowHours: 24,
      stores: [
        { store_id: 1, store_name: 'Healthy' },
        { store_id: 2, store_name: 'Broken' },
      ],
      agg: [
        { store_id: 1, sth_update_type: 'inventory', sth_status: 'success', cnt: 10, max_at: '2026-06-19 17:59:00' },
        { store_id: 2, sth_update_type: 'inventory', sth_status: 'failure', cnt: 99, max_at: '2026-06-19 17:59:00' },
      ],
      distinct: [{ store_id: 2, distinct_failing_items: 40 }],
      onset: [{ store_id: 2, failing_since: '2026-06-19 10:00:00' }],
      buckets: [], trend: [],
    });
    expect(rows.map((r) => r.storeId)).toEqual([2, 1]);
  });
});
