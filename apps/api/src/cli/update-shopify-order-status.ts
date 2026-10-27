#!/usr/bin/env node
/**
 * CLI script to update order statuses to Shopify
 *
 * Usage:
 *   pnpm update-shopify-order-status
 *   pnpm update-shopify-order-status --help
 */
import { config } from '../config';
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateOrderStatusesToShopify } from '../modules/shopify/shopify-orders.service';

const program = new Command();

program
  .name('update-shopify-order-status')
  .description('Update order statuses (Fulfilled/Cancelled) to Shopify stores')
  .version('1.0.0')
  .action(async () => {
    console.log(`\nUpdating order statuses to Shopify...`);
    console.log(`  Store IDs: ${config.SHOPIFY_STORE_IDS_FOR_ORDER_STATUS_UPDATE || 'Not configured'}\n`);

    try {
      const result = await updateOrderStatusesToShopify();

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
