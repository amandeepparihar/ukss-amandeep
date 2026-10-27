/**
 * Allegro CLI Commands
 *
 * Command-line interface for Allegro marketplace operations.
 *
 * Usage:
 *   pnpm cli allegro seed-token --refresh-token <token>
 *   pnpm cli allegro refresh-token
 *   pnpm cli allegro token-status
 *   pnpm cli allegro populate-listings [--limit] [--dry-run]
 *   pnpm cli allegro sync-inventory [--dry-run]
 *   pnpm cli allegro status
 *   pnpm cli allegro test-conversion
 *
 * @taskId #164358
 */

import { Command } from 'commander';
import { createLogger } from '../../../lib/logger';
import { config } from '../../../config';

const logger = createLogger('allegro-cli');

/**
 * Register Allegro CLI commands.
 */
export function registerAllegroCommands(program: Command): void {
  const allegro = program
    .command('allegro')
    .description('Allegro marketplace commands');

  // Seed Token Command (one-time setup)
  allegro
    .command('seed-token')
    .description('Store initial OAuth refresh token for Allegro (one-time setup)')
    .requiredOption('--refresh-token <token>', 'The refresh token from Allegro OAuth authorization')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        const { seedInitialToken } = await import('../../../lib/marketplaces/allegro/auth');
        console.log(`Seeding refresh token for Allegro store ${storeId}...`);
        await seedInitialToken(storeId, options.refreshToken);
        console.log('Done. Refresh token stored successfully.');
        console.log('Run "pnpm cli allegro refresh-token" to exchange it for an access token.');
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Seed token command failed');
        process.exit(1);
      }
    });

  // Refresh Token Command
  allegro
    .command('refresh-token')
    .description('Manually trigger an OAuth token refresh')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        const { refreshAccessToken } = await import('../../../lib/marketplaces/allegro/auth');
        console.log(`Refreshing Allegro access token for store ${storeId}...`);
        const tokens = await refreshAccessToken(storeId);
        console.log('Token refreshed successfully.');
        console.log(`  Access token expires: ${tokens.accessTokenExpiry.toISOString()}`);
        console.log(`  Refresh token expires: ${tokens.refreshTokenExpiry?.toISOString() || 'N/A'}`);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Refresh token command failed');
        process.exit(1);
      }
    });

  // Token Status Command
  allegro
    .command('token-status')
    .description('Show current OAuth token status')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        const { getTokenStatus } = await import('../../../lib/marketplaces/allegro/auth');
        const status = await getTokenStatus(storeId);

        console.log(`\nAllegro Token Status (Store ${storeId}):`);
        console.log('─'.repeat(50));
        console.log(`  Access Token:  ${status.hasAccessToken ? 'Present' : 'Missing'}`);
        console.log(`  Access Valid:  ${status.accessTokenValid ? 'Yes' : 'No'}`);
        if (status.accessTokenExpiry) {
          console.log(`  Access Expiry: ${status.accessTokenExpiry.toISOString()}`);
        }
        console.log(`  Refresh Token: ${status.hasRefreshToken ? 'Present' : 'Missing'}`);
        console.log(`  Refresh Valid: ${status.refreshTokenValid ? 'Yes' : 'No'}`);
        if (status.refreshTokenExpiry) {
          console.log(`  Refresh Expiry: ${status.refreshTokenExpiry.toISOString()}`);
        }
        console.log('');
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // Populate Listings Command
  allegro
    .command('populate-listings')
    .description('Fetch offers from Allegro API and create marketplace_listings rows')
    .option('--limit <count>', 'Limit number of offers to fetch', '0')
    .option('--dry-run', 'Show what would be created without writing to DB')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        const limit = parseInt(options.limit, 10);
        const { getAccessToken } = await import('../../../lib/marketplaces/allegro/auth');
        const { createAllegroClient } = await import('../../../lib/marketplaces/allegro/client');
        const { prisma } = await import('../../../lib/prisma');

        console.log(`Fetching offers from Allegro for store ${storeId}...`);
        const accessToken = await getAccessToken(storeId);
        const client = createAllegroClient(config.ALLEGRO_API_BASE_URL);

        let offset = 0;
        const pageSize = 1000;
        let totalFetched = 0;
        let matched = 0;
        let created = 0;
        let skipped = 0;

        while (true) {
          const fetchLimit = limit > 0 ? Math.min(pageSize, limit - totalFetched) : pageSize;
          if (fetchLimit <= 0) break;

          const result = await client.getOffers(accessToken, fetchLimit, offset);
          if (result.offers.length === 0) break;

          totalFetched += result.offers.length;
          console.log(`  Fetched ${totalFetched} / ${result.totalCount} offers...`);

          for (const offer of result.offers) {
            // Try to match offer to UKSS SKU via external ID
            const externalId = offer.external?.id;
            if (!externalId) {
              skipped++;
              continue;
            }

            // Look up SKU in new_products_variations
            const npv = await (prisma as any).$queryRawUnsafe(
              `SELECT npv_products_sku, npv_products_id FROM new_products_variations WHERE npv_products_sku = ? LIMIT 1`,
              externalId
            ) as Array<{ npv_products_sku: string; npv_products_id: number }>;

            if (!npv || npv.length === 0) {
              skipped++;
              continue;
            }

            matched++;

            if (options.dryRun) {
              console.log(`  [DRY RUN] Would create: SKU=${externalId}, OfferID=${offer.id}`);
              continue;
            }

            // Upsert into marketplace_listings
            await (prisma as any).$executeRawUnsafe(
              `INSERT INTO marketplace_listings (store_id, products_sku, products_id, marketplace_item_identifier, marketplace_listing_status, last_synced_price_currency)
               VALUES (?, ?, ?, ?, 'active', 'PLN')
               ON DUPLICATE KEY UPDATE marketplace_item_identifier = VALUES(marketplace_item_identifier)`,
              storeId,
              npv[0].npv_products_sku,
              npv[0].npv_products_id,
              offer.id
            );
            created++;
          }

          offset += result.offers.length;
          if (totalFetched >= result.totalCount) break;
          if (limit > 0 && totalFetched >= limit) break;
        }

        console.log(`\nPopulate Listings Complete${options.dryRun ? ' (DRY RUN)' : ''}:`);
        console.log(`  Total offers fetched: ${totalFetched}`);
        console.log(`  Matched to UKSS SKU: ${matched}`);
        console.log(`  Created/updated:     ${created}`);
        console.log(`  Skipped (no match):  ${skipped}`);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Populate listings command failed');
        process.exit(1);
      }
    });

  // Sync Inventory Command (uses syncStoreInventory — same pattern as Debenhams/eBay)
  allegro
    .command('sync-inventory')
    .description('Sync price and stock to Allegro offers (uses env var config)')
    .option('--dry-run', 'Show what would be synced without calling API')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        if (options.dryRun) {
          // Dry run: just fetch and display what would sync
          const { getListingsNeedingSync } = await import('../../marketplace-sync/marketplace-sync.db');
          const { getExchangeRate, convertFromGbp, applyMarginPercent } = await import('../../../lib/marketplaces/common/currency-utils');

          const listings = await getListingsNeedingSync(storeId, 999999, 0, 3, false);
          const { rate } = await getExchangeRate('PLN');
          const marginPercent = config.ALLEGRO_MARGIN_PERCENT;

          console.log(`\n[DRY RUN] Allegro Sync Preview (Store ${storeId}):`);
          console.log(`  Exchange rate: 1 GBP = ${rate} PLN`);
          console.log(`  Margin: ${marginPercent}%`);
          console.log(`  Listings to sync: ${listings.length}`);
          console.log('─'.repeat(90));
          console.log(
            `${'SKU'.padEnd(20)} ${'Offer ID'.padEnd(15)} ${'GBP'.padEnd(10)} ${'PLN'.padEnd(10)} ${'Stock'.padEnd(8)} Status`
          );
          console.log('─'.repeat(90));

          for (const l of listings.slice(0, 50)) {
            let plnPrice = convertFromGbp(l.current_price, rate);
            plnPrice = applyMarginPercent(plnPrice, marginPercent);
            plnPrice = Math.round(plnPrice * 100) / 100;
            console.log(
              `${(l.products_sku || '').padEnd(20)} ${(l.marketplace_item_identifier || '').padEnd(15)} £${l.current_price.toFixed(2).padEnd(8)} ${plnPrice.toFixed(2).padEnd(7)}PLN ${String(l.normalized_quantity).padEnd(8)} ${l.marketplace_listing_status}`
            );
          }

          if (listings.length > 50) {
            console.log(`  ... and ${listings.length - 50} more`);
          }
          return;
        }

        // Real sync via shared marketplace sync service (same as HTTP route / Debenhams pattern)
        const { syncStoreInventory } = await import('../../marketplace-sync/marketplace-sync.service');
        console.log(`Starting Allegro sync for store ${storeId}...`);
        console.log(`  Config from env: MARKETPLACE_ALLEGRO_* (batch size, delay, retries, etc.)`);

        const result = await syncStoreInventory(storeId);

        console.log(`\nAllegro Sync Complete:`);
        console.log(`  ${result.message}`);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        logger.error({ error: err.message, stack: err.stack }, 'Sync inventory command failed');
        process.exit(1);
      }
    });

  // Status Command
  allegro
    .command('status')
    .description('Show Allegro integration status')
    .option('--store-id <id>', 'Allegro store ID', String(config.ALLEGRO_STORE_ID || ''))
    .action(async (options) => {
      try {
        const storeId = parseInt(options.storeId, 10);
        if (!storeId || isNaN(storeId)) {
          console.error('Error: Valid --store-id or ALLEGRO_STORE_ID env var required');
          process.exit(1);
        }

        const { prisma } = await import('../../../lib/prisma');
        const { getTokenStatus } = await import('../../../lib/marketplaces/allegro/auth');

        // Get listing counts
        const counts = await (prisma as any).$queryRawUnsafe(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN marketplace_listing_status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN marketplace_listing_status = 'inactive' THEN 1 ELSE 0 END) as inactive,
            SUM(CASE WHEN last_sync_status = 'success' THEN 1 ELSE 0 END) as synced,
            SUM(CASE WHEN last_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN last_synced_at IS NULL THEN 1 ELSE 0 END) as never_synced,
            MIN(last_synced_at) as oldest_sync,
            MAX(last_synced_at) as latest_sync
          FROM marketplace_listings
          WHERE store_id = ?
        `, storeId) as Array<Record<string, unknown>>;

        const c = counts[0] || {};

        // Get token status
        let tokenInfo: Awaited<ReturnType<typeof getTokenStatus>> | null = null;
        try {
          tokenInfo = await getTokenStatus(storeId);
        } catch {
          // Store might not exist
        }

        console.log(`\nAllegro Integration Status (Store ${storeId}):`);
        console.log('═'.repeat(50));

        if (tokenInfo) {
          console.log('\n  OAuth Tokens:');
          console.log(`    Access Token:  ${tokenInfo.accessTokenValid ? 'Valid' : tokenInfo.hasAccessToken ? 'Expired' : 'Missing'}`);
          console.log(`    Refresh Token: ${tokenInfo.refreshTokenValid ? 'Valid' : tokenInfo.hasRefreshToken ? 'Expired' : 'Missing'}`);
        }

        console.log('\n  Listings:');
        console.log(`    Total:        ${c.total || 0}`);
        console.log(`    Active:       ${c.active || 0}`);
        console.log(`    Inactive:     ${c.inactive || 0}`);
        console.log(`    Synced:       ${c.synced || 0}`);
        console.log(`    Failed:       ${c.failed || 0}`);
        console.log(`    Never synced: ${c.never_synced || 0}`);

        if (c.oldest_sync) {
          console.log(`\n  Sync History:`);
          console.log(`    Oldest sync: ${c.oldest_sync}`);
          console.log(`    Latest sync: ${c.latest_sync}`);
        }

        console.log('');
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // Test Conversion Command
  allegro
    .command('test-conversion')
    .description('Show current exchange rate and sample GBP-to-PLN conversion')
    .option('--price <gbp>', 'GBP price to convert (default: 29.99)', '29.99')
    .action(async (options) => {
      try {
        const { getExchangeRate, convertFromGbp, applyMarginPercent } = await import(
          '../../../lib/marketplaces/common/currency-utils'
        );

        const gbpPrice = parseFloat(options.price);
        const marginPercent = config.ALLEGRO_MARGIN_PERCENT;

        const { rate } = await getExchangeRate('PLN');
        const rawPln = convertFromGbp(gbpPrice, rate);
        const withMargin = applyMarginPercent(rawPln, marginPercent);
        const finalPrice = Math.round(withMargin * 100) / 100;

        console.log(`\nCurrency Conversion Test:`);
        console.log('─'.repeat(40));
        console.log(`  Source:          £${gbpPrice.toFixed(2)} GBP`);
        console.log(`  Rate (from DB):  1 GBP = ${rate.toFixed(4)} PLN`);
        console.log(`  Converted:       ${rawPln.toFixed(2)} PLN`);
        if (marginPercent > 0) {
          console.log(`  + Margin (${marginPercent}%): ${withMargin.toFixed(2)} PLN`);
        }
        console.log(`  Final price:     ${finalPrice.toFixed(2)} PLN`);
        console.log('');
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
