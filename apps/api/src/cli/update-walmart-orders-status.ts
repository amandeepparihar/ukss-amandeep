#!/usr/bin/env node
/**
 * CLI script to push pending Walmart order statuses (Confirmed / Shipped / Cancelled) to Walmart.
 *
 * Usage:
 *   Dev:   npx tsx apps/api/src/cli/update-walmart-orders-status.ts
 *   Cron:  docker exec admin-api node /app/dist/cli/update-walmart-orders-status.js
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateWalmartOrderStatusesToWalmart } from '../modules/walmart/walmart-status-update.service';

const program = new Command();

program
  .name('update-walmart-orders-status')
  .description('Push pending order statuses (Confirmed/Shipped/Cancelled) to Walmart')
  .version('1.0.0')
  .action(async () => {
    console.log('\nUpdating order statuses to Walmart...\n');

    try {
      const result = await updateWalmartOrderStatusesToWalmart();

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
