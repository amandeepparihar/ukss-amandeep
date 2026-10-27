/**
 * SportDeal Marketplace Adapter
 * 
 * Handles SportDeal-specific sync logic using XML feed generation
 * 
 * @taskId #164914
 */

import { MarketplaceAdapter, MarketplaceSyncResult } from '../common/base-adapter';
import { SportdealClient } from './client';
import type { ListingNeedingSync, MarketplaceConfig } from '../common/types';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { getLogger } from '../../logger-context';

/**
 * SportDeal marketplace adapter
 * 
 * Implements feed-based inventory sync for SportDeal marketplace.
 * Generates XML feed files that SportDeal pulls via FTP.
 * 
 * @taskId #164914
 */
export class SportdealAdapter extends MarketplaceAdapter {
  private client: SportdealClient;

  constructor(config: MarketplaceConfig) {
    super(config);
    this.client = new SportdealClient();
  }

  getMarketplaceName(): string {
    return 'SportDeal';
  }

  /**
   * Sync listings to SportDeal marketplace
   * 
   * @taskId #164914
   * 
   * Process:
   * 1. Generate XML inventory feed from listings
   * 2. Save feed to configured directory
   * 3. Archive old feed with timestamp
   * 4. Update database with synced quantities
   * 
   * Business logic:
   * - Delta feed: Only includes items with changed quantities/prices
   * - No limits: Processes all provided listings (config handles limits upstream)
   * - No quantity cap: Config MARKETPLACE_SPORTDEAL_MAX_QUANTITY_CAP=0 disables capping
   * - Feed format: XML with <item> elements containing id, price, gtin, qty
   * 
   * @param listings - Listings needing sync (already filtered by getListingsNeedingSync)
   * @returns Sync result with success/failure counts
   */
  async syncListings(listings: ListingNeedingSync[]): Promise<MarketplaceSyncResult> {
    const { storeId } = this.config;
    const logger = getLogger();

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    logger.info(
      { storeId, listingCount: listings.length },
      'Starting SportDeal inventory feed sync'
    );

    // Edge case: No listings to sync
    if (listings.length === 0) {
      logger.info({ storeId }, 'No listings to sync for SportDeal');
      return {
        successCount: 0,
        failureCount: 0,
        errors: [],
      };
    }

    try {
      // Generate XML feed
      const feedResult = await this.client.generateInventoryFeed(listings, {
        archive: true, // Archive existing feed before generating new one
      });

      if (!feedResult.success) {
        // Feed generation failed
        const errorMessage = feedResult.error || 'Unknown feed generation error';
        logger.error(
          { storeId, error: errorMessage },
          'SportDeal feed generation failed'
        );

        // Mark all listings as failed
        const failureUpdates = listings.map(listing => ({
          listingId: listing.marketplace_listings_id,
          errorCode: 'FEED_GENERATION_FAILED',
          errorMessage,
        }));

        await db.markSyncFailureBatch(failureUpdates);
        failureCount = listings.length;
        errors.push(errorMessage);

        return {
          successCount: 0,
          failureCount,
          errors,
        };
      }

      // Feed generated successfully
      logger.info(
        { 
          storeId, 
          filePath: feedResult.filePath, 
          itemCount: feedResult.itemCount,
          duration: feedResult.duration
        },
        'SportDeal feed generated successfully'
      );

      // Update database: mark all listings as successfully synced
      // SportDeal sync is fire-and-forget (feed-based), so we consider it successful once feed is written
      const successUpdates = listings.map(listing => ({
        listingId: listing.marketplace_listings_id,
        quantity: Number(listing.normalized_quantity),
        price: Number(listing.current_price),
        currency: 'GBP',
        isSpecialPrice: listing.specials_status === 'Special' && (listing.specials_price || 0) > 0,
      }));

      const updated = await db.markSyncSuccessBatch(successUpdates);
      successCount = updated;

      logger.info(
        { storeId, successCount, totalListings: listings.length },
        'SportDeal listings marked as synced in database'
      );

      // Check if all listings were updated
      if (successCount < listings.length) {
        const notUpdated = listings.length - successCount;
        logger.warn(
          { storeId, successCount, failureCount: notUpdated, totalListings: listings.length },
          'Some listings were not marked as synced in database'
        );
        failureCount = notUpdated;
        errors.push(`Failed to update ${notUpdated} listing(s) in database`);
      }

    } catch (error) {
      // Unexpected exception during sync
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        { storeId, error: errorMessage, stack: error instanceof Error ? error.stack : undefined },
        'SportDeal sync failed with exception'
      );

      // Mark all listings as failed
      const failureUpdates = listings.map(listing => ({
        listingId: listing.marketplace_listings_id,
        errorCode: 'SYNC_EXCEPTION',
        errorMessage,
      }));

      await db.markSyncFailureBatch(failureUpdates);
      failureCount = listings.length;
      errors.push(`Sync exception: ${errorMessage}`);
    }

    return {
      successCount,
      failureCount,
      errors,
    };
  }
}
