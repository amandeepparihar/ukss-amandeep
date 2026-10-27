/**
 * CLI script to fetch Debenhams orders
 *
 * Usage:
 *   pnpm fetch-debenhams-orders
 *   pnpm fetch-debenhams-orders --orderId DUX500080217-A
 *   pnpm fetch-debenhams-orders --help
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { getDebenhamsOrders } from '../modules/debenhams/debenhams-orders.service';

const program = new Command();

program
  .name('fetch-debenhams-orders')
  .description('Fetch orders from Debenhams (Mirakl) and save in Marketplace orders tables')
  .version('1.0.0')
  .option('-o, --orderId <id>', 'Specific order ID to fetch from Debenhams')
  .action(async (options) => {
    const { orderId } = options;

    console.log('\nFetching Debenhams orders...');
    if (orderId) {
      console.log(`  Order ID: ${orderId}`);
    } else {
      console.log('  Fetching all SHIPPING orders');
    }

    try {
      const result = await getDebenhamsOrders(orderId);

      if (result.success) {
        console.log('Success!');
        console.log(`  Message: ${result.message}`);
        if (result.orderCount !== undefined) {
          console.log(`  Orders processed: ${result.orderCount}`);
        }
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.message}`);
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
