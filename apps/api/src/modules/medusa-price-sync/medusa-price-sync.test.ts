import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyMargin, hashSnapshot, detectExcessiveMovement } from './rate-source.service';
import type { BatchResult, RateSnapshot, RunState, SyncOptions } from './medusa-price-sync.types';

/**
 * Tests for the Medusa price sync. Redmine #166532 (HLA rows 4, 7 and 8's
 * contract tests).
 *
 * The rate source is mocked in the orchestrator block so nothing here touches
 * MySQL — the point of these tests is the retry/resume/idempotency behaviour,
 * which is exactly what is hardest to exercise against a live database and
 * easiest to get wrong.
 */

describe('medusa credential handling', () => {
  it('encodes a raw sk_ key as the Basic credential', async () => {
    const { toBasicCredential } = await import('./medusa-client');
    // production holds the raw form
    expect(toBasicCredential('sk_abc123')).toBe(Buffer.from('sk_abc123:').toString('base64'));
  });

  it('passes an already-encoded credential through untouched', async () => {
    const { toBasicCredential } = await import('./medusa-client');
    // staging holds base64("sk_...:") — re-encoding it would break auth
    const encoded = Buffer.from('sk_abc123:').toString('base64');
    expect(toBasicCredential(encoded)).toBe(encoded);
  });

  it('round-trips: both forms of the same key produce the same header', async () => {
    const { toBasicCredential } = await import('./medusa-client');
    const raw = 'sk_582e96e2e2b724aaa1a3af6a40021632aaad7ba0d7400ee0cbb57d3a4bfb2316';
    expect(toBasicCredential(raw)).toBe(toBasicCredential(Buffer.from(raw + ':').toString('base64')));
  });
});

