#!/usr/bin/env node
/**
 * CLI script to update order statuses to Allegro
 *
 * Usage:
 *   npx tsx src/cli/update-allegro-orders-status.ts
 *   npx tsx src/cli/update-allegro-orders-status.ts --help
 */

import { config } from '../config';
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateAllegroOrderStatusesToAllegro } from '../modules/allegro/allegro-status-update.service';

const program = new Command();

program
  .name('update-allegro-orders-status')
  .description('Update order statuses (Shipped/Cancelled) to Allegro')
  .version('1.0.0')
  .action(async () => {
    console.log(`\nUpdating order statuses to Allegro...`);
    console.log(`  Store ID: ${config.ALLEGRO_STORE_ID || 'Not configured'}\n`);

    try {
      const result = await updateAllegroOrderStatusesToAllegro();

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
