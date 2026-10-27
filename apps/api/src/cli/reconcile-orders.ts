#!/usr/bin/env node
/**
 * Order Reconciliation CLI Tool
 *
 * Automates daily order verification across all marketplaces.
 *
 * Usage:
 *   npx tsx apps/api/src/cli/reconcile-orders.ts
 *   npx tsx apps/api/src/cli/reconcile-orders.ts --marketplace shopify --hours 48 -v
 *   npx tsx apps/api/src/cli/reconcile-orders.ts --json --no-email
 */

import 'dotenv/config';
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { runReconciliation } from '../modules/reconciliation/reconciliation.service';
import { printConsoleReport } from '../modules/reconciliation/report/console-report';
import { sendEmailReport } from '../modules/reconciliation/report/email-report';
import type { ReconcileOptions, MarketplaceName } from '../modules/reconciliation/reconciliation.types';

const VALID_MARKETPLACES = ['shopify', 'toffs', 'fruugo', 'debenhams', 'all'] as const;

// Redis keys (must match reconciliation.routes.ts)
const REDIS_KEY_CURRENT_RUN_ID = 'reconciliation:current-run-id';
const REDIS_KEY_LAST_RUN = 'reconciliation:last-run';
const REDIS_KEY_CRON_SCHEDULE = 'reconciliation:cron-schedule';
const LAST_RUN_PER_MP_TTL = 30 * 24 * 60 * 60; // 30d
const LAST_RUN_TTL = 7 * 24 * 60 * 60; // 7d
const CURRENT_RUN_ID_TTL = 24 * 60 * 60; // 24h

// BigInt-safe JSON serializer
function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , 2);
}

const program = new Command();

program
  .name('reconcile-orders')
  .description('Reconcile marketplace orders against the local database')
  .version('1.0.0')
  .option('-m, --marketplace <name>', 'Marketplace to check (shopify, toffs, fruugo, debenhams, all)', 'all')
  .option('--hours <n>', 'Hours to look back', '24')
  .option('--stuck-threshold <n>', 'Hours before flagging a Waiting status push as stuck', '6')
  .option('--unconverted-threshold <n>', 'Hours before flagging an unconverted order', '2')
  .option('-v, --verbose', 'Show individual order details', false)
  .option('--json', 'Output JSON instead of console report', false)
  .option('--no-email', 'Skip sending email report')
  .action(async (opts) => {
    // Validate marketplace
    const marketplace = opts.marketplace.toLowerCase();
    if (!VALID_MARKETPLACES.includes(marketplace as any)) {
      console.error(`Error: Invalid marketplace "${opts.marketplace}". Valid options: ${VALID_MARKETPLACES.join(', ')}`);
      process.exit(2);
    }

    const options: ReconcileOptions = {
      marketplace: marketplace as MarketplaceName | 'all',
      hours: parseInt(opts.hours, 10),
      stuckThreshold: parseInt(opts.stuckThreshold, 10),
      unconvertedThreshold: parseInt(opts.unconvertedThreshold, 10),
      verbose: opts.verbose,
      json: opts.json,
      noEmail: !opts.email, // Commander inverts --no-email to opts.email = false
    };

    // Validate numeric options
    if (isNaN(options.hours) || options.hours < 1) {
      console.error('Error: --hours must be a positive integer');
      process.exit(2);
    }

    const startedAt = new Date().toISOString();

    try {
      const { report, runId } = await runReconciliation(options);

      // Store runId for log retrieval
      try {
        await redis.set(REDIS_KEY_CURRENT_RUN_ID, runId, 'EX', CURRENT_RUN_ID_TTL);

        // Store global last-run report
        await redis.set(
          REDIS_KEY_LAST_RUN,
          safeStringify({
            report,
            metadata: {
              triggeredBy: 'cron',
              triggeredAt: startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - new Date(startedAt).getTime(),
              source: 'cli',
              runId,
            },
          }),
          'EX',
          LAST_RUN_TTL
        );

        // Store per-marketplace last-run data
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(startedAt).getTime();

        for (const result of report.results) {
          const mpKey = `reconciliation:last-run:${result.marketplace.toLowerCase()}`;
          const issueCount =
            (result.missingOrders?.missingOrders.length ?? 0) +
            (result.missingProducts?.mismatches.length ?? 0) +
            result.statusSync.stuckStatuses.length +
            result.unconvertedOrders.unconvertedOrders.length;

          await redis.set(
            mpKey,
            JSON.stringify({
              timestamp: completedAt,
              triggeredBy: 'cron',
              durationMs,
              issueCount,
            }),
            'EX',
            LAST_RUN_PER_MP_TTL
          );
        }

        // Update cron schedule data
        const cronScheduleRaw = await redis.get(REDIS_KEY_CRON_SCHEDULE);
        const cronSchedule = cronScheduleRaw ? JSON.parse(cronScheduleRaw) : {};

        // Record last execution for each marketplace that was reconciled
        const marketplaces = options.marketplace === 'all'
          ? ['shopify', 'toffs', 'fruugo', 'debenhams']
          : [options.marketplace];

        for (const mp of marketplaces) {
          cronSchedule[mp] = {
            cronExpression: cronSchedule[mp]?.cronExpression ?? '0 6 * * *', // Default: daily at 6am
            lastRun: completedAt,
          };
        }

        await redis.set(REDIS_KEY_CRON_SCHEDULE, JSON.stringify(cronSchedule), 'EX', LAST_RUN_PER_MP_TTL);
      } catch (redisError) {
        // Non-fatal: Redis write failures shouldn't fail the CLI
        console.error(`Warning: Failed to update Redis state: ${redisError instanceof Error ? redisError.message : String(redisError)}`);
      }

      // Output report
      if (options.json) {
        console.log(safeStringify(report));
      } else {
        printConsoleReport(report, options.verbose);
      }

      // Send email report (unless --no-email)
      if (!options.noEmail) {
        try {
          await sendEmailReport(report);
        } catch (emailError) {
          const msg = emailError instanceof Error ? emailError.message : 'Unknown error';
          console.error(`Warning: Failed to send email report: ${msg}`);
        }
      }

      // Exit code based on health
      process.exit(report.summary.hasIssues ? 1 : 0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Reconciliation failed: ${msg}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(2);
    } finally {
      await prisma.$disconnect();
      redis.disconnect();
    }
  });

program.parse();
