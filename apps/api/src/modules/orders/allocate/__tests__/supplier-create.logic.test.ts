import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { shouldTransitionToInTransit, overflowRowCount } from '../supplier-create.logic';
import { getCoverageCounts } from '../allocate.queries';
import type { TxClient } from '../../processing/processing.types';

describe('shouldTransitionToInTransit (legacy ajaxSupplierManage.php L485 AIRO / L594 Toffs — same predicate, reused for both coverage checks)', () => {
  it('fires when every AIRO line is covered by sop or SMS box and >=1 sop exists', () => {
    // 3 AIRO lines: 2 on supplier orders, 1 using an SMS box.
    expect(shouldTransitionToInTransit({ totalAiroProducts: 3, allAiroProducts: 3, totalSopProducts: 2, smsQuantityUsed: 1 })).toBe(true);
  });
  it('does NOT fire when a line is still uncovered', () => {
    expect(shouldTransitionToInTransit({ totalAiroProducts: 3, allAiroProducts: 3, totalSopProducts: 1, smsQuantityUsed: 1 })).toBe(false);
  });
  it('does NOT fire when no sop rows exist (all covered by SMS only)', () => {
    expect(shouldTransitionToInTransit({ totalAiroProducts: 2, allAiroProducts: 2, totalSopProducts: 0, smsQuantityUsed: 2 })).toBe(false);
  });
  it('does NOT fire when the AIRO line counts disagree (join inflation / mismatch)', () => {
    expect(shouldTransitionToInTransit({ totalAiroProducts: 3, allAiroProducts: 4, totalSopProducts: 4, smsQuantityUsed: 0 })).toBe(false);
  });
  it('does NOT fire on an order with zero AIRO lines', () => {
    expect(shouldTransitionToInTransit({ totalAiroProducts: 0, allAiroProducts: 0, totalSopProducts: 0, smsQuantityUsed: 0 })).toBe(false);
  });
  it('fires identically for a Toffs-only order (same predicate, Toffs coverage counts)', () => {
    // 2 Toffs lines, both on supplier orders — mirrors legacy L594 Toffs coverage check.
    expect(shouldTransitionToInTransit({ totalAiroProducts: 2, allAiroProducts: 2, totalSopProducts: 2, smsQuantityUsed: 0 })).toBe(true);
  });
});

describe('getCoverageCounts (manufacturerIds parameterization — AIRO and Toffs blocks share this query shape but must bind their OWN manufacturer list, not each other\'s)', () => {
  it('binds the coverage queries to whichever manufacturerIds is passed in', async () => {
    const queryRaw = vi.fn(async () => [{ c: 0n, all_airo: 0n, sop_total: 0n }]);
    const client = { $queryRaw: queryRaw } as unknown as TxClient;

    await getCoverageCounts(1, [79, 82], client);
    const airoValues = queryRaw.mock.calls.flatMap(([sql]) => (sql as Prisma.Sql).values);

    queryRaw.mockClear();
    await getCoverageCounts(1, [35, 107], client);
    const toffsValues = queryRaw.mock.calls.flatMap(([sql]) => (sql as Prisma.Sql).values);

    expect(airoValues).toEqual(expect.arrayContaining([79, 82]));
    expect(airoValues).not.toEqual(expect.arrayContaining([35, 107]));
    expect(toffsValues).toEqual(expect.arrayContaining([35, 107]));
    expect(toffsValues).not.toEqual(expect.arrayContaining([79, 82]));
  });
});

describe('overflowRowCount (legacy quantity>1 loop, L324)', () => {
  it('creates quantity-1 overflow rows', () => {
    expect(overflowRowCount(1)).toBe(0);
    expect(overflowRowCount(3)).toBe(2);
  });
  it('never negative', () => { expect(overflowRowCount(0)).toBe(0); });
});
