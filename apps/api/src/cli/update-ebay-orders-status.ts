#!/usr/bin/env node
/**
 * CLI script to update order statuses to eBay
 *
 * Usage:
 *   npx tsx src/cli/update-ebay-orders-status.ts
 *   npx tsx src/cli/update-ebay-orders-status.ts --help
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
  const { updateEbayOrderStatusesToEbay } = await import('../modules/ebay/ebay-status-update.service.js');

  const program = new Command();

  program
    .name('update-ebay-orders-status')
    .description('Update order statuses (Shipped with tracking) to eBay Trading API')
    .version('1.0.0')
    .action(async () => {
      console.log(`\nUpdating order statuses to eBay...`);
      console.log(`  Store ID: ${config.EBAY_STORE_ID || 'Not configured'}\n`);

      try {
        const result = await updateEbayOrderStatusesToEbay();

        if (result.success) {
          console.log('Success!');
          console.log(`  Processed: ${result.processed}`);
          console.log(`  Succeeded: ${result.succeeded}`);
          console.log(`  Failed: ${result.failed}`);
          process.exit(0);
        } else {
          console.error('Failed!');
          console.error(`  Error: ${(result as any).error || 'Unknown error'}`);
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
}

main().catch(console.error);
