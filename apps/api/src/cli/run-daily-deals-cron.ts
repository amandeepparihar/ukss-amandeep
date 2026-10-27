#!/usr/bin/env node
/**
 * Daily Deals Cron CLI Script
 *
 * Runs the midnight cron: deactivate expired, activate scheduled,
 * rollover if needed, update category mappings.
 *
 * Usage:
 *   node dist/cli/run-daily-deals-cron.js
 *   docker exec admin-api node /app/dist/cli/run-daily-deals-cron.js
 */

import 'dotenv/config';
import { runDailyDealsCron } from '../modules/daily-deals/daily-deals-cron.service';
import { prisma } from '../lib/prisma';

async function main() {
  console.log('Daily Deals Cron');
  console.log('='.repeat(50));

  try {
    const result = await runDailyDealsCron();

    // Print log
    for (const line of result.log) {
      console.log(line);
    }

    console.log('');
    console.log('='.repeat(50));
    console.log('Summary:');
    console.log(`  Date:            ${result.date}`);
    console.log(`  Deactivated:     ${result.deactivated}`);
    console.log(`  Activated:       ${result.activated}`);
    console.log(`  Rolled Over:     ${result.rolledOver}`);
    console.log(`  Total Active:    ${result.totalActive}`);
    console.log(`  Category Mapped: ${result.categoryMapped}`);
    console.log(`  Update Bit Reset: ${result.updateBitReset}`);
    console.log(`  Dry Run:         ${result.dryRun}`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('DAILY DEALS CRON FAILED');
    console.error('='.repeat(50));
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error('Unknown error:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the script
main();
