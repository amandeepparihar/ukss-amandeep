import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { chunk, isRunStale, STALE_RUN_MS } from './ebay-reconciliation.db';

describe('chunk', () => {
  it('splits rows into fixed-size chunks with a smaller tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('isRunStale', () => {
  it('is stale strictly after 2 hours', () => {
    const started = new Date('2026-07-17T00:00:00Z');
    expect(isRunStale(started, new Date(started.getTime() + STALE_RUN_MS - 1))).toBe(false);
    expect(isRunStale(started, new Date(started.getTime() + STALE_RUN_MS + 1))).toBe(true);
  });
});
