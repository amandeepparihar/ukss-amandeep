/**
 * Daily Deals CLI Commands
 *
 * Command-line interface for Daily Deals operations.
 *
 * Usage:
 *   npx tsx apps/api/src/cli.ts daily-deals run [--dry-run] [--date 2026-03-27]
 */

import { Command } from 'commander';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('daily-deals-cli');

/**
 * Register Daily Deals CLI commands.
 */
export function registerDailyDealsCommands(program: Command): void {
  const dailyDeals = program
    .command('daily-deals')
    .description('Daily deals commands');

  dailyDeals
    .command('run')
    .description('Activate/deactivate daily deals, perform rollover, update category mappings')
    .option('--dry-run', 'Preview changes without executing')
    .option('--date <date>', 'Override target date (YYYY-MM-DD), defaults to today')
    .action(async (options) => {
      try {
        // Dynamic import to ensure env is loaded first
        const { runDailyDealsCron } = await import('../daily-deals-cron.service');

        console.log(`\nDaily Deals Cron${options.dryRun ? ' (DRY RUN)' : ''}`);
        console.log('='.repeat(50));

        const result = await runDailyDealsCron({
          date: options.date,
          dryRun: options.dryRun,
        });

        // Print log
        for (const line of result.log) {
          console.log(line);
        }

        console.log('\n' + '='.repeat(50));
        console.log(`Summary:`);
        console.log(`  Date:           ${result.date}`);
        console.log(`  Deactivated:    ${result.deactivated}`);
        console.log(`  Activated:      ${result.activated}`);
        console.log(`  Rolled Over:    ${result.rolledOver}`);
        console.log(`  Total Active:   ${result.totalActive}`);
        console.log(`  Category Mapped: ${result.categoryMapped}`);
        console.log(`  Update Bit Reset: ${result.updateBitReset}`);
        console.log(`  Dry Run:        ${result.dryRun}`);
        console.log('');

        process.exit(0);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Daily deals cron command failed');
        process.exit(1);
      }
    });
}
