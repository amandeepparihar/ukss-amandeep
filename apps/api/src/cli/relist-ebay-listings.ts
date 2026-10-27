#!/usr/bin/env node
/**
 * eBay Relist-Ended CLI Script
 *
 * Relists eBay listings that ended (error 21916750 "FixedPrice item ended") but
 * still have stock, via RelistFixedPriceItem. DRY-RUN by default — pass --live to
 * actually relist on eBay and update the DB.
 *
 * Usage:
 *   node dist/cli/relist-ebay-listings.js [storeId] [--live] [--limit N] [--item-ids a,b]
 *   pnpm tsx src/cli/relist-ebay-listings.ts 94                 # dry-run, store 94
 *   pnpm tsx src/cli/relist-ebay-listings.ts 94 --live --limit 2 --item-ids 1234,5678
 *
 * storeId defaults to EBAY_STORE_ID when omitted.
 */

import 'dotenv/config';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { runWithExecution, getLogger } from '../lib/logger-context';
import { isEbaySandboxEnvironment } from '../lib/ebay/ebay-oauth';
import { relistEndedEbayListings } from '../modules/ebay/ebay-relist.service';

/** Minimal argv parser: first non-flag token = storeId; supports --live, --limit, --item-ids. */
function parseArgs(argv: string[]) {
  let storeId: number | undefined;
  let live = false;
  let limit = 50;
  let itemIds: string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') {
      live = true;
    } else if (a === '--limit') {
      limit = parseInt(argv[++i], 10);
    } else if (a.startsWith('--limit=')) {
      limit = parseInt(a.split('=')[1], 10);
    } else if (a === '--item-ids') {
      itemIds = argv[++i]?.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--item-ids=')) {
      itemIds = a.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (!a.startsWith('--') && storeId === undefined) {
      storeId = parseInt(a, 10);
    }
  }

  return { storeId, live, limit, itemIds };
}

async function main() {
  const { storeId: storeIdArg, live, limit, itemIds } = parseArgs(process.argv.slice(2));
  const storeId = storeIdArg ?? config.EBAY_STORE_ID;

  if (isNaN(storeId) || storeId <= 0) {
    console.error('❌ Error: storeId must be a positive number (or set EBAY_STORE_ID)');
    process.exit(1);
  }
  if (isNaN(limit) || limit <= 0) {
    console.error('❌ Error: --limit must be a positive number');
    process.exit(1);
  }

  await runWithExecution('ebay-relist-cli', async () => {
    const logger = getLogger();
    const dryRun = !live;

    console.log('🔁 eBay relist-ended (error 21916750, stock > 0)');
    console.log(`📦 Store ID: ${storeId}`);
    console.log(`🌐 Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
    console.log(`🧪 Mode: ${dryRun ? 'DRY-RUN (no eBay write, no DB change)' : 'LIVE (will relist on eBay)'}`);
    console.log(`🔢 Limit: ${limit}${itemIds ? ` | ItemIDs: ${itemIds.join(', ')}` : ''}`);
    if (!dryRun) {
      console.log('⚠️  LIVE: RelistFixedPriceItem creates NEW listings (new ItemIDs). This is IRREVERSIBLE.');
    }
    console.log('');

    logger.info(
      { scriptName: 'relist-ebay-listings', storeId, dryRun, limit, itemIds, executionSource: 'cli' },
      'CLI script started'
    );

    try {
      const result = await relistEndedEbayListings({ storeId, dryRun, limit, itemIds });

      console.log('═══════════════════════════════════════════════');
      console.log(`Candidate rows:              ${result.candidateRows}`);
      console.log(`Distinct listings (ItemIDs): ${result.distinctItems}`);
      console.log(`${dryRun ? 'Would reactivate (LIVE on eBay):' : 'Reactivated (LIVE on eBay):     '} ${result.reactivated}`);
      console.log(`${dryRun ? 'Would relist (ended):          ' : 'Relisted (new ItemID):         '} ${result.relisted}`);
      console.log(`Failed:                      ${result.failed}`);
      console.log(`Gone (not found on eBay):    ${result.gone}`);
      console.log(`Unknown (unverifiable):      ${result.unknown}`);
      console.log(`Skipped (not in --item-ids): ${result.skipped}`);
      console.log('═══════════════════════════════════════════════');

      for (const o of result.outcomes.slice(0, 200)) {
        const detail = o.newItemId ? `-> new ${o.newItemId}` : (o.errorCode ? `[${o.errorCode}]` : '');
        console.log(`  ${o.action.padEnd(11)} item=${o.itemId.padEnd(14)} rows=${String(o.rows).padStart(2)} ${detail}`);
      }
      if (result.outcomes.length > 200) {
        console.log(`  … and ${result.outcomes.length - 200} more`);
      }

      // Dry-run always succeeds; a live run fails only if every relist attempt failed.
      const ok = dryRun || result.failed === 0;
      process.exit(ok ? 0 : 1);
    } catch (error) {
      console.error('❌ RELIST FAILED WITH EXCEPTION');
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
