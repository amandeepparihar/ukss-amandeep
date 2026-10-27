#!/usr/bin/env node
/**
 * Medusa Active-Product Price Sync CLI
 *
 * Reads the UKSS exchange rates from `ukssmain.currencies`, validates them into an
 * immutable snapshot, and drives the Medusa price-sync Admin API until every
 * published variant carries a price in each supported currency.
 *
 * Redmine #166532 (HLA row 7). GBP stays the authoritative price; the other 17
 * currencies are STORED Medusa prices derived from it — there is no runtime FX
 * conversion anywhere in the storefront.
 *
 * Usage:
 *   node dist/cli/sync-medusa-active-product-prices.js
 *   docker exec admin-api node /app/dist/cli/sync-medusa-active-product-prices.js
 *
 * One-shot. Run under Cronicle, or PM2 with autorestart disabled — a restarting
 * process would reopen a run every time it exited.
 *
 * Env (cron cannot pass flags, so everything is an env var):
 *   MEDUSA_API_BASE_URL                       required (already set on both containers)
 *   MEDUSA_API_KEY                            required, a Medusa secret API key. Accepted
 *                                             raw (sk_...) or pre-base64'd as the Basic
 *                                             credential; both forms exist in this estate
 *   MEDUSA_PRICE_SYNC_BATCH_SIZE=250          variants per batch; 250 measured fastest
 *   MEDUSA_PRICE_SYNC_TIMEOUT_MS=120000       per-request timeout
 *   MEDUSA_PRICE_SYNC_MAX_RETRIES=4           retries for timeout/429/5xx only
 *   MEDUSA_PRICE_SYNC_MAX_RATE_AGE_HOURS=192  8 days, matching the UKSS weekly refresh
 *   MEDUSA_PRICE_SYNC_MAX_RATE_MOVEMENT_PERCENT=10
 *   MEDUSA_PRICE_SYNC_MARGIN_PERCENT=0        see the margin note in rate-source.service.ts
 *   MEDUSA_PRICE_SYNC_DRY_RUN=1               plan and report, write no prices
 *   MEDUSA_PRICE_SYNC_MAX_BATCHES=0           stop early; 0 = run to completion
 *   MEDUSA_PRICE_SYNC_SALES_CHANNEL_ID        optional scope narrowing
 *   MEDUSA_PRICE_SYNC_STATE_FILE              previous snapshot, for the movement guard
 *   MYSQL_DATABASE_URL                        existing read-only UKSS access
 *
 * Exit 0 only when the run completed with no failed prices — or when a dry run
 * completed cleanly. Anything else is 1, so Cronicle alerts.
 */

import 'dotenv/config';
import * as path from 'node:path';
import { prisma } from '../lib/prisma';
import { MedusaPriceSyncClient, MedusaApiError } from '../modules/medusa-price-sync/medusa-client';
import { syncMedusaActiveProductPrices } from '../modules/medusa-price-sync/medusa-price-sync.service';
import { RateSourceError } from '../modules/medusa-price-sync/rate-source.service';
import type { SyncOptions } from '../modules/medusa-price-sync/medusa-price-sync.types';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string): boolean {
  const raw = process.env[name];
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function optionsFromEnv(): SyncOptions {
  return {
    dryRun: envBool('MEDUSA_PRICE_SYNC_DRY_RUN'),
    batchSize: envInt('MEDUSA_PRICE_SYNC_BATCH_SIZE', 250),
    maxBatches: envInt('MEDUSA_PRICE_SYNC_MAX_BATCHES', 0),
    maxRateAgeHours: envInt('MEDUSA_PRICE_SYNC_MAX_RATE_AGE_HOURS', 192),
    maxRateMovementPercent: envInt('MEDUSA_PRICE_SYNC_MAX_RATE_MOVEMENT_PERCENT', 10),
    marginPercent: process.env.MEDUSA_PRICE_SYNC_MARGIN_PERCENT ?? '0',
    timeoutMs: envInt('MEDUSA_PRICE_SYNC_TIMEOUT_MS', 120_000),
    maxRetries: envInt('MEDUSA_PRICE_SYNC_MAX_RETRIES', 4),
  };
}

function defaultStateFile(): string {
  return (
    process.env.MEDUSA_PRICE_SYNC_STATE_FILE ??
    path.join(process.env.LOGS_DIR ?? '/tmp', 'medusa-price-sync-last-snapshot.json')
  );
}

/**
 * SIGTERM stops after the current batch rather than mid-flight.
 *
 * Killing during a batch is survivable — the server commits each batch atomically
 * and a replayed cursor returns the committed result — but a clean stop leaves the
 * run resumable with no ambiguity about whether the last batch landed.
 */
let stopRequested = false;

function installSignalHandlers(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopRequested) {
        console.error(`Received ${signal} twice, exiting immediately`);
        process.exit(1);
      }
      console.log(`Received ${signal}, will stop after the current batch`);
      stopRequested = true;
    });
  }
}

