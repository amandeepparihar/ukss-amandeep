/**
 * OnBuy Marketplace Adapter
 * 
 * Handles OnBuy-specific sync logic using the OnBuy API
 * 
 * @taskId #165004
 */

import { nanoid } from 'nanoid';
import { MarketplaceAdapter, MarketplaceSyncResult } from '../common/base-adapter';
import { createOnBuyClient, OnBuyItem } from './client';
import type { ListingItem, ListingNeedingSync } from '../common/types';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { getLogger } from '../../logger-context';
import { applyPriceAdjustment } from '../common/price-utils';

export class OnBuyAdapter extends MarketplaceAdapter {
  getMarketplaceName(): string {
    return 'OnBuy';
  }

  /**
   * @taskId #165004
   * 
   * Syncs listings to OnBuy marketplace with price adjustment support.
   * 
   * Applies configurable price adjustments before syncing to marketplace.
   * Sends adjusted price (base + adjustment) to marketplace API,
   * stores original base price in database for tracking.
   * 
   * Validates that adjusted prices are positive and rejects invalid adjustments.
   * 
   * @param listings - Typed array of listings from database with all required fields
   * @returns Sync result with success/failure counts and errors
   */
  async syncListings(listings: ListingNeedingSync[]): Promise<MarketplaceSyncResult> {
    const { storeId, batchSize, batchDelay } = this.config;
    const logger = getLogger(); // Get logger with executionId from context
    
    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    // Initialize OnBuy client
    const onbuyClient = createOnBuyClient('onbuy');
    
    // Fetch access token once
    let accessToken: string;
    try {
      const jobId = `ONBUY_SYNC_${nanoid(8)}_${Date.now()}`;
      logger.info({ storeId, jobId }, 'Fetching OnBuy access token');
      accessToken = await onbuyClient.fetchAccessToken(jobId);
      logger.info({ storeId }, 'OnBuy access token fetched successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storeId, error }, 'Failed to fetch OnBuy access token');
      throw new Error(`Failed to fetch OnBuy access token: ${errorMessage}`);
    }

    // Create batches (OnBuy API limit: 1000 items per request)
    const ONBUY_MAX_BATCH_SIZE = Math.min(batchSize, 1000);
    const batches = onbuyClient.createBatches(listings, ONBUY_MAX_BATCH_SIZE);
    logger.info({ storeId, batchCount: batches.length, batchSize: ONBUY_MAX_BATCH_SIZE }, 'Processing OnBuy batches');

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNum = batchIndex + 1;

      logger.debug({ storeId, batchNum, totalBatches: batches.length, itemCount: batch.length }, 'Processing batch');

      if (!batch || !Array.isArray(batch)) {
        logger.warn({ storeId, batchNum }, 'Invalid batch data, skipping');
        continue;
      }

      // Prepare items for API
      const items: OnBuyItem[] = [];
      const listingMap = new Map<string, ListingItem>();

      // Generate correlation ID for this batch
      const correlationId = `ONBUY_BATCH_${storeId}_${batchNum}_${Date.now()}_${nanoid(8)}`;

      for (const listing of batch) {
        const productSku = listing.products_sku;
        const productSkuInternal = listing.npv_products_sku;
        const isInactive = listing.marketplace_listing_status === 'inactive';

        // Validate SKU
        if (!productSku || productSku.trim() === '') {
          logger.warn(
            { listingId: listing.marketplace_listings_id, sku: productSku, correlationId },
            'Skipping listing: missing or empty SKU'
          );
          failureCount++;
          await db.markSyncFailure(
            listing.marketplace_listings_id,
            'VALIDATION_EMPTY_SKU',
            'SKU is empty or missing',
            correlationId
          );
          continue;
        }

        // Use normalized_quantity (already includes capping and handles inactive items)
        // Convert to integer as marketplaces expect whole numbers
        const quantity = Math.floor(listing.normalized_quantity);

        // Validate stock per-item BEFORE batching. OnBuy's bulk endpoint is
        // all-or-nothing on client-side validation: if one item has invalid
        // stock, the whole batch (up to 1000 items) is rejected and every item
        // in it gets marked failed. Validating here and skipping only the bad
        // item keeps the rest of the batch syncing. (Negative stock is already
        // floored to 0 in getListingsNeedingSync; this is the safety net.)
        if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999) {
          logger.warn(
            { listingId: listing.marketplace_listings_id, sku: productSku, quantity, correlationId },
            'Invalid stock value, skipping listing'
          );
          await db.markSyncFailure(
            listing.marketplace_listings_id,
            'VALIDATION_INVALID_STOCK',
            `Invalid stock value: ${quantity}`,
            correlationId
          );
          failureCount++;
          continue;
        }

        if (isInactive) {
          logger.info(
            { listingId: listing.marketplace_listings_id, sku: productSku, correlationId },
            'Syncing inactive item with quantity 0 to delist'
          );
        }

        // Apply price adjustment with validation
        const priceResult = applyPriceAdjustment(listing.current_price, listing.price_adjustment);
        
        // Validate adjusted price
        if (!priceResult.isValid) {
          logger.warn(
            { 
              listingId: listing.marketplace_listings_id, 
              sku: productSku,
              basePrice: priceResult.basePrice,
              priceAdjustment: priceResult.priceAdjustment,
              adjustedPrice: priceResult.adjustedPrice,
              error: priceResult.error,
              correlationId
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
        
        const { basePrice, priceAdjustment, adjustedPrice } = priceResult;
        
        // Log if adjustment is applied
        if (priceAdjustment !== 0) {
          logger.debug({ 
            listingId: listing.marketplace_listings_id,
            sku: productSku,
            basePrice,
            priceAdjustment,
            adjustedPrice,
            correlationId
          }, 'Applying price adjustment');
        }

        // Determine what changed
        // Coerce to Number: Prisma raw queries return DECIMAL columns as Prisma.Decimal
        // instances; strict-equality comparison between two Decimal objects is identity-based
        // and always reports a change, causing OnBuy to receive unchanged prices on every sync.
        const lastSyncedQuantity = listing.last_synced_quantity ?? -1;
        const lastSyncedPrice = listing.last_synced_price !== null && listing.last_synced_price !== undefined
          ? Number(listing.last_synced_price)
          : -1;
        const quantityChanged = lastSyncedQuantity !== quantity;
        const priceChanged = lastSyncedPrice !== Number(basePrice);

        // Build item data for API (ONLY include changed fields)
        const itemData: OnBuyItem = {
          sku: productSku,
        };

        if (quantityChanged) {
          itemData.stock = quantity;
        }

        if (priceChanged) {
          itemData.price = adjustedPrice.toString();  // Send ADJUSTED price to marketplace
        }

        // Skip if nothing changed
        if (!quantityChanged && !priceChanged) {
          logger.debug(
            { sku: productSku, quantity, price: adjustedPrice },
            'No changes detected, skipping'
          );
          continue;
        }

        items.push(itemData);

        // Store in listing map for later reference
        const isSpecialPrice = listing.specials_status === 'Special' && (listing.specials_price || 0) > 0;
        listingMap.set(productSku, {
          marketplace_listings_id: listing.marketplace_listings_id,
          products_sku: productSku,
          product_sku_internal: productSkuInternal,
          marketplace_item_identifier: productSku, // OnBuy uses SKU as identifier
          quantity,
          price: basePrice,  // Store ORIGINAL price for database
          quantity_changed: quantityChanged,
          price_changed: priceChanged,
          is_special_price: isSpecialPrice,
          regular_price: listing.products_price,
          special_price: listing.specials_price,
          price_adjustment: priceAdjustment,
        });
      }

      // Skip batch if no items to sync
      if (items.length === 0) {
        logger.info({ storeId, batchNum }, 'No items to sync in batch, skipping API call');
        continue;
      }

      // Call OnBuy API
      try {
        logger.info(
          { storeId, batchNum, itemCount: items.length },
          'Calling OnBuy updateListingsBySKU API'
        );

        const result = await onbuyClient.updateListingsBySKU(storeId, items, accessToken);

        if (result.success && result.response?.results) {
          // Collect successful updates
          const results = result.response.results;
          const successUpdates: Array<{
            listingId: number;
            quantity?: number;
            price?: number;
            currency: string;
            isSpecialPrice: boolean;
          }> = [];
          
          for (const updateResult of results) {
            const sku = updateResult.sku;
            const listingInfo = listingMap.get(sku);

            if (listingInfo) {
              successUpdates.push({
                listingId: listingInfo.marketplace_listings_id,
                quantity: listingInfo.quantity_changed ? listingInfo.quantity : undefined,
                price: listingInfo.price_changed ? listingInfo.price : undefined,
                currency: 'GBP',
                isSpecialPrice: listingInfo.is_special_price,
              });

              logger.debug(
                {
                  sku,
                  listingId: listingInfo.marketplace_listings_id,
                  quantity: listingInfo.quantity_changed ? listingInfo.quantity : undefined,
                  price: listingInfo.price_changed ? listingInfo.price : undefined,
                },
                'OnBuy listing synced successfully'
              );
            }
          }

          // Batch update all successful items
          const updated = await db.markSyncSuccessBatch(successUpdates);
          successCount += updated;

          // Collect items that weren't in the response
          const failureUpdates: Array<{
            listingId: number;
            errorCode: string;
            errorMessage: string;
            correlationId?: string;
          }> = [];

          for (const item of items) {
            const sku = item.sku;
            const wasProcessed = results.some((r: any) => r.sku === sku);
            
            if (!wasProcessed) {
              const listingInfo = listingMap.get(sku);
              if (listingInfo) {
                failureUpdates.push({
                  listingId: listingInfo.marketplace_listings_id,
                  errorCode: 'NOT_IN_RESPONSE',
                  errorMessage: 'SKU was not included in OnBuy API response',
                  correlationId,
                });
                logger.warn({ sku, correlationId }, 'SKU not found in OnBuy API response');
              }
            }
          }

          // Batch update all failures
          if (failureUpdates.length > 0) {
            await db.markSyncFailureBatch(failureUpdates);
            failureCount += failureUpdates.length;
          }
        } else {
          // API call failed - collect all failures and batch update
          const errorCode = result.errorCode || 'API_ERROR';
          const errorMessage = result.error || 'Unknown OnBuy API error';

          logger.error(
            { storeId, batchNum, errorCode, errorMessage, correlationId },
            'OnBuy API returned error'
          );

          const failureUpdates = items.map(item => {
            const listingInfo = listingMap.get(item.sku);
            if (!listingInfo) return null;

            return {
              listingId: listingInfo.marketplace_listings_id,
              errorCode,
              errorMessage,
              correlationId,
            };
          }).filter(Boolean) as Array<{
            listingId: number;
            errorCode: string;
            errorMessage: string;
            correlationId?: string;
          }>;

          // Batch update all failures
          await db.markSyncFailureBatch(failureUpdates);
          failureCount += failureUpdates.length;

          errors.push(`Batch ${batchNum}: ${errorMessage}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ storeId, batchNum, error, correlationId }, 'OnBuy API call exception');

        // Collect all failures and batch update
        const failureUpdates = items.map(item => {
          const listingInfo = listingMap.get(item.sku);
          if (!listingInfo) return null;

          return {
            listingId: listingInfo.marketplace_listings_id,
            errorCode: 'BATCH_EXCEPTION',
            errorMessage,
            correlationId,
          };
        }).filter(Boolean) as Array<{
          listingId: number;
          errorCode: string;
          errorMessage: string;
          correlationId?: string;
        }>;

        // Batch update all exceptions
        await db.markSyncFailureBatch(failureUpdates);
        failureCount += failureUpdates.length;

        errors.push(`Batch ${batchNum} exception: ${errorMessage}`);
      }

      // Delay between batches (except for last batch)
      if (batchIndex < batches.length - 1 && batchDelay > 0) {
        logger.debug({ storeId, batchNum, delay: batchDelay }, 'Waiting before next batch');
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    }

    return {
      successCount,
      failureCount,
      errors,
    };
  }
}
