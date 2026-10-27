import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawUnsafe = vi.fn();

// Mock heavy deps before importing routes (which pull in prisma + logger → config).
// The dropdown helpers read via prisma.$queryRawUnsafe (the MySQL client).
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a),
    auditLog: { create: vi.fn() },
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

// marketplace-sync.query reads config.EBAY_STORE_ID; mock config to avoid loading/validating real env.
vi.mock('../../../config', () => ({ config: { EBAY_STORE_ID: 94 } }));

import { fetchOrderStatuses, fetchMarketplaces } from '../reports.routes';

describe('dropdown sources', () => {
  beforeEach(() => queryRawUnsafe.mockReset());

  it('order statuses come back alphabetized by name', async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      { id: 5, name: 'Shipped' }, { id: 2, name: 'Processing' }, { id: 1, name: 'Pending' },
    ]);
    const rows = await fetchOrderStatuses();
    expect(rows.map((r) => r.name)).toEqual(['Pending', 'Processing', 'Shipped']);
  });

  it('marketplaces come back alphabetized by name', async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      { id: '150', name: 'Debenhams' }, { id: '94', name: 'Ebay' }, { id: '95', name: 'Fruugo' },
    ]);
    const rows = await fetchMarketplaces();
    expect(rows.map((r) => r.name)).toEqual(['Debenhams', 'Ebay', 'Fruugo']);
  });
});
