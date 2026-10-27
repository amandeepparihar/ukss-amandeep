#!/usr/bin/env node
/**
 * CLI script to process marketplace orders to UKSS
 *
 * Usage:
 *   pnpm process-marketplace-orders
 *   pnpm process-marketplace-orders --limit 10
 *   pnpm process-marketplace-orders --help
 */
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { processMarketplaceOrdersToUKSS } from '../modules/marketplace-orders/marketplace-orders.service';

const program = new Command();

program
  .name('process-marketplace-orders')
  .description('Process pending marketplace orders and convert them to UKSS orders')
  .version('1.0.0')
  .option('-l, --limit <number>', 'Limit the number of orders to process', parseInt)
  .action(async (options) => {
    const { limit } = options;

    console.log(`\nProcessing marketplace orders to UKSS...`);
    if (limit) {
      console.log(`  Limit: ${limit}`);
    } else {
      console.log(`  Limit: No limit (processing all pending orders)`);
    }
    console.log('');

    try {
      const result = await processMarketplaceOrdersToUKSS(limit);

      if (result.success) {
        console.log('Completed!');
        console.log(`  Orders processed: ${result.processed}`);
        console.log(`  Orders failed: ${result.failed}`);
        if (result.duration) {
          console.log(`  Duration: ${result.duration}ms`);
        }
        if (result.errors && result.errors.length > 0) {
          console.log('\nErrors:');
          result.errors.forEach((err, index) => {
            console.log(`  ${index + 1}. Order ${err.orderId}: ${err.error}`);
          });
        }
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.error}`);
        if (result.errors && result.errors.length > 0) {
          console.log('\nDetailed Errors:');
          result.errors.forEach((err, index) => {
            console.log(`  ${index + 1}. Order ${err.orderId}: ${err.error}`);
          });
        }
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
