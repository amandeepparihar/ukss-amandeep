/**
 * Allegro Marketplace Adapter
 *
 * Handles Allegro-specific sync logic:
 * - GBP-to-PLN currency conversion using currencies table
 * - Configurable margin %
 * - OAuth2 token auto-refresh
 * - Single PATCH /sale/product-offers/{offerId} per offer
 *
 * @taskId #164358
 */

import { nanoid } from 'nanoid';
import { MarketplaceAdapter, MarketplaceSyncResult } from '../common/base-adapter';
import { createAllegroClient } from './client';
import { getAccessToken, refreshAccessToken } from './auth';
import { getExchangeRate, convertFromGbp, applyMarginPercent } from '../common/currency-utils';
import { applyPriceAdjustment } from '../common/price-utils';
import type { ListingNeedingSync } from '../common/types';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { config } from '../../../config';
import { getLogger } from '../../logger-context';

const TARGET_CURRENCY = 'PLN';

export class AllegroAdapter extends MarketplaceAdapter {
  getMarketplaceName(): string {
    return 'Allegro';
  }

  /**
   * @taskId #164358
   *
   * Syncs listings to Allegro marketplace.
   *
   * Flow per listing:
   * 1. Apply price adjustment (flat +/- from marketplace_listings.price_adjustment)
   * 2. Convert GBP → PLN using currencies table rate
   * 3. Apply margin % (ALLEGRO_MARGIN_PERCENT)
   * 4. PATCH /sale/product-offers/{offerId} with price (PLN) + stock
   * 5. Store PLN price in last_synced_price with last_synced_price_currency = 'PLN'
   */
  async syncListings(listings: ListingNeedingSync[]): Promise<MarketplaceSyncResult> {
    const { storeId, batchSize, batchDelay } = this.config;
    const logger = getLogger('allegro-adapter');

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    // Step 1: Get access token (auto-refreshes if expired)
    let accessToken: string;
    try {
      accessToken = await getAccessToken(storeId);
      logger.info({ storeId }, 'Allegro access token obtained');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storeId, error }, 'Failed to get Allegro access token');
      throw new Error(`Failed to get Allegro access token: ${errorMessage}`);
    }

    // Step 2: Get exchange rate (once for entire sync run)
    let plnRate: number;
    try {
      const rateResult = await getExchangeRate(TARGET_CURRENCY);
      plnRate = rateResult.rate;
      logger.info({ storeId, rate: plnRate, currency: TARGET_CURRENCY }, 'Exchange rate fetched');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storeId, error }, 'Failed to get PLN exchange rate');
      throw new Error(`Failed to get PLN exchange rate: ${errorMessage}`);
    }

    const marginPercent = config.ALLEGRO_MARGIN_PERCENT;
    const allegroClient = createAllegroClient(config.ALLEGRO_API_BASE_URL);

    // Step 3: Process in batches
    const batches = allegroClient.createBatches(listings, batchSize);
    logger.info(
      { storeId, batchCount: batches.length, batchSize, totalListings: listings.length },
      'Processing Allegro batches'
    );

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNum = batchIndex + 1;
      const correlationId = `ALLEGRO_BATCH_${storeId}_${batchNum}_${Date.now()}_${nanoid(8)}`;

      logger.debug(
        { storeId, batchNum, totalBatches: batches.length, itemCount: batch.length },
        'Processing batch'
      );

      for (const listing of batch) {
        const offerId = listing.marketplace_item_identifier;
        const sku = listing.products_sku;
        const isInactive = listing.marketplace_listing_status === 'inactive';

        // Quantity (already normalized with capping and inactive handling)
        const quantity = Math.floor(listing.normalized_quantity);

        if (isInactive) {
          logger.info(
            { listingId: listing.marketplace_listings_id, offerId, sku, batchNum },
            'Syncing inactive item with quantity 0 to delist'
          );
        }

        // Apply price adjustment with validation
        const priceResult = applyPriceAdjustment(listing.current_price, listing.price_adjustment);

        if (!priceResult.isValid) {
          logger.warn(
            {
              listingId: listing.marketplace_listings_id,
              offerId,
              sku,
              basePrice: priceResult.basePrice,
              priceAdjustment: priceResult.priceAdjustment,
              adjustedPrice: priceResult.adjustedPrice,
              error: priceResult.error,
              batchNum,
              correlationId,
            },
            'Price adjustment resulted in invalid price, skipping'
          );
          await db.markSyncFailure(
            listing.marketplace_listings_id,
            'VALIDATION_NEGATIVE_PRICE',
            priceResult.error || 'Price adjustment resulted in non-positive price',
            correlationId
          );
          failureCount++;
          continue;
        }

        // Convert GBP → PLN with margin
        let plnPrice = convertFromGbp(priceResult.adjustedPrice, plnRate);
        plnPrice = applyMarginPercent(plnPrice, marginPercent);
        plnPrice = Math.round(plnPrice * 100) / 100; // Round to 2 decimal places

        // Call Allegro API
        const response = await allegroClient.updateOffer(offerId, accessToken, {
          price: plnPrice,
          stock: quantity,
          currency: TARGET_CURRENCY,
        });

        if (response.success) {
          // Determine if price is special
          const isSpecialPrice =
            listing.specials_status === 'Special' && (listing.specials_price || 0) > 0;

          await db.markSyncSuccess(
            listing.marketplace_listings_id,
            quantity,
            plnPrice,
            TARGET_CURRENCY,
            isSpecialPrice
          );
          successCount++;

          logger.debug(
            { listingId: listing.marketplace_listings_id, offerId, sku, plnPrice, quantity },
            'Allegro offer updated successfully'
          );
        } else {
          await db.markSyncFailure(
            listing.marketplace_listings_id,
            response.errorCode || 'UNKNOWN',
            response.error || 'Unknown error',
            correlationId
          );
          failureCount++;

          // Handle 401 — force token refresh (bypass timestamp check)
          if (response.httpCode === 401) {
            logger.warn({ storeId }, 'Allegro returned 401 — forcing token refresh');
            try {
              const tokens = await refreshAccessToken(storeId);
              accessToken = tokens.accessToken;
              logger.info({ storeId }, 'Token refreshed after 401');
            } catch {
              logger.error({ storeId }, 'Token refresh failed after 401');
              errors.push(`Authentication failed for batch ${batchNum}`);
            }
          }
        }
      }

      // Rate limit between batches
      if (batchDelay > 0 && batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay * 1000));
      }
    }

    logger.info(
      { storeId, successCount, failureCount, total: listings.length },
      'Allegro sync completed'
    );

    return { successCount, failureCount, errors };
  }
}
