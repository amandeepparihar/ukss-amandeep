/**
 * Seller Dynamics CLI Commands
 *
 * Command-line interface for Seller Dynamics order operations.
 * Store ID is configured in .env (SELLER_DYNAMICS_STORE_ID).
 *
 * Usage:
 *   pnpm cli sd fetch-orders
 *   pnpm cli sd update-status
 */

import { Command } from 'commander';
import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';
import { fetchSdOrders } from '../../seller-dynamics/sd-order-service';
import { updateSdOrderStatuses } from '../../seller-dynamics/sd-status-update.service';

/**
 * Register Seller Dynamics CLI commands.
 */
export function registerSellerDynamicsCommands(program: Command): void {
  const sd = program
    .command('sd')
    .description('Seller Dynamics marketplace commands');

  sd
    .command('fetch-orders')
    .description('Fetch orders from Seller Dynamics API (Flag=UKSS, UKSS-POD or UKSS-CUST)')
    .action(async () => {
      console.log('\nFetching Seller Dynamics orders...');
      console.log(`  Store ID: ${config.SELLER_DYNAMICS_STORE_ID}`);
      console.log(`  Flag filter: UKSS, UKSS-POD, UKSS-CUST\n`);

      try {
        const result = await fetchSdOrders();

        if (result.success) {
          console.log('\nOrder fetch completed');
          console.log(`  Found: ${result.ordersFound}`);
          console.log(`  Inserted: ${result.ordersInserted}`);
          console.log(`  Skipped: ${result.ordersSkipped}`);
          console.log(`  Failed: ${result.ordersFailed}`);
          console.log(`  Duration: ${result.duration}ms`);
          process.exit(0);
        } else {
          console.error('\nOrder fetch failed');
          console.error(`  Error: ${result.message}`);
          if (result.errors && result.errors.length > 0) {
            console.error(`  Errors: ${result.errors.map(e => `${e.orderId}: ${e.error}`).join(', ')}`);
          }
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\nError: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  sd
    .command('update-status')
    .description('Push order status updates (Shipped) to Seller Dynamics, email Simon for cancel/reject')
    .action(async () => {
      console.log('\nUpdating order statuses to Seller Dynamics...');
      console.log(`  Store ID: ${config.SELLER_DYNAMICS_STORE_ID}\n`);

      try {
        const result = await updateSdOrderStatuses();

        if (result.success) {
          console.log('\nStatus update completed');
          console.log(`  Processed: ${result.processed}`);
          console.log(`  Succeeded: ${result.succeeded}`);
          console.log(`  Failed: ${result.failed}`);
          process.exit(0);
        } else {
          console.error('\nStatus update failed');
          console.error(`  Error: ${result.error || 'Unknown error'}`);
          console.error(`  Processed: ${result.processed}`);
          console.error(`  Succeeded: ${result.succeeded}`);
          console.error(`  Failed: ${result.failed}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\nError: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });
}
