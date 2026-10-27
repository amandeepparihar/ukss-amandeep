#!/usr/bin/env node
/**
 * CLI script to fetch Allegro orders
 *
 * Usage:
 *   npx tsx src/cli/fetch-allegro-orders.ts
 *   npx tsx src/cli/fetch-allegro-orders.ts --help
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { fetchAllegroOrders } from '../modules/allegro/allegro-order-service';

const program = new Command();

program
  .name('fetch-allegro-orders')
  .description('Fetch orders from Allegro API and save in marketplace orders tables')
  .version('1.0.0')
  .action(async () => {
    console.log(`\nFetching Allegro orders...\n`);

    try {
      const result = await fetchAllegroOrders();

      if (result.success) {
        console.log('Success!');
        console.log(`  Found: ${result.ordersFound}, Inserted: ${result.ordersInserted}, Skipped: ${result.ordersSkipped}, Failed: ${result.ordersFailed}`);
        console.log(`  Duration: ${result.duration}ms`);
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.message}`);
        if (result.errors.length > 0) {
          console.error(`  Errors: ${result.errors.map(e => `${e.orderId}: ${e.error}`).join(', ')}`);
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
