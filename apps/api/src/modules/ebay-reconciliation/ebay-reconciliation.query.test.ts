import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { buildItemsWhere, buildOrderBy } from './ebay-reconciliation.query';

describe('buildItemsWhere', () => {
  it('always scopes to the run', () => {
    const { where, values } = buildItemsWhere({ runId: 5 });
    expect(where).toContain('r.run_id = ?');
    expect(values).toEqual([5]);
  });

  it('adds category IN with one placeholder per value', () => {
    const { where, values } = buildItemsWhere({ runId: 5, categories: ['unmanaged', 'managed_ghost'] });
    expect(where).toContain('r.category IN (?,?)');
    expect(values).toEqual([5, 'unmanaged', 'managed_ghost']);
  });

  it('adds a 3-column LIKE search', () => {
    const { where, values } = buildItemsWhere({ runId: 5, search: 'abc' });
    expect(where).toContain('r.item_id LIKE ?');
    expect(where).toContain('r.sku LIKE ?');
    expect(where).toContain('r.ebay_title LIKE ?');
    expect(values).toEqual([5, '%abc%', '%abc%', '%abc%']);
  });
});

describe('buildOrderBy', () => {
  it('whitelists sort columns and falls back to id', () => {
    expect(buildOrderBy('ebayQtyAvailable', 'desc')).toBe('ORDER BY r.ebay_qty_available DESC, r.id ASC');
    expect(buildOrderBy('evil;DROP TABLE', 'desc')).toBe('ORDER BY r.id DESC, r.id ASC');
    expect(buildOrderBy(undefined, undefined)).toBe('ORDER BY r.id ASC, r.id ASC');
  });
});
