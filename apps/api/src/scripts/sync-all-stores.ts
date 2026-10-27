#!/usr/bin/env node
/**
 * Sync All Active Stores - CLI Script
 * 
 * Syncs marketplace inventory for all active stores
 * 
 * Usage:
 *   npm run sync:all-stores
 *   ts-node src/scripts/sync-all-stores.ts
 */

import 'dotenv/config';
import { syncStoreInventory } from '../modules/marketplace-sync/marketplace-sync.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

interface StoreResult {
  storeId: number;
  storeName: string;
  success: boolean;
  successCount: number;
  failureCount: number;
  total: number;
  error?: string;
}

async function getAllActiveStores(): Promise<Array<{ storeId: number; storeName: string }>> {
  const stores = await prisma.storeManagement.findMany({
    where: {
      status: '1', // Active stores
    },
    select: {
      storeId: true,
      storeName: true,
    },
    orderBy: {
      storeId: 'asc',
    },
  });

  return stores;
}

async function main() {
  console.log('🚀 Starting marketplace sync for all active stores...');
  console.log('');

  try {
    // Get all active stores
    const stores = await getAllActiveStores();

    if (stores.length === 0) {
      console.log('⚠️  No active stores found');
      process.exit(0);
    }

    console.log(`📦 Found ${stores.length} active store(s)`);
    console.log('');

    const results: StoreResult[] = [];

    // Sync each store
    for (let i = 0; i < stores.length; i++) {
      const store = stores[i];
      console.log(`[${i + 1}/${stores.length}] Syncing: ${store.storeName} (ID: ${store.storeId})`);
      console.log('─'.repeat(60));

      try {
        const result = await syncStoreInventory(store.storeId);

        results.push({
          storeId: store.storeId,
          storeName: store.storeName,
          success: result.success,
          successCount: result.successCount,
          failureCount: result.failureCount,
          total: result.total,
        });

        console.log(`✅ ${store.storeName}: ${result.successCount}/${result.total} items synced`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          storeId: store.storeId,
          storeName: store.storeName,
          success: false,
          successCount: 0,
          failureCount: 0,
          total: 0,
          error: errorMessage,
        });

        console.error(`❌ ${store.storeName}: FAILED - ${errorMessage}`);
      }

      console.log('');
    }

    // Print summary
    console.log('');
    console.log('═'.repeat(70));
    console.log('📊 OVERALL SYNC SUMMARY');
    console.log('═'.repeat(70));
    console.log('');

    let totalItems = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let storesSucceeded = 0;
    let storesFailed = 0;

    results.forEach((result) => {
      const status = result.success ? '✅' : '❌';
      const error = result.error ? ` (${result.error})` : '';
      console.log(
        `${status} ${result.storeName.padEnd(30)} | Total: ${result.total.toString().padStart(3)} | ` +
        `Success: ${result.successCount.toString().padStart(3)} | Failed: ${result.failureCount.toString().padStart(3)}${error}`
      );

      totalItems += result.total;
      totalSuccess += result.successCount;
      totalFailed += result.failureCount;

      if (result.success) {
        storesSucceeded++;
      } else {
        storesFailed++;
      }
    });

    console.log('');
    console.log('─'.repeat(70));
    console.log(`Stores Processed: ${results.length}`);
    console.log(`  ✅ Succeeded: ${storesSucceeded}`);
    console.log(`  ❌ Failed: ${storesFailed}`);
    console.log('');
    console.log(`Total Items: ${totalItems}`);
    console.log(`  ✅ Synced Successfully: ${totalSuccess}`);
    console.log(`  ❌ Failed: ${totalFailed}`);
    console.log('═'.repeat(70));

    // Exit with error if any store failed
    process.exit(storesFailed > 0 ? 1 : 0);
  } catch (error) {
    console.error('');
    console.error('❌ CRITICAL ERROR');
    console.error('═'.repeat(70));
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

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the script
main();
