#!/usr/bin/env node
/**
 * CLI script to fetch Shopify orders
 *
 * Usage:
 *   pnpm fetch-orders --storeId 118
 *   pnpm fetch-orders --storeId 118 --fetchType All
 *   pnpm fetch-orders --storeId 118 --orderId 4567890123
 *   pnpm fetch-orders --help
 */
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { fetchShopifyOrders, type FetchType } from '../modules/shopify/shopify-orders.service';

const program = new Command();

program
  .name('fetch-shopify-orders')
  .description('Fetch orders from Shopify stores and process them')
  .version('1.0.0')
  .requiredOption('-s, --storeId <id>', 'Store ID to fetch orders for')
  .option('-t, --fetchType <type>', 'Fetch type: "All" or "Partial"', 'Partial')
  .option('-o, --orderId <id>', 'Fetch a single Shopify order by ID instead of listing by filters')
  .action(async (options) => {
    const { storeId, fetchType, orderId } = options;

    // Validate fetchType
    if (fetchType !== 'All' && fetchType !== 'Partial') {
      console.error('Error: fetchType must be "All" or "Partial"');
      process.exit(1);
    }

    console.log(`\nFetching Shopify orders...`);
    console.log(`  Store ID: ${storeId}`);
    if (orderId) {
      console.log(`  Order ID: ${orderId}\n`);
    } else {
      console.log(`  Fetch Type: ${fetchType}\n`);
    }

    try {
      const result = await fetchShopifyOrders(storeId, fetchType as FetchType, orderId);

      if (result.success) {
        console.log('Success!');
        console.log(`  Orders fetched: ${result.ordersFetched}`);
        console.log(`  Orders processed: ${result.ordersProcessed}`);
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.error}`);
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
