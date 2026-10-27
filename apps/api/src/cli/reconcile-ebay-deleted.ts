#!/usr/bin/env node
/**
 * eBay False-Delete Reconciliation CLI Script
 *
 * Finds rows marked terminal `deleted` for error 21916750 ("FixedPrice item ended")
 * whose listing is actually still LIVE on eBay (OutOfStockControl false-ends), and
 * reactivates them so the normal sync resumes. DRY-RUN by default — pass --live to
 * apply.
 *
 * Usage:
 *   node dist/cli/reconcile-ebay-deleted.js [storeId] [--live]
 *   pnpm tsx src/cli/reconcile-ebay-deleted.ts 94            # dry-run, store 94
 */

import 'dotenv/config';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { runWithExecution, getLogger } from '../lib/logger-context';
import { isEbaySandboxEnvironment } from '../lib/ebay/ebay-oauth';
import { reconcileEbayFalseDeletes } from '../modules/ebay/ebay-reconcile.service';

async function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  const storeArg = argv.find((a) => !a.startsWith('--'));
  const storeId = storeArg ? parseInt(storeArg, 10) : config.EBAY_STORE_ID;

  if (isNaN(storeId) || storeId <= 0) {
    console.error('❌ Error: storeId must be a positive number (or set EBAY_STORE_ID)');
    process.exit(1);
  }

  await runWithExecution('ebay-reconcile-cli', async () => {
    const logger = getLogger();
    const dryRun = !live;

    console.log('🔎 eBay reconcile-deleted (false-delete cleanup)');
    console.log(`📦 Store ID: ${storeId}`);
    console.log(`🌐 Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
    console.log(`🧪 Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (reactivate)'}`);
    console.log('');

    logger.info(
      { scriptName: 'reconcile-ebay-deleted', storeId, dryRun, executionSource: 'cli' },
      'CLI script started'
    );

    try {
      const r = await reconcileEbayFalseDeletes({ storeId, dryRun });

      console.log('═══════════════════════════════════════════════');
      console.log(`Active listings on eBay:        ${r.activeOnEbay}`);
      console.log(`Rows marked deleted (21916750): ${r.deletedEndedRows} (${r.distinctDeletedItems} distinct ItemIDs)`);
      console.log(`Still LIVE on eBay (false):     ${r.liveItems} ItemIDs`);
      console.log(`${dryRun ? 'Rows that WOULD reactivate:    ' : 'Rows reactivated:              '} ${r.rowsReactivated}`);
      console.log(`Genuinely ended:                ${r.genuinelyEndedItems} ItemIDs`);
      console.log('═══════════════════════════════════════════════');

      process.exit(0);
    } catch (error) {
      console.error('❌ RECONCILE FAILED WITH EXCEPTION');
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
        if (error.stack) console.error(error.stack);
      } else {
        console.error('Unknown error:', error);
      }
      process.exit(1);
    } finally {
      await prisma.$disconnect();
      logger.info('Database connections closed');
    }
  });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main();
