/**
 * Product Feeds CLI Commands
 *
 * Command-line interface for generating and uploading XML/CSV product feeds
 * for Google Merchant Center and Microsoft Advertising.
 *
 * Usage:
 *   pnpm cli product-feeds generate [options]
 *   pnpm cli product-feeds generate --dry-run
 *   pnpm cli product-feeds generate --country UK --type all
 */

import { Command } from 'commander';
import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('product-feeds-cli');

const VALID_COUNTRIES = ['UK', 'EU', 'US', 'AU', 'CA', 'NZ', 'AE', 'SG', 'CH'] as const;
const VALID_TYPES = ['all', 'facebook', 'shoptimized', 'marketplace'] as const;

export function registerProductFeedsCommands(program: Command): void {
  const productFeeds = program
    .command('product-feeds')
    .description('Product feeds commands (Google Merchant Center + Microsoft Advertising)');

  productFeeds
    .command('generate')
    .description('Generate XML/CSV product feeds and (optionally) upload to Google and Microsoft')
    .option('--dry-run', 'Load data and process products but do not write feed files or upload')
    .option('--skip-upload', 'Generate feed files locally but skip SFTP upload')
    .option('--skip-compress', 'Skip gzip compression of generated feeds')
    .option('--skip-image-color', 'Skip image pixel color detection (faster; title + DB only)')
    .option('--country <code>', `Generate only for one country (${VALID_COUNTRIES.join(', ')})`)
    .option('--type <feedType>', `Generate only one feed type (${VALID_TYPES.join(', ')})`)
    .option('--limit <n>', 'Limit number of product rows processed (for testing)', (val) => parseInt(val, 10))
    .option('--chunk-size <n>', 'Override rows-per-chunk for streaming query', (val) => parseInt(val, 10))
    .action(async (options) => {
      try {
        if (options.country && !VALID_COUNTRIES.includes(options.country)) {
          throw new Error(`Invalid --country: ${options.country}. Must be one of: ${VALID_COUNTRIES.join(', ')}`);
        }
        if (options.type && !VALID_TYPES.includes(options.type)) {
          throw new Error(`Invalid --type: ${options.type}. Must be one of: ${VALID_TYPES.join(', ')}`);
        }

        console.log(`\nProduct Feed Generation${options.dryRun ? ' (DRY RUN)' : ''}`);
        console.log('='.repeat(50));

        const { generateAllFeeds } = await import('../feed-orchestrator.js');
        const result = await generateAllFeeds({
          dryRun: Boolean(options.dryRun),
          skipUpload: Boolean(options.skipUpload),
          skipCompress: Boolean(options.skipCompress),
          skipImageColor: Boolean(options.skipImageColor),
          country: options.country,
          type: options.type,
          limit: options.limit,
          chunkSize: options.chunkSize,
        });

        console.log('\n' + '='.repeat(50));
        console.log('Summary:');
        console.log(`  Started:            ${result.startedAt}`);
        console.log(`  Completed:          ${result.completedAt}`);
        console.log(`  Duration:           ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log(`  Products processed: ${result.productsProcessed}`);
        console.log(`  Feeds generated:    ${result.feedsGenerated.length}`);
        for (const upload of result.uploads) {
          console.log(`  Upload (${upload.target}): ${upload.filesUploaded} ok, ${upload.filesFailed} failed`);
        }
        if (result.errors.length > 0) {
          console.log(`  Errors:             ${result.errors.length}`);
          for (const err of result.errors) {
            console.log(`    - ${err}`);
          }
        }
        console.log('');

        process.exit(result.errors.length === 0 ? 0 : 1);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Product feeds generate command failed');
        process.exit(1);
      }
    });
}
