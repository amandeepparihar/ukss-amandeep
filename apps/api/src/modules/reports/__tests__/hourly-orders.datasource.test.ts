import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawUnsafe = vi.fn();

// Mock heavy deps before importing reports.service (which pulls in prisma + logger → config).
// The hourly-orders data source reads via prisma.$queryRawUnsafe (the MySQL client).
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a),
    user: { findMany: vi.fn() },
    loginHistory: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { count: vi.fn(), findMany: vi.fn() },
    session: { findMany: vi.fn() },
  },
}));

vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { reportsService } from '../reports.service';

describe('hourly-orders report', () => {
  beforeEach(() => queryRawUnsafe.mockReset());

  it('is registered with 26 columns', () => {
    const def = reportsService.getReport('hourly-orders');
    expect(def).toBeDefined();
    expect(def!.columns).toHaveLength(26); // day + h00..h23 + total
    expect(def!.columns[0].key).toBe('day');
    expect(def!.columns.at(-1)!.key).toBe('total');
  });

  it('generate() coerces Prisma BigInt/Decimal aggregates to numbers', async () => {
    // Prisma returns MySQL COUNT() as BigInt and SUM() as Decimal/string — verify coercion.
    queryRawUnsafe.mockResolvedValueOnce([
      { day: '2026-06-09', h00: 29n, h20: '75', total: 674n },
    ]);
    const { data } = await reportsService.generate({
      reportId: 'hourly-orders', format: 'json',
      params: { dateFrom: '2026-06-09', dateTo: '2026-06-09' }, userId: 'u1',
    });
    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    expect(data[0].total).toBe(674);   // BigInt → number
    expect(data[0].h20).toBe(75);      // string → number
    expect(data[0].h00).toBe(29);      // BigInt → number
  });
});
