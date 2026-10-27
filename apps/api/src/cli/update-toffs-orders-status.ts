#!/usr/bin/env node
/**
 * CLI script to update order statuses to TOFFS
 *
 * Usage:
 *   pnpm update-toffs-orders-status
 *   pnpm update-toffs-orders-status --help
 */
import { config } from '../config';
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateToffsOrderStatusesToToffs } from '../modules/toffs/toffs-orders.service';

const program = new Command();

program
  .name('update-toffs-orders-status')
  .description('Update order statuses (Fulfilled/Cancelled) to TOFFS stores')
  .version('1.0.0')
  .action(async () => {
    console.log(`\nUpdating order statuses to TOFFS...`);
    console.log(`  Store IDs: ${config.TOFFS_STORE_ID || 'Not configured'}\n`);

    try {
      const result = await updateToffsOrderStatusesToToffs();

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
