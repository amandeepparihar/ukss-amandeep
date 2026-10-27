/**
 * Marketplace Sync Service
 * 
 * Main orchestration for syncing inventory and prices to marketplaces
 * Supports: eBay, Debenhams (Mirakl), OnBuy, Amazon
 */

import { 
  config, 
  getMarketplaceMaxProducts,
  getMarketplaceBatchSize,
  getMarketplaceBatchDelay,
  getMarketplaceMaxRetries,
  getMarketplaceQuantityCap,
  getMarketplaceBestsellersOnly
} from '../../config';
import { getLogger } from '../../lib/logger-context';
import { emailService } from '../../lib/email';
import { getStoreInfo } from '../../lib/store-management/store-management-utils';
import * as db from './marketplace-sync.db';
import { 
  getMarketplaceForStore,
  createMarketplaceAdapter, 
  isMarketplaceImplemented,
  type SyncResult,
  type MarketplaceConfig
} from '../../lib/marketplaces';

/**
 * Main sync function - orchestrates entire sync process
 * 
 * Steps:
 * 1. Initialization & Configuration
 * 2. Store Validation
 * 3. Marketplace Resolution
 * 4. Fetch Listings
 * 5. Execute Sync via Marketplace Adapter
 * 6. Summary & Error Reporting
 */
export async function syncStoreInventory(storeId: number): Promise<SyncResult> {
  // ===== STEP 1: INITIALIZATION =====
  const logger = getLogger();
  logger.info({ storeId }, 'Starting marketplace sync');

  // ===== STEP 2: STORE VALIDATION =====
  const storeInfo = await getStoreInfo(storeId, logger);
  
  if (!storeInfo) {
    const message = `Store ID ${storeId} not found`;
    logger.error({ storeId }, message);
    return createErrorResult(storeId, 'Unknown', 'unknown', message);
  }

  if (storeInfo.status !== '1') {
    const message = `Store ${storeInfo.store_name} is not active (status: ${storeInfo.status})`;
    logger.error({ storeId, status: storeInfo.status }, message);
    return createErrorResult(storeId, storeInfo.store_name, 'unknown', message);
  }

  logger.info(
    { storeId, storeName: storeInfo.store_name },
    'Marketplace sync started for store'
  );

  // ===== STEP 3: MARKETPLACE RESOLUTION =====
  let marketplace: string;
  try {
    marketplace = getMarketplaceForStore(storeId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ storeId, error }, 'Failed to resolve marketplace for store');
    return createErrorResult(storeId, storeInfo.store_name, 'unknown', errorMessage);
  }

  // Get marketplace-specific configurations
  const maxProducts = getMarketplaceMaxProducts(marketplace);
  const batchSize = getMarketplaceBatchSize(marketplace);
  const batchDelay = getMarketplaceBatchDelay(marketplace);
  const maxRetries = getMarketplaceMaxRetries(marketplace);
  const maxQuantityCap = getMarketplaceQuantityCap(marketplace);
  const bestsellersOnly = getMarketplaceBestsellersOnly(marketplace);

  logger.info({ 
    storeId, 
    marketplace, 
    storeName: storeInfo.store_name, 
    maxProducts,
    batchSize,
    batchDelay,
    maxRetries,
    maxQuantityCap,
    bestsellersOnly
  }, 'Marketplace resolved with configuration');

  // Check if marketplace is implemented
  if (!isMarketplaceImplemented(marketplace)) {
    const message = `Marketplace '${marketplace}' is not yet implemented`;
    logger.warn({ storeId, marketplace }, message);
    return createErrorResult(storeId, storeInfo.store_name, marketplace, message);
  }

  // ===== STEP 4: FETCH LISTINGS =====
  const listings = await db.getListingsNeedingSync(storeId, maxProducts, maxQuantityCap, maxRetries, bestsellersOnly);

  if (!listings || !Array.isArray(listings) || listings.length === 0) {
    const message = 'No listings need syncing';
    logger.info({ storeId }, message);
    
    return {
      success: true,
      storeName: storeInfo.store_name,
      storeId,
      marketplace,
      total: 0,
      successCount: 0,
      failureCount: 0,
      message,
    };
  }

  logger.info({ storeId, marketplace, count: listings.length }, 'Found listings needing sync');

  // ===== STEP 5: EXECUTE SYNC =====
  const marketplaceConfig: MarketplaceConfig = {
    storeId,
    storeName: storeInfo.store_name,
    marketplace,
    maxProducts,
    batchSize,
    batchDelay,
    maxQuantityCap,
  };

  let successCount = 0;
  let failureCount = 0;
  let criticalErrors: string[] = [];

  try {
    // Create marketplace-specific adapter
    const adapter = createMarketplaceAdapter(marketplace, marketplaceConfig);
    
    logger.info(
      { storeId, marketplace, listingCount: listings.length },
      `Syncing to ${adapter.getMarketplaceName()}`
    );

    // Execute sync via adapter
    const result = await adapter.syncListings(listings);
    
    successCount = result.successCount;
    failureCount = result.failureCount;
    criticalErrors = result.errors;

    logger.info(
      { storeId, marketplace, successCount, failureCount, errorCount: criticalErrors.length },
      'Marketplace sync completed'
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ storeId, marketplace, error }, 'Marketplace sync failed');
    
    // Mark all listings as failed
    for (const listing of listings) {
      await db.markSyncFailure(
        listing.marketplace_listings_id,
        'ADAPTER_EXCEPTION',
        errorMessage
      );
    }

    failureCount = listings.length;
    criticalErrors.push(`Adapter exception: ${errorMessage}`);
  }

  // ===== STEP 6: ERROR ALERTING =====
  if (criticalErrors.length > 0 && config.MARKETPLACE_SYNC_EMAIL_ALERTS) {
    try {
      await emailService.sendErrorNotification({
        subject: `Marketplace Sync Error - ${storeInfo.store_name} (${marketplace})`,
        errorMessage: `Marketplace sync encountered ${criticalErrors.length} error(s) for store ${storeInfo.store_name}.`,
        module: 'marketplace-sync',
        context: {
          storeName: storeInfo.store_name,
          storeId,
          marketplace,
          successCount,
          failureCount,
          totalItems: listings.length,
          errors: criticalErrors,
        },
        priority: 2, // High priority
      });
      logger.info({ storeId, marketplace }, 'Error notification email queued');
    } catch (error) {
      logger.error({ storeId, marketplace, error }, 'Failed to queue error notification email');
    }
  }

  // ===== STEP 7: RETURN SUMMARY =====
  const message = `Marketplace Sync Completed\nStore: ${storeInfo.store_name} (ID: ${storeId})\nMarketplace: ${marketplace}\nTotal: ${listings.length} | Success: ${successCount} | Failed: ${failureCount}`;

  return {
    success: failureCount === 0,
    storeName: storeInfo.store_name,
    storeId,
    marketplace,
    total: listings.length,
    successCount,
    failureCount,
    message,
  };
}

/**
 * Helper function to create error result
 */
function createErrorResult(
  storeId: number,
  storeName: string,
  marketplace: string,
  message: string
): SyncResult {
  return {
    success: false,
    storeName,
    storeId,
    marketplace,
    total: 0,
    successCount: 0,
    failureCount: 0,
    message,
  };
}
