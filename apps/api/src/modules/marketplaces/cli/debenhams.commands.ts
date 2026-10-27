/**
 * Debenhams CLI Commands
 *
 * Command-line interface for Debenhams/Mirakl marketplace operations.
 *
 * Usage:
 *   npx tsx apps/api/src/cli.ts debenhams populate-listings [--dry-run] [--limit N]
 *   npx tsx apps/api/src/cli.ts debenhams sync-listings
 *   npx tsx apps/api/src/cli.ts debenhams create-offers [--dry-run] [--limit N]
 *   npx tsx apps/api/src/cli.ts debenhams sync-inventory [--full] [--batch-size N]
 *   npx tsx apps/api/src/cli.ts debenhams listing-counts
 *   npx tsx apps/api/src/cli.ts debenhams show-config
 */

import { Command } from 'commander';
import { createDebenhamsAdapter, loadDebenhamsConfig } from '../adapters/debenhams';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('debenhams-cli');

/**
 * Register Debenhams CLI commands.
 */
export function registerDebenhamsCommands(program: Command): void {
  const debenhams = program
    .command('debenhams')
    .description('Debenhams/Mirakl marketplace commands');

  // Populate Listings Command
  debenhams
    .command('populate-listings')
    .description('Populate marketplace listings table from UKSS source data (syncAllowed=false)')
    .option('--dry-run', 'Show what would be inserted without making changes')
    .option('--limit <count>', 'Limit number of records to process', '0')
    .action(async (options) => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('Creating Debenhams adapter...');
        const adapter = createDebenhamsAdapter(config);

        const limit = parseInt(options.limit, 10);
        console.log(`\nPopulating listings (syncAllowed=false)${options.dryRun ? ' (dry run)' : ''}...`);

        const result = await adapter.populateListings({
          limit: limit > 0 ? limit : undefined,
          dryRun: options.dryRun,
        });

        console.log(`\n✓ Population ${options.dryRun ? 'would complete' : 'completed'}`);
        console.log(`  Total: ${result.total}`);
        console.log(`  Inserted: ${result.inserted}`);
        console.log(`  Updated: ${result.updated}`);
        console.log(`  Errors: ${result.errors}`);

      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Populate listings command failed');
        process.exit(1);
      }
    });

  // Sync Listings Command (full sync: add new, deactivate removed, refresh existing)
  debenhams
    .command('sync-listings')
    .description('Full sync: add new products (syncAllowed=false), deactivate removed, refresh existing')
    .action(async () => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('Creating Debenhams adapter...');
        const adapter = createDebenhamsAdapter(config);

        console.log('\nStarting full listing sync...');
        const result = await adapter.syncListings();

        console.log(`\n✓ Full sync completed`);
        console.log(`  New products added: ${result.added.inserted} (syncAllowed=false)`);
        console.log(`  Products deactivated: ${result.deactivated.deactivated}`);
        console.log(`  Listings refreshed: ${result.refreshed.updated}`);

      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Sync listings command failed');
        process.exit(1);
      }
    });

  // Create Offers Command
  debenhams
    .command('create-offers')
    .description('Create offers on Mirakl for listings with externalProductId and syncAllowed=false')
    .option('--dry-run', 'Show what would be created without making API calls')
    .option('--limit <count>', 'Limit number of offers to create', '0')
    .action(async (options) => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('Creating Debenhams adapter...');
        const adapter = createDebenhamsAdapter(config);

        const limit = parseInt(options.limit, 10);
        console.log(`\nCreating offers on Mirakl${options.dryRun ? ' (dry run)' : ''}${limit > 0 ? ` (limit: ${limit})` : ''}...`);

        const result = await adapter.createOffers({
          limit: limit > 0 ? limit : undefined,
          dryRun: options.dryRun,
        });

        if (result.success) {
          console.log('\n✓ Offer creation completed');
          console.log(`  Offers submitted: ${result.offersSubmitted}`);
          console.log(`  Offers failed: ${result.offersFailed}`);
          if (result.importId) {
            console.log(`  Mirakl import ID: ${result.importId}`);
          }
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Offer creation failed');
          console.error(`  Offers submitted: ${result.offersSubmitted}`);
          console.error(`  Offers failed: ${result.offersFailed}`);
          if (result.errors.length > 0) {
            console.error('  Errors:');
            result.errors.slice(0, 5).forEach((e) => {
              console.error(`    - ${e.sku}: ${e.error}`);
            });
            if (result.errors.length > 5) {
              console.error(`    ... and ${result.errors.length - 5} more`);
            }
          }
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Create offers command failed');
        process.exit(1);
      }
    });

  // Sync Inventory Command
  debenhams
    .command('sync-inventory')
    .description('Sync inventory and prices to Mirakl via OF24 API (syncAllowed=true items only)')
    .option('--full', 'Sync all items, not just changes')
    .option('--batch-size <size>', 'Items per API request', '100')
    .option('--dry-run', 'Show what would be synced without making API calls')
    .action(async (options) => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('Creating Debenhams adapter...');
        const adapter = createDebenhamsAdapter(config);

        const batchSize = parseInt(options.batchSize, 10);
        console.log(`\nSyncing inventory${options.full ? ' (full)' : ' (delta)'}${options.dryRun ? ' (dry run)' : ''}...`);

        const result = await adapter.syncInventory({
          full: options.full,
          batchSize,
          dryRun: options.dryRun,
        });

        if (result.success) {
          console.log('\n✓ Inventory sync completed');
          console.log(`  Processed: ${result.itemsProcessed}`);
          console.log(`  Failed: ${result.itemsFailed}`);
          if (result.importIds.length > 0) {
            console.log(`  Mirakl import IDs: ${result.importIds.join(', ')}`);
          }
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Inventory sync completed with errors');
          console.error(`  Processed: ${result.itemsProcessed}`);
          console.error(`  Failed: ${result.itemsFailed}`);
          if (result.errors.length > 0) {
            console.error('  Errors:');
            result.errors.slice(0, 5).forEach((e) => {
              console.error(`    - ${e.sku}: ${e.error}`);
            });
            if (result.errors.length > 5) {
              console.error(`    ... and ${result.errors.length - 5} more`);
            }
          }
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Sync inventory command failed');
        process.exit(1);
      }
    });

  // Listing Counts Command
  debenhams
    .command('listing-counts')
    .description('Show listing counts for Debenhams')
    .action(async () => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('Creating Debenhams adapter...');
        const adapter = createDebenhamsAdapter(config);

        const counts = await adapter.getListingCounts();

        console.log('\nDebenhams Listing Counts');
        console.log('========================');
        console.log(`Total: ${counts.total}`);
        console.log(`Active: ${counts.active}`);
        console.log(`Not created on marketplace: ${counts.notCreatedOnMarketplace}`);
        console.log(`Sync not allowed (offer needed): ${counts.syncNotAllowed}`);
        console.log(`New (never synced): ${counts.newItems}`);
        console.log(`Synced: ${counts.synced}`);
        console.log(`Failed: ${counts.failed}`);

      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Listing counts command failed');
        process.exit(1);
      }
    });

  // Show Config Command
  debenhams
    .command('show-config')
    .description('Display Debenhams/Mirakl configuration')
    .action(async () => {
      try {
        console.log('Loading Debenhams configuration...');
        const config = loadDebenhamsConfig();

        console.log('\nDebenhams/Mirakl Configuration');
        console.log('===============================');
        console.log(`Store ID: ${config.storeId}`);
        console.log(`API Base URL: ${config.apiBaseUrl}`);
        console.log(`API Key: ****${config.apiKey.substring(config.apiKey.length - 4)}`);
        console.log(`Shop ID: ${config.shopId}`);
        console.log(`API Timeout: ${config.apiTimeoutMs}ms`);
        console.log(`Inventory Batch Size: ${config.inventoryBatchSize}`);
        console.log(`Excluded Manufacturers: ${config.excludedManufacturerIds.join(', ') || 'None'}`);
        console.log(`Excluded Product Types: ${config.excludedProductTypeIds.join(', ') || 'None'}`);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      }
    });
}