async function main(): Promise<void> {
  console.log('Medusa Active-Product Price Sync');
  console.log('='.repeat(50));

  installSignalHandlers();

  const options = optionsFromEnv();
  console.log('Options:', JSON.stringify(options));
  if (options.dryRun) {
    console.log('DRY RUN — the run advances its cursor but no prices are written');
  }

  /**
   * MEDUSA_API_BASE_URL / MEDUSA_API_KEY are the names the Stock2 containers are
   * ALREADY provisioned with, so the cron needs no new configuration on any
   * environment. A cron that dies at 02:00 because somebody forgot to add an env
   * var during a rollout is precisely the failure this avoids.
   *
   * The key arrives raw on production and base64-encoded on staging; see
   * toBasicCredential.
   */
  const client = new MedusaPriceSyncClient({
    baseUrl: process.env.MEDUSA_API_BASE_URL ?? '',
    secretApiKey: process.env.MEDUSA_API_KEY ?? '',
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    log: (message) => console.log(`  [http] ${message}`),
  });

  const result = await syncMedusaActiveProductPrices(options, {
    client,
    log: (message) => console.log(`  ${message}`),
    stateFile: defaultStateFile(),
    shouldStop: () => stopRequested,
  });

  console.log('');
  console.log('='.repeat(50));
  console.log('Summary:');
  console.log(`  Run:                ${result.runId}`);
  console.log(`  Rate hash:          ${result.rateHash}`);
  console.log(`  Started:            ${result.startedAt}`);
  console.log(`  Completed:          ${result.completedAt}`);
  console.log(`  Duration:           ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Batches:            ${result.batches}`);
  console.log(`  Variants scanned:   ${result.totals.variants_scanned}`);
  console.log(`  Variants processed: ${result.totals.variants_processed}`);
  console.log(`  Prices created:     ${result.totals.prices_created}`);
  console.log(`  Prices updated:     ${result.totals.prices_updated}`);
  console.log(`  Prices unchanged:   ${result.totals.prices_unchanged}`);
  console.log(`  Prices skipped:     ${result.totals.prices_skipped}`);
  console.log(`  Prices failed:      ${result.totals.prices_failed}`);
  console.log(`  Run completed:      ${result.completed}`);
  if (!result.completed) {
    console.log(`  Resume cursor:      ${result.cursor ?? '<start>'}`);
  }
  if (result.errors.length) {
    console.log(`  Errors:             ${result.errors.length}`);
    for (const error of result.errors) {
      console.log(`    - ${error}`);
    }
  }
  console.log('');

  // exitCode, not process.exit(): an immediate exit would skip the finally block
  // below and leave the MySQL pool to be torn down by the process dying.
  const ok = result.completed && result.totals.prices_failed === 0 && !result.errors.length;
  process.exitCode = ok ? 0 : 1;
}

/**
 * Failure reporting is split by cause because the operator response differs.
 *
 * A RateSourceError means UKSS's data is unusable and no run was opened — nothing
 * to clean up, and the fix is upstream. A 409 means another run holds the lock. A
 * 401/403 means the secret API key is wrong or revoked. Everything else may have
 * left a partially advanced run, which is resumable on the next invocation.
 */
function reportFailure(error: unknown): void {
  console.error('');
  console.error('MEDUSA PRICE SYNC FAILED');
  console.error('='.repeat(50));

  if (error instanceof RateSourceError) {
    console.error(`Rate source rejected: ${error.message}`);
    if (error.detail) {
      console.error(`Detail: ${JSON.stringify(error.detail)}`);
    }
    console.error('No run was opened. Fix the UKSS rate data or cron, then re-run.');
    return;
  }

  if (error instanceof MedusaApiError) {
    console.error(`Medusa API ${error.status || 'transport'}: ${error.message}`);

    if (error.status === 409) {
      console.error('Another run holds the per-source lock. Let it finish, or fail it first.');
    } else if (error.status === 401 || error.status === 403) {
      console.error('MEDUSA_API_KEY is missing, wrong or revoked.');
    } else if (error.status === 422) {
      console.error('Medusa refused the request as unusable. Do NOT retry blindly.');
    }
    return;
  }

  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error('');
      console.error(error.stack);
    }
    return;
  }

  console.error('Unknown error:', error);
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main()
  .catch((error) => {
    reportFailure(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Never leave the MySQL pool open: a lingering handle keeps a one-shot cron
    // process alive and Cronicle then reports it as still running.
    await prisma.$disconnect().catch(() => undefined);
  });
