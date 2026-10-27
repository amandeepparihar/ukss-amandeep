#!/usr/bin/env node
/**
 * Marketplace Inventory Sync CLI Script
 * 
 * Usage:
 *   npm run sync:marketplace -- 145
 *   node dist/scripts/sync-marketplace-inventory.js 145
 *   ts-node src/scripts/sync-marketplace-inventory.ts 145
 */

import 'dotenv/config';
import { syncStoreInventory } from '../modules/marketplace-sync/marketplace-sync.service';
import { prisma } from '../lib/prisma';
import { runWithExecution, getLogger } from '../lib/logger-context';

async function main() {
  // Get store ID from command line arguments
  const storeId = process.argv[2];  

  if (!storeId) {
    console.error('❌ Error: Store ID is required');
    console.error('Usage: npm run sync:marketplace -- <storeId>');
    console.error('Example: npm run sync:marketplace -- 145');
    process.exit(1);
  }

  const storeIdNum = parseInt(storeId, 10);

  if (isNaN(storeIdNum) || storeIdNum <= 0) {
    console.error('❌ Error: Store ID must be a positive number');
    process.exit(1);
  }

  // Establish execution context for this CLI run (logs to console + logs/marketplace-sync-cli/log.txt)
  await runWithExecution('marketplace-sync-cli', async () => {
    const logger = getLogger();
    
    console.log('🚀 Starting marketplace inventory sync...');
    console.log(`📦 Store ID: ${storeIdNum}`);
    console.log('');
    
    logger.info({ 
      scriptName: 'sync-marketplace-inventory',
      storeId: storeIdNum,
      executionSource: 'cli'
    }, 'CLI script started');

    try {
      // Run the sync
      const result = await syncStoreInventory(storeIdNum);

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('📊 SYNC RESULTS');
    console.log('═══════════════════════════════════════════════');
    console.log(`Store: ${result.storeName} (ID: ${result.storeId})`);
    console.log(`Total Items: ${result.total}`);
    console.log(`✅ Success: ${result.successCount}`);
    console.log(`❌ Failed: ${result.failureCount}`);
    console.log(`Status: ${result.success ? '✅ COMPLETED' : '❌ FAILED'}`);
    console.log('═══════════════════════════════════════════════');
    console.log('');
    console.log('Message:');
    console.log(result.message);

        // Exit with appropriate code
        process.exit(result.success ? 0 : 1);
      } catch (error) {
        console.error('');
        console.error('❌ SYNC FAILED WITH EXCEPTION');
        console.error('═══════════════════════════════════════════════');
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          if (error.stack) {
            console.error('');
            console.error('Stack trace:');
            console.error(error.stack);
          }
        } else {
          console.error('Unknown error:', error);
        }
        process.exit(1);
      } finally {
        // Clean up database connections
        await prisma.$disconnect();
        logger.info('Database connections closed');
      }
    }
  );
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the script
main();