describe('rate arithmetic', () => {
  it('is a no-op at 0%, which is the default', () => {
    expect(applyMargin('1.36149600', '0')).toBe('1.36149600');
    expect(applyMargin('1.36149600', '')).toBe('1.36149600');
  });

  it('applies a margin in integer arithmetic', () => {
    expect(applyMargin('1.36149600', '2')).toBe('1.38872592');
    expect(applyMargin('1.00000000', '2')).toBe('1.02000000');
    expect(applyMargin('216.43390200', '2')).toBe('220.76258004');
  });

  it('keeps 8 decimal places even when the input string was trimmed', () => {
    // Prisma's Decimal.toString() strips trailing zeros; rounding back to the
    // string's own scale would silently discard precision the column holds.
    expect(applyMargin('1.361496', '2')).toBe('1.38872592');
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', '-1', '1.2e3', 'abc']) {
      // "" means "no margin", so it is only invalid as a RATE.
      expect(() => applyMargin(bad || '1', bad || 'x')).toThrow();
    }
  });

  it('hashes the same snapshot to the same value, and a changed one differently', () => {
    const asOf = new Date('2026-03-18T01:25:00.000Z');
    const a = hashSnapshot('gbp', asOf, { usd: '1.361496', eur: '1.18065' });
    // Key order must not matter: the snapshot is sorted before hashing.
    const b = hashSnapshot('gbp', asOf, { eur: '1.18065', usd: '1.361496' });
    const c = hashSnapshot('gbp', asOf, { usd: '1.361497', eur: '1.18065' });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('flags a rate that moved more than the tolerance', () => {
    const moved = detectExcessiveMovement(
      { usd: '1.361496', eur: '1.18065' },
      { usd: '1.70187', eur: '1.18000' },
      10,
    );

    expect(moved.map((m) => m.currency)).toEqual(['usd']);
    expect(moved[0].percent).toBeCloseTo(20, 1);
  });

  it('ignores a currency with no previous rate rather than treating it as a move', () => {
    expect(detectExcessiveMovement({ jpy: '216.43' }, {}, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const SNAPSHOT: RateSnapshot = {
  baseCurrency: 'gbp',
  rates: { usd: '1.361496', eur: '1.18065' },
  decimals: { usd: 2, eur: 2 },
  ratesAsOf: new Date('2026-03-18T01:25:00.000Z'),
  ageHours: 1,
  marginIncluded: true,
  marginAppliedPercent: '0',
  hash: 'sha256:testhash',
  excluded: [],
};

vi.mock('./rate-source.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rate-source.service')>();
  return {
    ...actual,
    buildRateSnapshot: vi.fn(async () => SNAPSHOT),
  };
});

const OPTIONS: SyncOptions = {
  dryRun: false,
  batchSize: 250,
  maxBatches: 0,
  maxRateAgeHours: 192,
  maxRateMovementPercent: 10,
  marginPercent: '0',
  timeoutMs: 1000,
  maxRetries: 0,
};

function emptyBatch(): BatchResult['batch'] {
  return {
    variants_scanned: 0,
    variants_processed: 0,
    prices_created: 0,
    prices_updated: 0,
    prices_unchanged: 0,
    prices_skipped: 0,
    prices_failed: 0,
  };
}

/** A stand-in for the Medusa API that records what the orchestrator asked for. */
function fakeClient(overrides: {
  run?: Partial<RunState>;
  batches?: Array<BatchResult | Error>;
}) {
  const calls: Array<{ cursor: string | null; key: string }> = [];
  let index = 0;

  const run: RunState = {
    id: 'cpsr_1',
    status: 'pending',
    rate_hash: SNAPSHOT.hash,
    rates_as_of: SNAPSHOT.ratesAsOf.toISOString(),
    target_currencies: ['eur', 'usd'],
    cursor: null,
    batch_size: 250,
    dry_run: false,
    ...overrides.run,
  };

  return {
    calls,
    run,
    client: {
      createRun: vi.fn(async () => run),
      getRun: vi.fn(async () => run),
      runBatch: vi.fn(async (_runId: string, body: { cursor: string | null }, key: string) => {
        calls.push({ cursor: body.cursor, key });
        const next = overrides.batches?.[index++];
        if (!next) {
          throw new Error(`fake client ran out of batches at call ${index}`);
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }),
    } as any,
  };
}

function batch(
  next: string | null,
  hasMore: boolean,
  counts: Partial<BatchResult['batch']> = {},
): BatchResult {
  return {
    run_id: 'cpsr_1',
    status: hasMore ? 'running' : 'completed',
    batch: { ...emptyBatch(), variants_processed: 10, ...counts },
    next_cursor: next,
    has_more: hasMore,
  };
}

describe('syncMedusaActiveProductPrices', () => {
  let sync: typeof import('./medusa-price-sync.service').syncMedusaActiveProductPrices;

  beforeEach(async () => {
    ({ syncMedusaActiveProductPrices: sync } = await import('./medusa-price-sync.service'));
  });

  const log = () => undefined;

  it('drives batches until the server says there is no more', async () => {
    const { client, calls } = fakeClient({
      batches: [batch('v_1', true), batch('v_2', true), batch(null, false)],
    });

    const result = await sync(OPTIONS, { client, log });

    expect(result.batches).toBe(3);
    expect(result.completed).toBe(true);
    expect(result.totals.variants_processed).toBe(30);
    // Each batch sends back the cursor the previous one returned, never its own guess.
    expect(calls.map((c) => c.cursor)).toEqual([null, 'v_1', 'v_2']);
  });

  it('keys each batch by run and cursor so a retry replays instead of rewriting', async () => {
    const { client, calls } = fakeClient({ batches: [batch('v_1', true), batch(null, false)] });

    await sync(OPTIONS, { client, log });

    expect(calls.map((c) => c.key)).toEqual(['cpsr_1:start', 'cpsr_1:v_1']);
  });

  it('keys a dry run separately from a real one over the same snapshot', async () => {
    // Regression: caught on staging. Without the suffix, a dry run followed by a
    // real run on the same day replayed the dry run and reported 493 prices
    // "created" while the database still held zero.
    const real = fakeClient({ batches: [batch(null, false)] });
    await sync(OPTIONS, { client: real.client, log });

    const dry = fakeClient({ batches: [batch(null, false)] });
    await sync({ ...OPTIONS, dryRun: true }, { client: dry.client, log });

    const realKey = real.client.createRun.mock.calls[0][1];
    const dryKey = dry.client.createRun.mock.calls[0][1];

    expect(dryKey).not.toBe(realKey);
    expect(dryKey.endsWith(':dry')).toBe(true);
    expect(realKey.endsWith(':dry')).toBe(false);
  });

  it('resumes from the cursor a replayed run already reached', async () => {
    const { client, calls } = fakeClient({
      run: { status: 'running', cursor: 'v_500' },
      batches: [batch(null, false)],
    });

    await sync(OPTIONS, { client, log });

    expect(calls[0].cursor).toBe('v_500');
  });

  it('does nothing when the replayed run is already completed', async () => {
    const { client } = fakeClient({ run: { status: 'completed', cursor: 'v_end' }, batches: [] });

    const result = await sync(OPTIONS, { client, log });

    expect(result.batches).toBe(0);
    expect(result.completed).toBe(true);
    expect(client.runBatch).not.toHaveBeenCalled();
  });

  it('refuses to continue a run opened under different rates', async () => {
    const { client } = fakeClient({ run: { rate_hash: 'sha256:someotherhash' }, batches: [] });

    await expect(sync(OPTIONS, { client, log })).rejects.toThrow(/different rates/);
    expect(client.runBatch).not.toHaveBeenCalled();
  });

  it('throws rather than spinning when the cursor does not advance', async () => {
    const { client } = fakeClient({ batches: [batch(null, true)] });

    await expect(sync(OPTIONS, { client, log })).rejects.toThrow(/did not advance/);
  });

  it('resynchronises to the server cursor on a stale-cursor 422', async () => {
    const { MedusaApiError } = await import('./medusa-client');
    const stale = new MedusaApiError('stale', 422, { type: 'stale_cursor' }, false);

    const { client, calls, run } = fakeClient({
      batches: [stale, batch(null, false)],
    });
    // The server has moved on since this client last looked.
    client.getRun = vi.fn(async () => ({ ...run, cursor: 'v_900', status: 'running' }));

    const result = await sync(OPTIONS, { client, log });

    expect(calls.map((c) => c.cursor)).toEqual([null, 'v_900']);
    expect(result.completed).toBe(true);
  });

  it('gives up if resynchronising lands on the same cursor', async () => {
    const { MedusaApiError } = await import('./medusa-client');
    const stale = new MedusaApiError('stale', 422, { type: 'stale_cursor' }, false);
    const { client } = fakeClient({ batches: [stale] });

    await expect(sync(OPTIONS, { client, log })).rejects.toBe(stale);
  });

  it('reports the run as incomplete when it stops at the batch cap', async () => {
    const { client } = fakeClient({ batches: [batch('v_1', true), batch('v_2', true)] });

    const result = await sync({ ...OPTIONS, maxBatches: 2 }, { client, log });

    expect(result.batches).toBe(2);
    expect(result.completed).toBe(false);
    expect(result.cursor).toBe('v_2');
  });

  it('stops cleanly on a signal, leaving the cursor resumable', async () => {
    let stop = false;
    const { client } = fakeClient({ batches: [batch('v_1', true), batch('v_2', true)] });

    const result = await sync(OPTIONS, {
      client,
      log,
      shouldStop: () => {
        const now = stop;
        stop = true; // let the first batch through, stop before the second
        return now;
      },
    });

    expect(result.batches).toBe(1);
    expect(result.completed).toBe(false);
    expect(result.cursor).toBe('v_1');
  });

  it('surfaces failed prices as run errors so the CLI exits non-zero', async () => {
    const { client } = fakeClient({ batches: [batch(null, false, { prices_failed: 3 })] });

    const result = await sync(OPTIONS, { client, log });

    expect(result.totals.prices_failed).toBe(3);
    expect(result.errors).toHaveLength(1);
  });
});
