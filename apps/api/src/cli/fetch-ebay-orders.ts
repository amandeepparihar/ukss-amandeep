#!/usr/bin/env node
/**
 * CLI script to fetch eBay orders
 *
 * Usage:
 *   npx tsx src/cli/fetch-ebay-orders.ts
 *   npx tsx src/cli/fetch-ebay-orders.ts --help
 */

// Load environment variables BEFORE any other imports
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (three levels up from apps/api/src/cli)
const envPath = resolve(__dirname, '../../../../.env');
loadEnv({ path: envPath });

// Use dynamic imports to ensure env is loaded first
async function main() {
  const { config } = await import('../config/index.js');
  const { Command } = await import('commander');
  const { prisma } = await import('../lib/prisma.js');
  const { fetchEbayOrders } = await import('../modules/ebay/ebay-order-service.js');

  const program = new Command();

  program
    .name('fetch-ebay-orders')
    .description('Fetch orders from eBay Trading API and save in marketplace orders tables')
    .version('1.0.0')
    .action(async () => {
      console.log(`\nFetching eBay orders...`);
      console.log(`  Store ID: ${config.EBAY_STORE_ID || 'Not configured'}\n`);

      try {
        const result = await fetchEbayOrders();

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
}

main().catch(console.error);
