/**
 * Fruugo CLI Commands
 *
 * Command-line interface for Fruugo marketplace operations.
 *
 * Usage:
 *   npx tsx apps/api/src/cli.ts fruugo generate-feed [--dry-run]
 *   npx tsx apps/api/src/cli.ts fruugo sync-inventory [--full] [--batch-size=100]
 *   npx tsx apps/api/src/cli.ts fruugo sync-skus [--page-from=1] [--page-to=N]
 *   npx tsx apps/api/src/cli.ts fruugo validate
 */

import { Command } from 'commander';
import { createFruugoAdapter, loadFruugoConfig } from '../adapters/fruugo';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('fruugo-cli');

/**
 * Register Fruugo CLI commands.
 */
export function registerFruugoCommands(program: Command): void {
  const fruugo = program
    .command('fruugo')
    .description('Fruugo marketplace commands');

  // Generate Feed Command
  fruugo
    .command('generate-feed')
    .description('Generate product feed CSV file for Fruugo')
    .option('--dry-run', 'Show what would be generated without writing file')
    .option('--skip-archive', 'Skip archiving the old feed file')
    .option('--limit <count>', 'Limit number of products to include', '0')
    .option('--chunk-size <size>', 'Chunk size for streaming (default: FEED_CHUNK_SIZE env)', '0')
    .action(async (options) => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        const limit = parseInt(options.limit, 10);
        const chunkSize = parseInt(options.chunkSize, 10);
        console.log(`Generating feed${options.dryRun ? ' (dry run)' : ''}${limit > 0 ? ` (limit: ${limit})` : ''}${chunkSize > 0 ? ` (chunk: ${chunkSize})` : ''}...`);
        const result = await adapter.generateProductFeed({
          dryRun: options.dryRun,
          skipArchive: options.skipArchive,
          limit: limit > 0 ? limit : undefined,
          chunkSize: chunkSize > 0 ? chunkSize : undefined,
        });

        if (result.success) {
          console.log('\n✓ Feed generation completed');
          console.log(`  Items: ${result.itemCount}`);
          if (result.filePath) {
            console.log(`  File: ${result.filePath}`);
          }
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Feed generation failed');
          console.error(`  Error: ${result.error}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Generate feed command failed');
        process.exit(1);
      }
    });

  // Sync Inventory Command
  fruugo
    .command('sync-inventory')
    .description('Push inventory updates to Fruugo')
    .option('--full', 'Sync all items, not just changes')
    .option('--batch-size <size>', 'Items per API request', '100')
    .option('--dry-run', 'Show what would be synced without making API calls')
    .action(async (options) => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();
        config.inventoryBatchSize = parseInt(options.batchSize, 10);

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        console.log(`Syncing inventory${options.full ? ' (full)' : ' (delta)'}${options.dryRun ? ' (dry run)' : ''}...`);
        const result = await adapter.syncInventory({
          full: options.full,
          batchSize: parseInt(options.batchSize, 10),
          dryRun: options.dryRun,
        });

        if (result.success) {
          console.log('\n✓ Inventory sync completed');
          console.log(`  Processed: ${result.itemsProcessed}`);
          console.log(`  Failed: ${result.itemsFailed}`);
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Inventory sync completed with errors');
          console.error(`  Processed: ${result.itemsProcessed}`);
          console.error(`  Failed: ${result.itemsFailed}`);
          if (result.errors && result.errors.length > 0) {
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

  // Sync SKUs Command
  fruugo
    .command('sync-skus')
    .description('Fetch and update Fruugo SKU IDs')
    .option('--page-from <page>', 'Starting page number', '1')
    .option('--page-to <page>', 'Ending page number (defaults to all pages)')
    .option('--dry-run', 'Fetch SKUs without updating database')
    .action(async (options) => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        const pageFrom = parseInt(options.pageFrom, 10);
        const pageTo = options.pageTo ? parseInt(options.pageTo, 10) : undefined;

        console.log(`Syncing SKU IDs${options.dryRun ? ' (dry run)' : ''}...`);
        if (pageTo) {
          console.log(`  Pages: ${pageFrom} to ${pageTo}`);
        } else {
          console.log(`  Pages: ${pageFrom} to all`);
        }

        const result = await adapter.fetchSkuMappings({
          pageFrom,
          pageTo,
          dryRun: options.dryRun,
        });

        if (result.success) {
          console.log('\n✓ SKU sync completed');
          console.log(`  Pages fetched: ${result.pagesFetched}`);
          console.log(`  Total mappings: ${result.totalMappings}`);
          console.log(`  Records updated: ${result.recordsUpdated}`);
          console.log(`  Records failed: ${result.recordsFailed}`);
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ SKU sync failed');
          console.error(`  Pages fetched: ${result.pagesFetched}`);
          console.error(`  Total mappings: ${result.totalMappings}`);
          console.error(`  Records updated: ${result.recordsUpdated}`);
          console.error(`  Records failed: ${result.recordsFailed}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Sync SKUs command failed');
        process.exit(1);
      }
    });

  // Validate Credentials Command
  fruugo
    .command('validate')
    .description('Validate Fruugo API credentials')
    .action(async () => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        console.log('Validating credentials...');
        const result = await adapter.validateCredentials();

        if (result.valid) {
          console.log('\n✓ Credentials are valid');
          console.log(`  API ID: ${config.apiId}`);
          console.log(`  Store ID: ${config.storeId}`);
        } else {
          console.error('\n✗ Credentials are invalid');
          console.error(`  Error: ${result.error || result.message}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Validate command failed');
        process.exit(1);
      }
    });

  // Status Command
  fruugo
    .command('status')
    .description('Show Fruugo integration status')
    .action(async () => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('\nFruugo Integration Status');
        console.log('=========================');
        console.log(`API ID: ${config.apiId}`);
        console.log(`Store ID: ${config.storeId}`);
        console.log(`Feed Directory: ${config.feedDirectory}`);
        console.log(`Inventory Batch Size: ${config.inventoryBatchSize}`);
        console.log(`SKU Sync Batch Size: ${config.skuSyncBatchSize}`);
        console.log(`Parallel Pages: ${config.parallelPages}`);
        console.log(`Excluded Manufacturers: ${config.excludedManufacturerIds.join(', ') || 'None'}`);
        console.log(`Excluded Product Types: ${config.excludedProductTypeIds.join(', ') || 'None'}`);
        console.log(`Kids Size Guides: ${config.kidsSizeGuides.join(', ') || 'None'}`);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      }
    });

  // Populate Listings Command
  fruugo
    .command('populate-listings')
    .description('Populate marketplace listings table from UKSS source data')
    .option('--dry-run', 'Show what would be inserted without making changes')
    .option('--limit <count>', 'Limit number of records to process', '0')
    .action(async (options) => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        const limit = parseInt(options.limit, 10);
        console.log(`\nPopulating listings${options.dryRun ? ' (dry run)' : ''}...`);

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

  // Refresh Listings Command
  fruugo
    .command('refresh-listings')
    .description('Refresh ukss_quantity and ukss_price from UKSS source data')
    .action(async () => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        console.log('\nRefreshing listings...');
        const result = await adapter.refreshListings();

        console.log(`\n✓ Refresh completed`);
        console.log(`  Updated: ${result.updated}`);

      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Refresh listings command failed');
        process.exit(1);
      }
    });

  // Sync Listings Command (full sync: add new, deactivate removed, refresh existing)
  fruugo
    .command('sync-listings')
    .description('Full sync: add new products, deactivate removed, refresh existing')
    .action(async () => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        console.log('\nStarting full listing sync...');
        const result = await adapter.syncListings();

        console.log(`\n✓ Full sync completed`);
        console.log(`  New products added: ${result.added.inserted}`);
        console.log(`  Products deactivated: ${result.deactivated.deactivated}`);
        console.log(`  Listings refreshed: ${result.refreshed.updated}`);

      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Sync listings command failed');
        process.exit(1);
      }
    });

  // Listing Counts Command
  fruugo
    .command('listing-counts')
    .description('Show listing counts for Fruugo')
    .action(async () => {
      try {
        console.log('Loading Fruugo configuration...');
        const config = loadFruugoConfig();

        console.log('Creating Fruugo adapter...');
        const adapter = createFruugoAdapter(config);

        const counts = await adapter.getListingCounts();

        console.log('\nFruugo Listing Counts');
        console.log('=====================');
        console.log(`Total: ${counts.total}`);
        console.log(`Active: ${counts.active}`);
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
}
