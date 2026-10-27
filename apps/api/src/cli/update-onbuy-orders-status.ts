#!/usr/bin/env node
/**
 * CLI script to push pending OnBuy order statuses (Shipped / Cancelled) to OnBuy.
 *
 * Usage:
 *   npx tsx apps/api/src/cli/update-onbuy-orders-status.ts
 *   npx tsx apps/api/src/cli/update-onbuy-orders-status.ts --help
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateOnbuyOrderStatusesToOnbuy } from '../modules/onbuy/onbuy-status-update.service';

const program = new Command();

program
  .name('update-onbuy-orders-status')
  .description('Push pending order statuses (Shipped/Cancelled) to OnBuy')
  .version('1.0.0')
  .action(async () => {
    console.log('\nUpdating order statuses to OnBuy...\n');

    try {
      const result = await updateOnbuyOrderStatusesToOnbuy();

      if (result.success) {
        console.log('Success!');
        console.log(`  Processed: ${result.processed}`);
        console.log(`  Succeeded: ${result.succeeded}`);
        console.log(`  Failed: ${result.failed}`);
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.error}`);
        console.error(`  Processed: ${result.processed}`);
        console.error(`  Succeeded: ${result.succeeded}`);
        console.error(`  Failed: ${result.failed}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse();
