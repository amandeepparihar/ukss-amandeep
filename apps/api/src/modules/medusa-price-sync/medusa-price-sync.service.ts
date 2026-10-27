import * as fs from 'node:fs';
import * as path from 'node:path';
import { MedusaPriceSyncClient, MedusaApiError } from './medusa-client';
import { buildRateSnapshot, BASE_CURRENCY } from './rate-source.service';
import type {
  BatchResult,
  RateSnapshot,
  SyncOptions,
  SyncResult,
} from './medusa-price-sync.types';

/**
 * Orchestrates a Medusa price-sync run. Redmine #166532 (HLA row 7).
 *
 * All the retry, resume and idempotency logic lives here rather than in the CLI, so
 * the CLI stays a thin entry point per the Stock2 convention and this is testable
 * without spawning a process.
 *
 * Shape of a run: build and validate one rate snapshot, open a run with it, then
 * drive batches until the server says there is no more. The server owns the cursor;
 * this only ever sends back the cursor it was given. That is deliberate — a client
 * that computes its own next cursor can skip a range on a retry, and the gap would
 * be invisible until a customer saw a price in the wrong currency.
 */

/** "ukss_currencies" — provenance recorded on the run, and its write-lock scope. */
const RATE_SOURCE = 'ukss_currencies';

export type SyncDeps = {
  client: MedusaPriceSyncClient;
  log: (message: string) => void;
  /** Where the previous snapshot is remembered, for the movement guard. */
  stateFile?: string;
  now?: () => Date;
  /** Set true by a SIGTERM handler to stop cleanly after the current batch. */
  shouldStop?: () => boolean;
};

export async function syncMedusaActiveProductPrices(
  options: SyncOptions,
  deps: SyncDeps,
): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const errors: string[] = [];

  const previous = readPreviousSnapshot(deps.stateFile, deps.log);

  const snapshot = await buildRateSnapshot({
    maxRateAgeHours: options.maxRateAgeHours,
    marginPercent: options.marginPercent,
    previousRates: previous?.rates,
    maxRateMovementPercent: options.maxRateMovementPercent,
    now: startedAt,
  });

  deps.log(
    `rates: ${Object.keys(snapshot.rates).length} currencies, as of ` +
      `${snapshot.ratesAsOf.toISOString()} (${snapshot.ageHours.toFixed(1)}h old), ` +
      `hash ${snapshot.hash.slice(0, 20)}…, margin applied here: ${snapshot.marginAppliedPercent}%`,
  );

  if (!previous) {
    // Never leave a skipped safety check implicit.
    deps.log(
      'rate movement guard SKIPPED: no previous snapshot on record ' +
        `(${deps.stateFile ?? 'no state file configured'})`,
    );
  }

  for (const excluded of snapshot.excluded) {
    deps.log(`excluded ${excluded.currency}: ${excluded.reason}`);
  }

  /**
   * The run's idempotency key is the rate hash, the calendar day, and whether this
   * is a dry run.
   *
   * The hash alone would be wrong: UKSS refreshes weekly and the staleness
   * tolerance is 8 days, so a daily cron legitimately replays an identical hash and
   * would be handed yesterday's finished run forever. The day alone would be wrong
   * too: a retry after a rate change on the same day must not join the earlier run,
   * whose prices were computed from different rates.
   *
   * The dry-run suffix is not cosmetic — it was a bug caught on staging. A dry run
   * followed by a real run over the same snapshot on the same day replayed the dry
   * run and reported 493 prices "created" while the database still held zero. A
   * rehearsal and the performance are different intents and must be different runs.
   */
  const runKey =
    `${RATE_SOURCE}:${snapshot.hash.slice(7, 27)}:${isoDate(startedAt)}` +
    (options.dryRun ? ':dry' : '');

  const run = await deps.client.createRun(
    {
      source: RATE_SOURCE,
      base_currency: BASE_CURRENCY,
      rates_as_of: snapshot.ratesAsOf.toISOString(),
      margin_included: snapshot.marginIncluded,
      rates: snapshot.rates,
      decimals: snapshot.decimals,
      scope: {
        product_status: 'published',
        ...(process.env.MEDUSA_PRICE_SYNC_SALES_CHANNEL_ID
          ? { sales_channel_id: process.env.MEDUSA_PRICE_SYNC_SALES_CHANNEL_ID }
          : {}),
      },
      batch_size: options.batchSize,
      dry_run: options.dryRun,
    },
    runKey,
  );

  deps.log(
    `run ${run.id} status=${run.status} cursor=${run.cursor ?? '<start>'} ` +
      `targets=${run.target_currencies.length} dry_run=${run.dry_run}`,
  );

  /**
   * Confirm the server is running the snapshot we just built.
   *
   * On a replay the server returns the run it already has, whose rates were fixed
   * when it was created. If the rates have since changed, continuing would price
   * part of the catalogue from one snapshot and part from another — the exact
   * inconsistency the rate hash exists to prevent. Stop instead.
   */
  if (run.rate_hash !== snapshot.hash) {
    throw new Error(
      `Run ${run.id} was opened with rate hash ${run.rate_hash} but the current ` +
        `snapshot is ${snapshot.hash}. Refusing to continue a run under different rates.`,
    );
  }

  const totals: BatchResult['batch'] = {
    variants_scanned: 0,
    variants_processed: 0,
    prices_created: 0,
    prices_updated: 0,
    prices_unchanged: 0,
    prices_skipped: 0,
    prices_failed: 0,
  };

  let cursor = run.cursor ?? null;
  let hasMore = run.status !== 'completed';
  let batches = 0;

  while (hasMore) {
    if (deps.shouldStop?.()) {
      // Each batch is committed atomically server-side, so stopping between
      // batches loses nothing: the next invocation resumes from the same cursor.
      deps.log(`stopping on signal after ${batches} batches, cursor ${cursor ?? '<start>'}`);
      break;
    }

    if (options.maxBatches && batches >= options.maxBatches) {
      deps.log(
        `stopping at MEDUSA_PRICE_SYNC_MAX_BATCHES=${options.maxBatches}; ` +
          `run ${run.id} is INCOMPLETE at cursor ${cursor ?? '<start>'}`,
      );
      break;
    }

    let result: BatchResult;

    try {
      result = await deps.client.runBatch(
        run.id,
        { cursor, limit: options.batchSize },
        `${run.id}:${cursor ?? 'start'}`,
      );
    } catch (error) {
      /**
       * A stale cursor means this client's idea of the position disagrees with the
       * server's. Re-reading the run and continuing from ITS cursor is the correct
       * repair, and it is safe because a committed cursor replays rather than
       * re-executes. Retrying blindly would not fix it.
       */
      if (error instanceof MedusaApiError && isStaleCursor(error)) {
        const fresh = await deps.client.getRun(run.id);
        deps.log(
          `stale cursor ${cursor ?? '<start>'}; resynchronising to ${fresh.cursor ?? '<start>'}`,
        );

        if ((fresh.cursor ?? null) === cursor) {
          throw error;
        }

        cursor = fresh.cursor ?? null;
        hasMore = fresh.status !== 'completed';
        continue;
      }

      throw error;
    }

    batches++;
    addTotals(totals, result.batch);

    deps.log(
      `batch ${batches}${result.replayed ? ' (replayed)' : ''}: ` +
        `scanned=${result.batch.variants_scanned} processed=${result.batch.variants_processed} ` +
        `created=${result.batch.prices_created} updated=${result.batch.prices_updated} ` +
        `unchanged=${result.batch.prices_unchanged} skipped=${result.batch.prices_skipped} ` +
        `failed=${result.batch.prices_failed} next=${result.next_cursor ?? '<end>'}` +
        (result.skipped_reasons ? ` reasons=${JSON.stringify(result.skipped_reasons)}` : ''),
    );

    if (result.batch.prices_failed > 0) {
      errors.push(
        `batch at cursor ${cursor ?? '<start>'} reported ${result.batch.prices_failed} failed prices`,
      );
    }

    /**
     * Guard against a non-advancing cursor. If the server ever returned the same
     * position with has_more true, this loop would spin forever writing nothing —
     * the kind of failure that is only noticed by a disk filling with log lines.
     */
    if (result.has_more && result.next_cursor === cursor) {
      throw new Error(
        `Cursor did not advance past ${cursor ?? '<start>'} while has_more was true`,
      );
    }

    cursor = result.next_cursor;
    hasMore = result.has_more;
  }

  if (!options.dryRun) {
    writeSnapshot(deps.stateFile, snapshot, deps.log);
  }

  const completedAt = now();

  return {
    runId: run.id,
    rateHash: snapshot.hash,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    batches,
    totals,
    cursor,
    completed: !hasMore,
    errors,
  };
}

