/**
 * CLI script to update Debenhams order statuses
 *
 * Pushes Ship/Cancel status updates to Debenhams (Mirakl) API.
 *
 * Usage:
 *   pnpm update-debenhams-orders-status
 *   pnpm update-debenhams-orders-status --help
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateDebenhamsOrderStatuses } from '../modules/debenhams/debenhams-status-update.service';

const program = new Command();

program
  .name('update-debenhams-orders-status')
  .description('Update order statuses on Debenhams (Mirakl) - Ship, Cancel')
  .version('1.0.0')
  .action(async () => {
    console.log('\nUpdating Debenhams order statuses...');

    try {
      const result = await updateDebenhamsOrderStatuses();

      if (result.success) {
        console.log('Success!');
      } else {
        console.log('Completed with errors');
      }

      console.log(`  Processed: ${result.processed}`);
      console.log(`  Succeeded: ${result.succeeded}`);
      console.log(`  Failed: ${result.failed}`);

      if (result.error) {
        console.error(`  Error: ${result.error}`);
      }

      // Show detailed results if any
      if (result.results && result.results.length > 0) {
        console.log('\nDetailed results:');
        for (const r of result.results) {
          const status = r.success ? 'OK' : 'FAILED';
          console.log(`  [${status}] Order ${r.orderId} - ${r.status}${r.error ? ` (${r.error})` : ''}`);
        }
      }

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse();
