/**
 * Sportdeal CLI Commands
 *
 * Command-line interface for Sportdeal marketplace operations.
 *
 * Usage:
 *   npx tsx apps/api/src/cli.ts sportdeal generate-feed [--dry-run]
 *   npx tsx apps/api/src/cli.ts sportdeal generate-inventory [--full] [--dry-run]
 *   npx tsx apps/api/src/cli.ts sportdeal status
 */

import { Command } from 'commander';
import { createSportdealAdapter, loadSportdealConfig } from '../adapters/sportdeal';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('sportdeal-cli');

/**
 * Register Sportdeal CLI commands.
 */
export function registerSportdealCommands(program: Command): void {
  const sportdeal = program
    .command('sportdeal')
    .description('Sportdeal marketplace commands');

  // Generate Product Feed Command
  sportdeal
    .command('generate-feed')
    .description('Generate product feed XML file for Sportdeal')
    .option('--dry-run', 'Show what would be generated without writing file')
    .option('--skip-archive', 'Skip archiving the old feed file')
    .option('--limit <count>', 'Limit number of products to include', '0')
    .option('--chunk-size <size>', 'Chunk size for streaming (default: FEED_CHUNK_SIZE env)', '0')
    .action(async (options) => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

        const limit = parseInt(options.limit, 10);
        const chunkSize = parseInt(options.chunkSize, 10);
        console.log(`Generating product feed${options.dryRun ? ' (dry run)' : ''}${limit > 0 ? ` (limit: ${limit})` : ''}${chunkSize > 0 ? ` (chunk: ${chunkSize})` : ''}...`);
        const result = await adapter.generateProductFeed({
          dryRun: options.dryRun,
          skipArchive: options.skipArchive,
          limit: limit > 0 ? limit : undefined,
          chunkSize: chunkSize > 0 ? chunkSize : undefined,
        });

        if (result.success) {
          console.log('\n✓ Product feed generation completed');
          console.log(`  Items: ${result.itemCount}`);
          if (result.filePath) {
            console.log(`  File: ${result.filePath}`);
          }
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Product feed generation failed');
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

  // Generate Inventory Feed Command
  sportdeal
    .command('generate-inventory')
    .description('Generate inventory feed XML file for Sportdeal')
    .option('--full', 'Generate full inventory feed instead of delta')
    .option('--dry-run', 'Show what would be generated without writing file')
    .option('--skip-archive', 'Skip archiving the old feed file')
    .option('--chunk-size <size>', 'Chunk size for streaming full feeds (default: FEED_CHUNK_SIZE env)', '0')
    .action(async (options) => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

        const feedType = options.full ? 'full' : 'delta';
        const chunkSize = parseInt(options.chunkSize, 10);
        console.log(`Generating ${feedType} inventory feed${options.dryRun ? ' (dry run)' : ''}${chunkSize > 0 ? ` (chunk: ${chunkSize})` : ''}...`);

        const result = await adapter.generateInventoryFeed({
          full: options.full,
          dryRun: options.dryRun,
          skipArchive: options.skipArchive,
          chunkSize: chunkSize > 0 ? chunkSize : undefined,
        });

        if (result.success) {
          console.log('\n✓ Inventory feed generation completed');
          console.log(`  Items: ${result.itemCount}`);
          console.log(`  Changed items: ${result.changedItems}`);
          if (result.filePath) {
            console.log(`  File: ${result.filePath}`);
          }
          console.log(`  Duration: ${result.duration}ms`);
        } else {
          console.error('\n✗ Inventory feed generation failed');
          console.error(`  Error: ${result.error}`);
          process.exit(1);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Generate inventory command failed');
        process.exit(1);
      }
    });

  // Validate Configuration Command
  sportdeal
    .command('validate')
    .description('Validate Sportdeal configuration')
    .action(async () => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

        console.log('Validating configuration...');
        const result = await adapter.validateCredentials();

        if (result.valid) {
          console.log('\n✓ Configuration is valid');
          console.log(`  Store ID: ${config.storeId}`);
          console.log(`  Feed Directory: ${config.feedDirectory}`);
          console.log(`  CDN URL: ${config.cdnUrl}`);
        } else {
          console.error('\n✗ Configuration is invalid');
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
  sportdeal
    .command('status')
    .description('Show Sportdeal integration status')
    .action(async () => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('\nSportdeal Integration Status');
        console.log('============================');
        console.log(`Store ID: ${config.storeId}`);
        console.log(`PTS Status: ${config.ptsStatus}`);
        console.log(`Feed Directory: ${config.feedDirectory}`);
        console.log(`Inventory Feed Directory: ${config.inventoryFeedDirectory}`);
        console.log(`CDN URL: ${config.cdnUrl}`);
        console.log(`Product Feed File: ${config.productFeedFileName}`);
        console.log(`Inventory Feed File: ${config.inventoryFeedFileName}`);
        console.log(`Excluded Manufacturers: ${config.excludedManufacturerIds.join(', ') || 'None'}`);
        if (config.iossNumber) {
          console.log(`IOSS Number: ${config.iossNumber}`);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      }
    });

  // Populate Listings Command
  sportdeal
    .command('populate-listings')
    .description('Populate marketplace listings table from UKSS source data')
    .option('--dry-run', 'Show what would be inserted without making changes')
    .option('--limit <count>', 'Limit number of records to process', '0')
    .action(async (options) => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

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
  sportdeal
    .command('refresh-listings')
    .description('Refresh ukss_quantity and ukss_price from UKSS source data')
    .action(async () => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

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
  sportdeal
    .command('sync-listings')
    .description('Full sync: add new products, deactivate removed, refresh existing')
    .action(async () => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

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
  sportdeal
    .command('listing-counts')
    .description('Show listing counts for Sportdeal')
    .action(async () => {
      try {
        console.log('Loading Sportdeal configuration...');
        const config = loadSportdealConfig();

        console.log('Creating Sportdeal adapter...');
        const adapter = createSportdealAdapter(config);

        const counts = await adapter.getListingCounts();

        console.log('\nSportdeal Listing Counts');
        console.log('========================');
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
