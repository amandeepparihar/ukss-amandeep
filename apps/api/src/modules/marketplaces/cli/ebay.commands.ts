/**
 * eBay CLI Commands
 *
 * Command-line interface for eBay marketplace operations.
 * Store ID is configured in .env (EBAY_STORE_ID), store details fetched from database.
 *
 * Usage:
 *   pnpm cli ebay fetch-orders
 *   pnpm cli ebay update-status
 */

import { Command } from 'commander';
import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';
import { fetchEbayOrders } from '../../ebay/ebay-order-service';
import { updateEbayOrderStatusesToEbay } from '../../ebay/ebay-status-update.service';
import { relistEndedEbayListings } from '../../ebay/ebay-relist.service';
import { reconcileEbayFalseDeletes } from '../../ebay/ebay-reconcile.service';
import { isEbaySandboxEnvironment } from '../../../lib/ebay/ebay-oauth';
import { runEbaySnapshot } from '../../ebay-reconciliation/ebay-snapshot.service';

/**
 * Register eBay CLI commands.
 */
export function registerEbayCommands(program: Command): void {
  const ebay = program
    .command('ebay')
    .description('eBay marketplace commands');

  // Fetch Orders Command
  ebay
    .command('fetch-orders')
    .description('Fetch orders from eBay Trading API')
    .action(async () => {
      const isSandbox = isEbaySandboxEnvironment();
      console.log('\nFetching eBay orders...');
      console.log(`  Store ID: ${config.EBAY_STORE_ID}`);
      console.log(`  Environment: ${isSandbox ? 'SANDBOX' : 'LIVE'}\n`);

      try {
        const result = await fetchEbayOrders();

        if (result.success) {
          console.log('\n✓ Order fetch completed');
          console.log(`  Found: ${result.ordersFound}`);
          console.log(`  Inserted: ${result.ordersInserted}`);
          console.log(`  Skipped: ${result.ordersSkipped}`);
          console.log(`  Failed: ${result.ordersFailed}`);
          console.log(`  Duration: ${result.duration}ms`);
          process.exit(0);
        } else {
          console.error('\n✗ Order fetch failed');
          console.error(`  Error: ${result.message}`);
          if (result.errors && result.errors.length > 0) {
            console.error(`  Errors: ${result.errors.map(e => `${e.orderId}: ${e.error}`).join(', ')}`);
          }
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Update Status Command
  ebay
    .command('update-status')
    .description('Push order status updates to eBay Trading API')
    .action(async () => {
      const isSandbox = isEbaySandboxEnvironment();
      console.log('\n⚠️  WARNING: This will push order status updates to eBay Trading API.');
      console.log('⚠️  Status updates are IRREVERSIBLE. Make sure tracking numbers are correct.\n');
      console.log('Updating order statuses to eBay...');
      console.log(`  Store ID: ${config.EBAY_STORE_ID}`);
      console.log(`  Environment: ${isSandbox ? 'SANDBOX' : 'LIVE'}\n`);

      try {
        const result = await updateEbayOrderStatusesToEbay();

        if (result.success) {
          console.log('\n✓ Status update completed');
          console.log(`  Processed: ${result.processed}`);
          console.log(`  Succeeded: ${result.succeeded}`);
          console.log(`  Failed: ${result.failed}`);
          console.log(`  Duration: ${result.duration}ms`);
          process.exit(0);
        } else {
          console.error('\n✗ Status update failed');
          console.error(`  Error: ${result.error || 'Unknown error'}`);
          console.error(`  Processed: ${result.processed}`);
          console.error(`  Succeeded: ${result.succeeded}`);
          console.error(`  Failed: ${result.failed}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Recover ended-but-stocked listings (error 21916750). DRY-RUN by default.
  // VERIFIES each candidate against eBay (GetItem) first: live -> reactivate,
  // genuinely ended -> relist. Never relists a listing that is still active.
  ebay
    .command('relist-ended')
    .description('Recover eBay listings flagged ended (21916750) with stock: verify on eBay, reactivate if live, relist if ended. Dry-run unless --live.')
    .option('--store-id <id>', 'Store ID to process (defaults to EBAY_STORE_ID)', (v) => parseInt(v, 10))
    .option('--live', 'Apply changes (reactivate / relist + DB writes). Default is a read-only dry-run.', false)
    .option('--limit <n>', 'Max candidate rows to process this run', (v) => parseInt(v, 10), 50)
    .option('--item-ids <csv>', 'Only act on these eBay ItemIDs (comma-separated); others are reported as skipped')
    .action(async (opts: { storeId?: number; live?: boolean; limit: number; itemIds?: string }) => {
      const storeId = opts.storeId ?? config.EBAY_STORE_ID;
      const dryRun = !opts.live;
      const itemIds = opts.itemIds?.split(',').map((s) => s.trim()).filter(Boolean);

      console.log('\neBay relist/recover (error 21916750, stock > 0)');
      console.log(`  Store ID: ${storeId}`);
      console.log(`  Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
      console.log(`  Mode: ${dryRun ? 'DRY-RUN (verify only, no writes)' : 'LIVE (reactivate / relist)'}`);
      console.log(`  Limit: ${opts.limit}${itemIds ? `\n  Restricted to ItemIDs: ${itemIds.join(', ')}` : ''}`);

      try {
        const result = await relistEndedEbayListings({ storeId, dryRun, limit: opts.limit, itemIds });

        console.log('─'.repeat(78));
        console.log(`  Candidate rows:               ${result.candidateRows}`);
        console.log(`  Distinct listings (ItemIDs):  ${result.distinctItems}`);
        console.log(`  ${dryRun ? 'Would reactivate (LIVE):    ' : 'Reactivated (LIVE on eBay): '}  ${result.reactivated}`);
        console.log(`  ${dryRun ? 'Would relist (ended):       ' : 'Relisted (new ItemID):      '}  ${result.relisted}`);
        console.log(`  Failed:                       ${result.failed}`);
        console.log(`  Gone (not on eBay):           ${result.gone}`);
        console.log(`  Unknown (unverifiable):       ${result.unknown}`);
        console.log(`  Skipped (not in --item-ids):  ${result.skipped}`);
        console.log('─'.repeat(78));

        for (const o of result.outcomes.slice(0, 200)) {
          const detail = o.newItemId ? `-> new ${o.newItemId}` : (o.errorCode ? `[${o.errorCode}]` : '');
          console.log(`  ${o.action.padEnd(11)} item=${o.itemId.padEnd(14)} rows=${String(o.rows).padStart(2)} ${detail}`);
        }
        if (result.outcomes.length > 200) console.log(`  … and ${result.outcomes.length - 200} more`);
        console.log('');
        process.exit(0);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Reconcile false-deletes: rows marked deleted (21916750) that are still LIVE on eBay.
  ebay
    .command('reconcile-deleted')
    .description('Find eBay rows marked deleted (21916750) that are still live on eBay and reactivate them. Dry-run unless --live.')
    .option('--store-id <id>', 'Store ID to process (defaults to EBAY_STORE_ID)', (v) => parseInt(v, 10))
    .option('--live', 'Apply: reactivate the false-deleted rows. Default is a read-only dry-run.', false)
    .action(async (opts: { storeId?: number; live?: boolean }) => {
      const storeId = opts.storeId ?? config.EBAY_STORE_ID;
      const dryRun = !opts.live;

      console.log('\neBay reconcile-deleted (false-delete cleanup)');
      console.log(`  Store ID: ${storeId}`);
      console.log(`  Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
      console.log(`  Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (reactivate)'}`);

      try {
        const r = await reconcileEbayFalseDeletes({ storeId, dryRun });
        console.log('─'.repeat(78));
        console.log(`  Active listings on eBay:        ${r.activeOnEbay}`);
        console.log(`  Rows marked deleted (21916750): ${r.deletedEndedRows} (${r.distinctDeletedItems} distinct ItemIDs)`);
        console.log(`  Still LIVE on eBay (false):     ${r.liveItems} ItemIDs`);
        console.log(`  ${dryRun ? 'Rows that WOULD reactivate:   ' : 'Rows reactivated:             '}  ${r.rowsReactivated}`);
        console.log(`  Genuinely ended:                ${r.genuinelyEndedItems} ItemIDs`);
        console.log('─'.repeat(78));
        if (r.liveItemIds.length > 0) {
          console.log(`  False-delete ItemIDs: ${r.liveItemIds.slice(0, 50).join(', ')}${r.liveItemIds.length > 50 ? ` … +${r.liveItemIds.length - 50}` : ''}`);
        }
        console.log('');
        process.exit(0);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Reconciliation snapshot: sweep everything active on eBay, classify against
  // marketplace_listings, persist for the dashboard. Writes unless --dry-run.
  ebay
    .command('snapshot-listings')
    .description('Snapshot all active eBay listings and reconcile against marketplace_listings (dashboard data). Use --dry-run to print counts without writing.')
    .option('--store-id <id>', 'Store ID to process (defaults to EBAY_STORE_ID)', (v) => parseInt(v, 10))
    .option('--dry-run', 'Fetch + classify + print category counts; no DB writes', false)
    .action(async (opts: { storeId?: number; dryRun?: boolean }) => {
      const storeId = opts.storeId ?? config.EBAY_STORE_ID;
      const dryRun = !!opts.dryRun;

      console.log('\neBay reconciliation snapshot');
      console.log(`  Store ID: ${storeId}`);
      console.log(`  Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
      console.log(`  Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (persist snapshot + results)'}\n`);

      try {
        const r = await runEbaySnapshot({ storeId, trigger: 'cron', dryRun });
        console.log('─'.repeat(78));
        console.log(`  Run ID:                 ${r.runId ?? '(dry-run)'}`);
        console.log(`  Pages swept:            ${r.pages}`);
        console.log(`  Active ItemIDs on eBay: ${r.listingsFetched}`);
        console.log(`  Snapshot rows (SKUs):   ${r.variationRows}`);
        console.log(`  Browse checked:         ${r.browseChecked} (unchecked suspects: ${r.browseUnchecked})`);
        console.log('  Categories:');
        for (const [cat, count] of Object.entries(r.categoryCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`    ${cat.padEnd(18)} ${count}`);
        }
        console.log('─'.repeat(78));
        process.exit(0);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });
}
