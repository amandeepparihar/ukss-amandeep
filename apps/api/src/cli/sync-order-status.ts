#!/usr/bin/env node
/**
 * CLI script to sync marketplace order statuses
 *
 * Usage:
 *   pnpm sync-order-status
 *   pnpm sync-order-status --limit 10
 *   pnpm sync-order-status --help
 */
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { syncMarketplaceOrderStatus } from '../modules/order-status-sync/order-status-sync.service';

const program = new Command();

program
  .name('sync-order-status')
  .description('Sync order statuses from UKSS orders to marketplace orders')
  .version('1.0.0')
  .option('-l, --limit <number>', 'Limit the number of order products to process', parseInt)
  .action(async (options) => {
    const { limit } = options;

    console.log(`\nSyncing marketplace order statuses...`);
    if (limit) {
      console.log(`  Limit: ${limit}`);
    } else {
      console.log(`  Limit: No limit (processing all pending)`);
    }
    console.log('');

    try {
      const result = await syncMarketplaceOrderStatus(limit);

      if (result.success) {
        console.log('Completed!');
        console.log(`  Processed: ${result.processed}`);
        console.log(`  Confirmed: ${result.confirmed}`);
        console.log(`  Shipped: ${result.shipped}`);
        console.log(`  Returned: ${result.returned}`);
        console.log(`  Cancelled: ${result.cancelled}`);
        console.log(`  Errors: ${result.errors}`);
        if (result.duration) {
          console.log(`  Duration: ${result.duration}ms`);
        }
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.error}`);
        console.log(`  Processed before failure: ${result.processed}`);
        console.log(`  Errors: ${result.errors}`);
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