function isStaleCursor(error: MedusaApiError): boolean {
  return (
    error.status === 422 &&
    typeof error.body === 'object' &&
    error.body !== null &&
    (error.body as { type?: string }).type === 'stale_cursor'
  );
}

function addTotals(totals: BatchResult['batch'], batch: BatchResult['batch']): void {
  for (const key of Object.keys(totals) as Array<keyof BatchResult['batch']>) {
    totals[key] += batch[key] ?? 0;
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type StoredSnapshot = { hash: string; ratesAsOf: string; rates: Record<string, string> };

/**
 * The previous snapshot, for the movement guard only.
 *
 * Kept in a local file rather than fetched from Medusa because the API exposes no
 * run listing, and adding one just to serve this would put a client-side safety
 * check into the server's contract. Losing the file degrades to "guard skipped",
 * which is logged loudly rather than passed over.
 */
function readPreviousSnapshot(
  stateFile: string | undefined,
  log: (m: string) => void,
): StoredSnapshot | null {
  if (!stateFile) {
    return null;
  }

  try {
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as StoredSnapshot;
  } catch (error) {
    log(`could not read previous snapshot from ${stateFile}: ${(error as Error).message}`);
    return null;
  }
}

function writeSnapshot(
  stateFile: string | undefined,
  snapshot: RateSnapshot,
  log: (m: string) => void,
): void {
  if (!stateFile) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(
      stateFile,
      JSON.stringify(
        {
          hash: snapshot.hash,
          ratesAsOf: snapshot.ratesAsOf.toISOString(),
          rates: snapshot.rates,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    // Not fatal: the prices are already written, and the only casualty is the next
    // run's movement guard, which fails open with a loud log line.
    log(`could not persist snapshot to ${stateFile}: ${(error as Error).message}`);
  }
}
