/**
 * Debenhams (Mirakl) Marketplace Adapter
 * 
 * Handles Debenhams/Mirakl-specific sync logic
 * 
 * @taskId #165004
 */

import { nanoid } from 'nanoid';
import { MarketplaceAdapter, MarketplaceSyncResult } from '../common/base-adapter';
import { createMiraklClient, MiraklOffer } from './client';
import type { ListingItem, ListingNeedingSync } from '../common/types';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { getLogger } from '../../logger-context';
import { applyPriceAdjustment } from '../common/price-utils';

export class MiraklAdapter extends MarketplaceAdapter {
  getMarketplaceName(): string {
    return 'Debenhams (Mirakl)';
  }

  /**
   * @taskId #165004
   * 
   * Syncs listings to Debenhams (Mirakl) marketplace with price adjustment support.
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
    const { storeId } = this.config;
    const logger = getLogger(); // Get logger with executionId from context
    
    let failureCount = 0;
    const errors: string[] = [];

    // Generate correlation ID for this sync operation
    const correlationId = `MIRAKL_SYNC_${storeId}_${Date.now()}_${nanoid(8)}`;

    const miraklClient = createMiraklClient('debenhams');
    
    logger.info({ storeId, listingCount: listings.length, correlationId }, 'Starting Debenhams/Mirakl sync');

    // Prepare offers for Mirakl
    const offers: MiraklOffer[] = [];
    const listingMap = new Map<string, ListingItem>();

    for (const listing of listings) {
      const ean = listing.ean;
      const isInactive = listing.marketplace_listing_status === 'inactive';
      
      if (!ean) {
        logger.warn(
          { listingId: listing.marketplace_listings_id, sku: listing.products_sku, correlationId }, 
          'Skipping listing: missing EAN'
        );
        // Mark as failed to prevent infinite retry loop
        await db.markSyncFailure(
          listing.marketplace_listings_id,
          'VALIDATION_MISSING_EAN',
          'EAN is required for Debenhams/Mirakl sync',
          correlationId
        );
        failureCount++;
        continue;
      }

      // Use normalized_quantity (already includes capping and handles inactive items)
      // Convert to integer as Mirakl expects whole numbers
      const quantity = Math.floor(listing.normalized_quantity);
      
      // Apply price adjustment with validation
      const priceResult = applyPriceAdjustment(listing.current_price, listing.price_adjustment);
      
      // Validate adjusted price
      if (!priceResult.isValid) {
        logger.warn(
          { 
            listingId: listing.marketplace_listings_id, 
            sku: listing.products_sku,
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
          sku: listing.products_sku,
          basePrice,
          priceAdjustment,
          adjustedPrice,
          correlationId
        }, 'Applying price adjustment');
      }
      
      if (isInactive) {
        logger.info(
          { listingId: listing.marketplace_listings_id, ean, sku: listing.products_sku, correlationId },
          'Syncing inactive item with quantity 0 to delist'
        );
      }

      const quantityChanged = listing.last_synced_quantity !== quantity;
      const priceChanged = listing.last_synced_price !== null && listing.last_synced_price !== undefined
        ? Math.abs(listing.last_synced_price - basePrice) >= 0.01 
        : true;

      if (!quantityChanged && !priceChanged) {
        logger.debug({ ean, sku: listing.products_sku }, 'No changes detected, skipping');
        continue;
      }

      // IMPORTANT: Mirakl requires BOTH price and quantity to ALWAYS be present
      const offer: MiraklOffer = {
        shop_sku: ean,
        price: adjustedPrice,           // Send ADJUSTED price to marketplace
        quantity: quantity,     // ALWAYS include quantity (required by Mirakl)
        state_code: '11',       // Active state
        update_delete: 'update',
      };

      offers.push(offer);

      const isSpecialPrice = listing.specials_status === 'Special' && (listing.specials_price || 0) > 0;
      listingMap.set(ean, {
        marketplace_listings_id: listing.marketplace_listings_id,
        products_sku: listing.products_sku,
        product_sku_internal: listing.npv_products_sku,
        marketplace_item_identifier: ean,
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

    if (offers.length === 0) {
      logger.info({ storeId, totalListings: listings.length, validationFailures: failureCount }, 'No offers to sync for Debenhams');
      return {
        successCount: 0,
        failureCount,
        errors,
      };
    }

    logger.info({ storeId, offerCount: offers.length }, 'Syncing offers to Debenhams');

    try {
      // Update offers on Mirakl
      const updateResult = await miraklClient.updateOffers(storeId, offers);
      
      if (!updateResult.success || !updateResult.importId) {
        logger.error({ storeId, updateResult }, 'Failed to update offers on Debenhams');
        
        // Collect all failures and batch update
        const failureUpdates = offers.map(offer => {
          const listing = listingMap.get(offer.shop_sku);
          if (!listing) return null;

          return {
            listingId: listing.marketplace_listings_id,
            errorCode: updateResult.errorCode || 'UPDATE_FAILED',
            errorMessage: updateResult.error || 'Unknown error',
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

        errors.push(`Failed to update offers: ${updateResult.error}`);
        return {
          successCount: 0,
          failureCount: failureUpdates.length + failureCount,
          errors,
        };
      }

      logger.info(
        { storeId, importId: updateResult.importId }, 
        'Offers submitted to Debenhams, waiting for completion'
      );

      // Wait for import to complete (with polling)
      const finalStatus = await miraklClient.waitForImportCompletion(
        storeId,
        updateResult.importId,
        12,   // 12 attempts
        3000 // 3 seconds between checks
      );

      if (!finalStatus) {
        logger.warn({ storeId, importId: updateResult.importId }, 'Import status check timed out');
        
        errors.push('Import status check timed out - check Debenhams/Mirakl dashboard');
        return {
          successCount: 0,
          failureCount: offers.length + failureCount,
          errors,
        };
      }

      logger.info({ storeId, finalStatus }, 'Debenhams import completed');

      // Process results
      const errorCount = finalStatus.lines_in_error;

      // Fetch error report and parse failed SKUs if there were errors
      let errorReport = '';
      const failedSkusMap = new Map<string, string>(); // SKU -> error message
      let errorReportUnavailable = false;
      
      if (errorCount > 0) {
        if (!finalStatus.has_error_report) {
          logger.warn({ storeId, importId: updateResult.importId, errorCount }, 
            'Mirakl reported errors but error report is not available');
          errorReportUnavailable = true;
        } else {
          logger.info({ storeId, importId: updateResult.importId }, 'Fetching error report');
          const errorReportResult = await miraklClient.getErrorReport(storeId, updateResult.importId);
          
          if (errorReportResult.success && errorReportResult.errorReport) {
            errorReport = errorReportResult.errorReport;
            logger.debug({ storeId, errorReport }, 'Error report retrieved');
            
            // Parse CSV error report to identify failed SKUs
            // Format: "sku";"product-id";"product-id-type";...;"error-line";"error-message"
            const lines = errorReport.split('\n');
            
            for (let i = 1; i < lines.length; i++) { // Skip header (line 0)
              const line = lines[i].trim();
              if (!line) continue;
              
              // Split by semicolon and remove quotes
              const columns = line.split(';').map(col => col.replace(/^"/, '').replace(/"$/, ''));
              
              if (columns.length >= 2) {
                const sku = columns[0]; // First column is SKU
                const errorMessage = columns[columns.length - 1]; // Last column is error-message
                
                // If there's an error message, this SKU failed
                if (errorMessage && errorMessage.trim() !== '') {
                  failedSkusMap.set(sku, errorMessage);
                  logger.debug({ sku, errorMessage }, 'Failed SKU identified from error report');
                }
              }
            }
            
            logger.info({ 
              storeId, 
              failedCount: failedSkusMap.size,
              expectedErrorCount: errorCount 
            }, 'Parsed error report');
          } else {
            logger.error({ storeId, importId: updateResult.importId, errorCount }, 
              'Failed to fetch error report from Mirakl - cannot determine which items failed');
            errorReportUnavailable = true;
          }
        }
      }

      // Collect database updates
      const successUpdates: Array<{
        listingId: number;
        quantity?: number;
        price?: number;
        currency: string;
        isSpecialPrice: boolean;
      }> = [];

      const failureUpdates: Array<{
        listingId: number;
        errorCode: string;
        errorMessage: string;
        correlationId?: string;
      }> = [];

      // If error report is unavailable, we cannot determine which items failed
      // So we mark ALL items for retry (don't update success or failure)
      if (errorReportUnavailable) {
        logger.warn({ 
          storeId, 
          offersCount: offers.length,
          miraklReportedErrors: errorCount 
        }, 'Cannot determine which items failed - items will be retried on next sync');
        
        errors.push(`Mirakl reported ${errorCount} errors but error report unavailable - ${offers.length} items will be retried`);
        
        return {
          successCount: 0,
          failureCount: 0, // Not marking as failed to avoid incrementing retry_count
          errors,
        };
      }

      for (const offer of offers) {
        const listing = listingMap.get(offer.shop_sku);
        if (!listing) continue;

        // Check if THIS specific offer failed
        const errorMessage = failedSkusMap.get(offer.shop_sku);
        
        if (errorMessage) {
          // This specific offer failed
          failureUpdates.push({
            listingId: listing.marketplace_listings_id,
            errorCode: 'MIRAKL_ERROR',
            errorMessage: `Mirakl error: ${errorMessage}`,
            correlationId,
          });
        } else {
          // This offer succeeded
          // Store ORIGINAL price (not adjusted) in database for tracking
          successUpdates.push({
            listingId: listing.marketplace_listings_id,
            quantity: offer.quantity,
            price: listing.price,  // Use original basePrice from listingMap
            currency: 'GBP',
            isSpecialPrice: listing.is_special_price,
          });
        }
      }

      // Batch update database records
      if (successUpdates.length > 0) {
        const updatedSuccessCount = await db.markSyncSuccessBatch(successUpdates);
        logger.info({ storeId, successUpdates: updatedSuccessCount }, 'Marked successful offers in database');
      }

      if (failureUpdates.length > 0) {
        await db.markSyncFailureBatch(failureUpdates);
        logger.info({ storeId, failureUpdates: failureUpdates.length }, 'Marked failed offers in database');
      }

      if (errorCount > 0) {
        errors.push(`Debenhams sync completed with ${errorCount} errors`);
      }

      logger.info({
        storeId,
        miraklReportedSuccess: finalStatus.lines_in_success,
        miraklReportedErrors: errorCount,
        databaseMarkedSuccess: successUpdates.length,
        databaseMarkedFailure: failureUpdates.length,
        validationFailures: failureCount,
      }, 'Debenhams sync completed');

      return {
        successCount: successUpdates.length,
        failureCount: failureUpdates.length + failureCount,
        errors,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storeId, error, correlationId }, 'Debenhams sync exception');

      // Collect all failures and batch update
      const failureUpdates = offers.map(offer => {
        const listing = listingMap.get(offer.shop_sku);
        if (!listing) return null;

        return {
          listingId: listing.marketplace_listings_id,
          errorCode: 'SYNC_EXCEPTION',
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

      errors.push(`Debenhams sync failed: ${errorMessage}`);
      return {
        successCount: 0,
        failureCount: failureUpdates.length + failureCount,
        errors,
      };
    }
  }
}
