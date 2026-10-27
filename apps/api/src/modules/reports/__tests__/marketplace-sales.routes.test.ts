import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawUnsafe = vi.fn();
vi.mock('../../../lib/prisma', () => ({
  prisma: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a), auditLog: { create: vi.fn() } },
}));
vi.mock('../../../lib/logger', () => ({ createLogger: () => ({ info(){}, warn(){}, error(){}, debug(){} }) }));
// marketplace-sync.query reads config.EBAY_STORE_ID; mock config to avoid loading/validating real env.
vi.mock('../../../config', () => ({ config: { EBAY_STORE_ID: 94 } }));

import { getMarketplaceSales } from '../reports.routes';

describe('getMarketplaceSales', () => {
  beforeEach(() => queryRawUnsafe.mockReset());

  it('computes share %, vs-prev %, and coerces Decimal/BigInt; hourly averaged over days', async () => {
    queryRawUnsafe
      // breakdown (current)
      .mockResolvedValueOnce([
        { order_site: '0',   channel: 'UKSS',      orders: 100n, revenue: '1000', aov: '10' },
        { order_site: '150', channel: 'Debenhams', orders: 50n,  revenue: '500',  aov: '10' },
      ])
      // breakdown (previous period) — for vsPrev
      .mockResolvedValueOnce([
        { order_site: '0', channel: 'UKSS', orders: 80n, revenue: '800', aov: '10' },
      ])
      // daily trend
      .mockResolvedValueOnce([{ day: '2026-06-01', order_site: '0', orders: 100n }])
      // hourly (2 distinct days in range -> averaged)
      .mockResolvedValueOnce([{ order_site: '0', hour: 9, orders: 20n }]);

    const res = await getMarketplaceSales({ dateFrom: '2026-06-01', dateTo: '2026-06-02', statuses: [] });

    // revenue share: UKSS 1000 / 1500 = 66.7%
    const ukss = res.breakdown.find((b) => b.orderSite === '0')!;
    expect(ukss.revenue).toBe(1000);
    expect(Math.round(ukss.sharePercent)).toBe(67);
    expect(ukss.vsPrevPercent).toBe(25); // 1000 vs 800 = +25%
    const deb = res.breakdown.find((b) => b.orderSite === '150')!;
    expect(deb.vsPrevPercent).toBeNull(); // not in previous period
    // hourly averaged over 2 days: 20 / 2 = 10
    expect(res.hourly[0].ordersAvg).toBe(10);
  });
});
