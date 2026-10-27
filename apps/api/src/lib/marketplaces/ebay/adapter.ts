/**
 * eBay Marketplace Adapter
 * 
 * Handles eBay-specific sync logic using the ebay-api npm package
 * 
 * @taskId #165004
 */

import { nanoid } from 'nanoid';
import { MarketplaceAdapter, MarketplaceSyncResult } from '../common/base-adapter';
import { createEbayClient, EbayItem, PartialFailureDetail } from './client';
import type { ListingItem, ListingNeedingSync } from '../common/types';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { getLogger } from '../../logger-context';
import { applyPriceAdjustment } from '../common/price-utils';
import { config } from '../../../config';

/**
 * eBay item-level error codes for listings that no longer exist or can't be
 * revised, mapped to the terminal marketplace_listing_status they should take.
 *
 * These are terminal: the listing must drop OUT of the sync set (a non-syncable
 * status) instead of being retried forever and left stuck as 'failed'. The sync
 * query only picks 'confirmed'/'active'/'inactive', so 'deleted'/'suspended'
 * exclude the row. 'deleted' = gone for good; 'suspended' = removed but
 * potentially restorable by an admin (e.g. after fixing a policy violation).
 */
const EBAY_TERMINAL_LISTING_ERROR_CODES: Record<string, 'deleted' | 'suspended'> = {
  '21916750': 'deleted',   // FixedPrice item ended
  '21916734': 'deleted',   // Auction has ended
  '21916587': 'deleted',   // Item has been deleted
  '231': 'deleted',        // Item invalid / not activated / no longer in eBay's DB (item not found)
  '291': 'deleted',        // The item cannot be found
  '21920397': 'deleted',   // Listing removed for policy/IP violation (VeRO) — gone for good, drop from sync set
  '21919067': 'suspended', // Listing violates the Duplicate Listing policy
};

/**
 * Returns the terminal listing status for an error code, or null if the error is
 * not terminal (should be retried / treated normally).
 */
export function terminalListingStatus(errorCode: string): 'deleted' | 'suspended' | null {
  return EBAY_TERMINAL_LISTING_ERROR_CODES[errorCode] ?? null;
}

/**
 * For a redundant-revision error, which field(s) eBay confirms already match the
 * value we sent. eBay rejects the WHOLE InventoryStatus entry on a redundant
 * error, so any OTHER field we sent in that entry was NOT applied and must stay
 * divergent so it re-syncs on the next run. Confirming only the named field
 * prevents falsely recording an un-applied quantity/price as synced (which would
 * hide an oversell).
 *   21917091 - StartPrice AND Quantity redundant
 *   21917092 - Quantity redundant
 *   21917093 - StartPrice redundant
 */
function redundantConfirmedFields(errorCode: string): { quantity: boolean; price: boolean } {
  switch (errorCode) {
    case '21917091': return { quantity: true, price: true };
    case '21917092': return { quantity: true, price: false };
    case '21917093': return { quantity: false, price: true };
    default:         return { quantity: false, price: false };
  }
}

/**
 * Whether an eBay item-level error code represents an already-in-sync (redundant)
 * revision that should be counted as a successful sync rather than a failure.
 *
 * eBay returns these with SeverityCode='Error', but they are not real errors:
 * eBay's current value already equals what we sent, so the intended state is
 * already achieved. If treated as failures, `markSyncFailure` never writes
 * `last_synced_quantity`/`last_synced_price`, so `getListingsNeedingSync` keeps
 * re-flagging the listing every run (NULL/stale last_synced vs. current) until
 * retry_count maxes out and it is silently dropped. Treating them as success
 * persists the sent values so the comparison converges in one run.
 *
 * Codes are configured via EBAY_REDUNDANT_REVISION_ERROR_CODES (config/index.ts).
 */
function isRedundantRevision(errorCode: string): boolean {
  return config.EBAY_REDUNDANT_REVISION_ERROR_CODES.includes(errorCode);
}

/**
 * Account-level monthly listing-limit error ("You've reached / would exceed the
 * amount (£3,000,000) you can list this month"). This is NOT a per-listing fault:
 * eBay attaches no ItemID/SKU to it, so it cannot be matched to a single item, and
 * every further revise in the run will fail the same way. The adapter detects it at
 * the response level, does NOT increment retry_count for the affected items, and
 * aborts the run (see syncListings). Codes via EBAY_LISTING_LIMIT_ERROR_CODES.
 */
export function isListingLimitError(errorCode: string): boolean {
  return config.EBAY_LISTING_LIMIT_ERROR_CODES.includes(errorCode);
}

/**
 * eBay listing is single-SKU (not Managed-by-SKU) but we sent a SKU-qualified
 * revise ("SKU does not exist in Non-ManageBySKU item specified by ItemID").
 * Recoverable: re-revise the same ItemID without the SKU field. Codes via
 * EBAY_SKU_NOT_MANAGED_ERROR_CODES.
 */
export function isSkuNotManagedError(errorCode: string): boolean {
  return config.EBAY_SKU_NOT_MANAGED_ERROR_CODES.includes(errorCode);
}

/** Per-item outcome of classifying a ReviseInventoryStatus response. */
export type ItemSyncDecision =
  | { kind: 'terminal'; status: 'deleted' | 'suspended'; errorCode: string; errorMessage: string }
  | { kind: 'failure'; errorCode: string; errorMessage: string }
  | { kind: 'success'; markQty: boolean; markPrice: boolean };

/** A failed-item lookup value (keyed by ItemID and SKU). */
export type FailedItemInfo = { errorCode: string; errorMessage: string; isError: boolean };

/**
 * Builds the per-item failure lookup from eBay's response details, keyed by both
 * ItemID and SKU. Redundant-revision codes are flagged `isError: false` (eBay already
 * holds the value, so it is an effective success), as are Warnings.
 */
export function buildFailedItemsMap(details: PartialFailureDetail[]): Map<string, FailedItemInfo> {
  const map = new Map<string, FailedItemInfo>();
  for (const detail of details) {
    const isActualError = detail.severityCode === 'Error' && !isRedundantRevision(detail.errorCode);
    const info: FailedItemInfo = {
      errorCode: detail.errorCode,
      errorMessage: detail.errorMessage,
      isError: isActualError,
    };
    if (detail.itemId) map.set(detail.itemId, info);
    if (detail.sku) map.set(detail.sku, info);
  }
  return map;
}

/**
 * Classifies one item's outcome given its failure info (or null = no error reported).
 * Pure: the SAME cascade used by the main pass and the SKU-not-managed ItemID-only
 * retry, so a retried item that turns out terminal/redundant is handled correctly
 * instead of being force-suspended or recorded with an un-applied value.
 */
export function classifyReviseItem(
  failureInfo: FailedItemInfo | null | undefined,
  quantityChanged: boolean,
  priceChanged: boolean,
): ItemSyncDecision {
  if (failureInfo && failureInfo.isError) {
    const termStatus = terminalListingStatus(failureInfo.errorCode);
    if (termStatus) {
      return { kind: 'terminal', status: termStatus, errorCode: failureInfo.errorCode, errorMessage: failureInfo.errorMessage };
    }
    return { kind: 'failure', errorCode: failureInfo.errorCode, errorMessage: failureInfo.errorMessage };
  }
  // Success, or a redundant-revision "error" (eBay already holds the value we sent).
  // For a redundant code, only confirm the field(s) eBay names as redundant; leave any
  // other changed field divergent so it re-syncs next run.
  let markQty = quantityChanged;
  let markPrice = priceChanged;
  if (failureInfo && isRedundantRevision(failureInfo.errorCode)) {
    const confirmed = redundantConfirmedFields(failureInfo.errorCode);
    markQty = markQty && confirmed.quantity;
    markPrice = markPrice && confirmed.price;
  }
  return { kind: 'success', markQty, markPrice };
}

export class EbayAdapter extends MarketplaceAdapter {
  getMarketplaceName(): string {
    return 'eBay';
  }

  /**
   * @taskId #165004
   * 
   * Syncs listings to eBay marketplace with price adjustment support.
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
    // Set when eBay reports the account-level monthly listing-limit error: the run
    // aborts after the current batch (every further revise would fail the same way).
    let listingLimitHit = false;

    // Initialize eBay client
    const ebayClient = createEbayClient('ebay');
    
    // Fetch OAuth token once
    let accessToken: string;
    try {
      const jobId = `EBAY_SYNC_${nanoid(8)}_${Date.now()}`;
      logger.info({ storeId, jobId }, 'Fetching eBay OAuth token');
      accessToken = await ebayClient.fetchAccessToken(jobId);
      logger.info({ storeId }, 'eBay OAuth token fetched successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ storeId, error }, 'Failed to fetch eBay OAuth token');
      throw new Error(`Failed to fetch eBay access token: ${errorMessage}`);
    }

    // Create batches
    const batches = ebayClient.createBatches(listings, batchSize);
    logger.info({ storeId, batchCount: batches.length, batchSize }, 'Processing eBay batches');

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
      const items: EbayItem[] = [];
      const listingMap = new Map<string, ListingItem>();
      const itemOnlyListingMap = new Map<string, ListingItem>();
      const getListingInfo = (item: EbayItem): ListingItem | undefined => {
        return (item.SKU ? listingMap.get(item.SKU) : undefined) ?? itemOnlyListingMap.get(item.ItemID);
      };

      // Listings the SQL flagged as needing sync but which the JS-side comparison
      // sees as a no-op (nothing to send). Without persisting anything, last_synced_*
      // stays stale and getListingsNeedingSync re-selects the same rows every run,
      // starving the LIMIT-capped queue (see #822 / eBay re-pick loop). We converge
      // them by writing the current quantity/price so the next run's filter matches.
      const noopConvergeUpdates: Array<{
        listingId: number;
        quantity: number;
        price: number;
        currency: string;
        isSpecialPrice: boolean;
      }> = [];

      // Generate correlation ID for this batch
      const correlationId = `EBAY_BATCH_${storeId}_${batchNum}_${Date.now()}_${nanoid(8)}`;

      for (const listing of batch) {
        const itemId = listing.marketplace_item_identifier;
        const productSku = listing.products_sku;
        const productSkuInternal = listing.npv_products_sku;
        const isInactive = listing.marketplace_listing_status === 'inactive';

        // Use normalized_quantity (already includes capping and handles inactive items)
        // Convert to integer as marketplaces expect whole numbers
        const quantity = Math.floor(listing.normalized_quantity);
        
        if (isInactive) {
          logger.info(
            { listingId: listing.marketplace_listings_id, itemId, sku: productSku, batchNum },
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
              itemId,
              sku: productSku,
              basePrice: priceResult.basePrice,
              priceAdjustment: priceResult.priceAdjustment,
              adjustedPrice: priceResult.adjustedPrice,
              error: priceResult.error,
              batchNum,
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
            batchNum
          }, 'Applying price adjustment');
        }

        // Determine what changed
        // Coerce to Number: Prisma raw queries return DECIMAL columns as Prisma.Decimal
        // instances; strict-equality comparison between two Decimal objects is identity-based
        // and always reports a change, causing eBay to receive unchanged prices on every sync.
        const lastSyncedQuantity = listing.last_synced_quantity ?? -1;
        const lastSyncedPrice = listing.last_synced_price !== null && listing.last_synced_price !== undefined
          ? Number(listing.last_synced_price)
          : -1;
        const quantityChanged = lastSyncedQuantity !== quantity;
        const priceChanged = lastSyncedPrice !== Number(basePrice);

        // Build item data for API (ONLY include changed fields)
        const itemData: EbayItem = {
          ItemID: itemId,
        };

        if (productSku) {
          itemData.SKU = productSku;
        }

        if (quantityChanged) {
          itemData.Quantity = quantity;
        }

        if (priceChanged) {
          itemData.Price = adjustedPrice;  // Send ADJUSTED price to marketplace
        }

        // Skip if nothing changed — eBay's ReviseInventoryStatus requires at least
        // one of Quantity or Price per item and rejects the entire batch with
        // error 37 ("Input data for tag <{0}> is invalid or missing") if any item
        // contains only ItemID/SKU. This can happen when the SQL filter picks up
        // a row whose JS-side comparison sees neither field as changed (e.g.
        // currency/precision mismatch between MySQL DECIMAL and JS Number).
        if (!quantityChanged && !priceChanged) {
          // No API call needed, but we MUST persist the current state. Leaving the
          // row untouched guarantees getListingsNeedingSync re-selects it next run
          // (the SQL filter still sees a difference its way), so it would be picked
          // and skipped forever, blocking the LIMIT-capped queue. Converge instead.
          logger.debug(
            { listingId: listing.marketplace_listings_id, itemId, sku: productSku, batchNum, correlationId },
            'No changes detected — converging last_synced_* without an API call'
          );
          const isSpecialPrice = listing.specials_status === 'Special' && (listing.specials_price || 0) > 0;
          noopConvergeUpdates.push({
            listingId: listing.marketplace_listings_id,
            quantity,
            price: basePrice,
            currency: 'GBP',
            isSpecialPrice,
          });
          continue;
        }

        items.push(itemData);

        // Store in listing map for later reference. Variation listings share a
        // single eBay ItemID across multiple SKUs, so use SKU as the primary key.
        const isSpecialPrice = listing.specials_status === 'Special' && (listing.specials_price || 0) > 0;
        const listingInfo: ListingItem = {
          marketplace_listings_id: listing.marketplace_listings_id,
          products_sku: productSku,
          product_sku_internal: productSkuInternal,
          marketplace_item_identifier: itemId,
          quantity,
          price: basePrice,  // Store ORIGINAL price for database
          quantity_changed: quantityChanged,
          price_changed: priceChanged,
          is_special_price: isSpecialPrice,
          regular_price: listing.products_price,
          special_price: listing.specials_price,
          price_adjustment: priceAdjustment,
        };
        if (productSku) {
          listingMap.set(productSku, listingInfo);
        } else {
          itemOnlyListingMap.set(itemId, listingInfo);
        }
      }

      // Persist no-op listings so they are not re-selected forever. These needed no
      // eBay API call (already in sync), so they count as successful syncs.
      if (noopConvergeUpdates.length > 0) {
        const converged = await db.markSyncSuccessBatch(noopConvergeUpdates);
        successCount += converged;
        logger.info(
          { storeId, batchNum, converged, requested: noopConvergeUpdates.length },
          'Converged no-op listings (no API call, last_synced_* refreshed)'
        );
      }

      // Skip batch if no items to sync (all listings in the batch were no-ops)
      if (items.length === 0) {
        logger.info({ storeId, batchNum }, 'No items to sync in batch, skipping API call');
        continue;
      }

      // Call eBay API
      try {
        const callId = `B${batchNum}_${nanoid(6)}`;
        logger.debug({ storeId, callId, correlationId, itemCount: items.length }, 'Calling eBay API');

        const result = await ebayClient.reviseInventoryStatus(storeId, items, accessToken);

        // Account-level monthly listing-limit, detected at the RESPONSE level. eBay
        // attaches no ItemID/SKU to this error, so the per-item failedItemsMap below
        // would never see it and would silently mark the rejected batch as success.
        // It is also not the listing's fault and every further revise this run will
        // fail the same way, so: commit only the items eBay did NOT error on, write
        // NO failures (no retry_count burn), and abort the run after this batch.
        const listingLimitInResponse =
          isListingLimitError(result.errorCode ?? '') ||
          (result.partialFailureDetails ?? []).some((d) => isListingLimitError(d.errorCode));

        if (listingLimitInResponse) {
          listingLimitHit = true;

          const erroredKeys = new Set<string>();
          for (const d of result.partialFailureDetails ?? []) {
            if (d.itemId) erroredKeys.add(d.itemId);
            if (d.sku) erroredKeys.add(d.sku);
          }

          const cleanSuccess = items
            .filter((item) => !erroredKeys.has(item.ItemID) && !(item.SKU && erroredKeys.has(item.SKU)))
            .map((item) => {
              const listingInfo = getListingInfo(item);
              if (!listingInfo) return null;
              return {
                listingId: listingInfo.marketplace_listings_id,
                quantity: listingInfo.quantity_changed ? listingInfo.quantity : undefined,
                price: listingInfo.price_changed ? listingInfo.price : undefined,
                currency: 'GBP',
                isSpecialPrice: listingInfo.is_special_price,
              };
            })
            .filter(Boolean) as Array<{
              listingId: number;
              quantity?: number;
              price?: number;
              currency: string;
              isSpecialPrice: boolean;
            }>;

          if (cleanSuccess.length > 0) {
            successCount += await db.markSyncSuccessBatch(cleanSuccess);
          }

          logger.error(
            { storeId, batchNum, committed: cleanSuccess.length, frozen: items.length - cleanSuccess.length },
            'eBay monthly listing-limit reached — freezing run (no retry burn, aborting after this batch)'
          );
        } else if (result.success) {
          // Check for PartialFailure or Failure with item-level errors
          if ((result.ack === 'PartialFailure' || result.ack === 'Failure') && result.partialFailureDetails && result.partialFailureDetails.length > 0) {
            // Handle partial failure - split items into successes and failures
            logger.info(
              { storeId, batchNum, totalItems: items.length, errorCount: result.partialFailureDetails.length, ack: result.ack },
              `Processing ${result.ack} response with item-level errors`
            );

            // Build the per-item failure lookup (keyed by ItemID and SKU).
            const failedItemsMap = buildFailedItemsMap(result.partialFailureDetails);

            // Split items into successes, failures and terminal (ended/removed).
            const successUpdates = [];
            const failureUpdates = [];
            const terminalUpdates: Array<{
              listingId: number;
              status: 'deleted' | 'suspended' | 'paused' | 'draft';
              errorCode: string;
              errorMessage: string;
              itemId: string;
            }> = [];
            // Items that hit "SKU does not exist in Non-ManageBySKU item": retried once
            // ItemID-only (no SKU) below instead of being failed immediately.
            const skuRetryItems: EbayItem[] = [];

            // Routes a classified decision into the success/failure/terminal buckets.
            const routeDecision = (decision: ItemSyncDecision, listingInfo: ListingItem, item: EbayItem) => {
              if (decision.kind === 'terminal') {
                terminalUpdates.push({
                  listingId: listingInfo.marketplace_listings_id,
                  status: decision.status,
                  errorCode: decision.errorCode,
                  errorMessage: decision.errorMessage,
                  itemId: item.ItemID,
                });
                logger.warn(
                  {
                    listingId: listingInfo.marketplace_listings_id,
                    itemId: item.ItemID,
                    sku: item.SKU,
                    errorCode: decision.errorCode,
                    errorMessage: decision.errorMessage,
                    status: decision.status,
                  },
                  'eBay listing ended/removed - marking terminal (excluded from future sync)'
                );
              } else if (decision.kind === 'failure') {
                failureUpdates.push({
                  listingId: listingInfo.marketplace_listings_id,
                  errorCode: decision.errorCode,
                  errorMessage: decision.errorMessage,
                  correlationId,
                });
              } else {
                successUpdates.push({
                  listingId: listingInfo.marketplace_listings_id,
                  quantity: decision.markQty ? listingInfo.quantity : undefined,
                  price: decision.markPrice ? listingInfo.price : undefined,
                  currency: 'GBP',
                  isSpecialPrice: listingInfo.is_special_price,
                });
              }
            };

            for (const item of items) {
              const listingInfo = getListingInfo(item);
              if (!listingInfo) continue;

              const failureInfo = (item.SKU ? failedItemsMap.get(item.SKU) : null) || failedItemsMap.get(item.ItemID);

              // SKU-not-managed: defer to a single ItemID-only retry instead of failing.
              if (failureInfo && failureInfo.isError && isSkuNotManagedError(failureInfo.errorCode)) {
                skuRetryItems.push(item);
                continue;
              }

              routeDecision(
                classifyReviseItem(failureInfo, listingInfo.quantity_changed, listingInfo.price_changed),
                listingInfo,
                item
              );
            }

            // Single ItemID-only retry for SKU-not-managed items: the listing is not
            // Managed-by-SKU, so re-revise without the SKU field. Run the retry response
            // through the SAME classifier; if an item still fails, suspend it for manual
            // review instead of burning retries on an unrevisable listing.
            if (skuRetryItems.length > 0) {
              logger.info(
                { storeId, batchNum, count: skuRetryItems.length },
                'Retrying SKU-not-managed items ItemID-only (no SKU)'
              );
              const skuLessItems: EbayItem[] = skuRetryItems.map((it) => ({
                ItemID: it.ItemID,
                Quantity: it.Quantity,
                Price: it.Price,
              }));
              const retryResult = await ebayClient.reviseInventoryStatus(storeId, skuLessItems, accessToken);
              const retryFailedMap = buildFailedItemsMap(retryResult.partialFailureDetails ?? []);

              for (const item of skuRetryItems) {
                const listingInfo = getListingInfo(item);
                if (!listingInfo) continue;
                // The retry sent no SKU, so eBay keys any error by ItemID.
                const failureInfo = retryFailedMap.get(item.ItemID);
                const decision = classifyReviseItem(failureInfo, listingInfo.quantity_changed, listingInfo.price_changed);

                if (decision.kind === 'failure') {
                  terminalUpdates.push({
                    listingId: listingInfo.marketplace_listings_id,
                    status: 'suspended',
                    errorCode: decision.errorCode,
                    errorMessage: `ItemID-only retry still failed: ${decision.errorMessage}`,
                    itemId: item.ItemID,
                  });
                  logger.warn(
                    { listingId: listingInfo.marketplace_listings_id, itemId: item.ItemID, errorCode: decision.errorCode },
                    'SKU-not-managed item still failing after ItemID-only retry - suspending for manual review'
                  );
                } else {
                  routeDecision(decision, listingInfo, item);
                }
              }
            }

            // Guard against FALSE "ended" (21916750): on OutOfStockControl listings
            // eBay returns a transient/false "FixedPrice item ended" while the listing
            // is still ACTIVE — deleting it then orphans a live listing (and the relist
            // job could duplicate it). Verify each 21916750 terminal via GetItem before
            // deleting; if still Active, DON'T delete — record a retryable failure so
            // the next sync re-pushes. Other terminal codes (231/21920397/…) are
            // unambiguous and deleted as-is. GetItem is cached per ItemID.
            let confirmedTerminal = terminalUpdates;
            if (terminalUpdates.some((t) => t.errorCode === '21916750')) {
              confirmedTerminal = [];
              const activeByItem = new Map<string, boolean>();
              for (const t of terminalUpdates) {
                if (t.errorCode === '21916750') {
                  let active = activeByItem.get(t.itemId);
                  if (active === undefined) {
                    active = (await ebayClient.getItemListingStatus(storeId, t.itemId)) === 'active';
                    activeByItem.set(t.itemId, active);
                  }
                  if (active) {
                    failureUpdates.push({
                      listingId: t.listingId,
                      errorCode: 'EBAY_FALSE_ENDED_21916750',
                      errorMessage: `eBay reports item ${t.itemId} still Active; not deleting (transient 'ended' on OOS listing)`,
                      correlationId,
                    });
                    logger.warn(
                      { storeId, batchNum, listingId: t.listingId, itemId: t.itemId },
                      'Suppressed false 21916750 terminal — listing still Active on eBay (will retry)'
                    );
                    continue;
                  }
                }
                confirmedTerminal.push(t);
              }
            }

            // Mark terminal listings (ended/removed) so they leave the sync set
            if (confirmedTerminal.length > 0) {
              const marked = await db.markListingsTerminalBatch(confirmedTerminal);
              successCount += marked; // resolved: no longer a failing row
            }

            // Update successes
            if (successUpdates.length > 0) {
              const updated = await db.markSyncSuccessBatch(successUpdates);
              successCount += updated;

              if (updated < successUpdates.length) {
                const dbFailures = successUpdates.length - updated;
                failureCount += dbFailures;
                errors.push(`Batch ${batchNum}: ${dbFailures} database update(s) failed`);
              }
            }

            // Update failures
            if (failureUpdates.length > 0) {
              await db.markSyncFailureBatch(failureUpdates);
              failureCount += failureUpdates.length;
              
              logger.info(
                { storeId, batchNum, successCount: successUpdates.length, failureCount: failureUpdates.length },
                'Batch completed with partial failures'
              );
              
              // Add detailed error messages to errors array (for email alerts)
              // Group by error code for cleaner reporting
              const errorsByCode = new Map<string, string[]>();
              const allListingInfos = [...listingMap.values(), ...itemOnlyListingMap.values()];
              for (const failure of failureUpdates) {
                const listingInfo = allListingInfos.find(
                  info => info.marketplace_listings_id === failure.listingId
                );
                const sku = listingInfo?.products_sku || 'unknown';
                
                if (!errorsByCode.has(failure.errorCode)) {
                  errorsByCode.set(failure.errorCode, []);
                }
                errorsByCode.get(failure.errorCode)!.push(sku);
              }
              
              // Format error messages
              for (const [errorCode, skus] of errorsByCode) {
                const errorInfo = failureUpdates.find(f => f.errorCode === errorCode);
                const errorMessage = errorInfo?.errorMessage || 'Unknown error';
                errors.push(
                  `Batch ${batchNum}: [${errorCode}] ${errorMessage} (SKUs: ${skus.slice(0, 3).join(', ')}${skus.length > 3 ? ` +${skus.length - 3} more` : ''}) [${correlationId}]`
                );
              }
            }

          } else {
            // Full success: collect all updates and batch update
            const successUpdates = items.map(item => {
              const listingInfo = getListingInfo(item);
              if (!listingInfo) return null;

              return {
                listingId: listingInfo.marketplace_listings_id,
                quantity: listingInfo.quantity_changed ? listingInfo.quantity : undefined,
                price: listingInfo.price_changed ? listingInfo.price : undefined,
                currency: 'GBP',
                isSpecialPrice: listingInfo.is_special_price,
              };
            }).filter(Boolean) as Array<{
              listingId: number;
              quantity?: number;
              price?: number;
              currency: string;
              isSpecialPrice: boolean;
            }>;

            // Single batch update for all items
            const updated = await db.markSyncSuccessBatch(successUpdates);
            successCount += updated;

            if (updated < successUpdates.length) {
              failureCount += (successUpdates.length - updated);
              errors.push(`Batch ${batchNum}: Some database updates failed`);
            }
          }
        } else {
          // Complete failure: collect all failures and batch update
          const errorCode = result.errorCode || 'API_UNKNOWN_ERROR';
          const errorMessage = result.error || 'Unknown error';

          const failureUpdates = items.map(item => {
            const listingInfo = getListingInfo(item);
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

          // Single batch update for all failures
          await db.markSyncFailureBatch(failureUpdates);
          failureCount += failureUpdates.length;

          // Collect SKUs for error message
          const skus = items.map(item => {
            const listingInfo = getListingInfo(item);
            return listingInfo?.products_sku || item.SKU || 'unknown';
          });

          errors.push(
            `Batch ${batchNum}: [${errorCode}] ${errorMessage} (SKUs: ${skus.slice(0, 3).join(', ')}${skus.length > 3 ? ` +${skus.length - 3} more` : ''}) [${correlationId}]`
          );
        }
      } catch (error) {
        // Exception: collect all failures and batch update
        const errorMessage = error instanceof Error ? error.message : 'Unknown exception';
        logger.error({ storeId, batchNum, error, correlationId }, 'Batch processing exception');

        const failureUpdates = items.map(item => {
          const listingInfo = getListingInfo(item);
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

        // Single batch update for all exceptions
        await db.markSyncFailureBatch(failureUpdates);
        failureCount += failureUpdates.length;

        errors.push(`Batch ${batchNum}: Exception - ${errorMessage}`);
      }

      // Account-level monthly listing-limit reached: stop the run. Every remaining
      // batch would fail the same way and waste API calls; the deferred listings keep
      // their retry_count unchanged and resync on a later run (or next month).
      if (listingLimitHit) {
        errors.push(
          `ALERT: eBay monthly listing-limit reached — sync run aborted after batch ${batchNum}. Remaining listings deferred (no retry_count change).`
        );
        break;
      }

      // Rate limiting: sleep between batches
      if (batchIndex < batches.length - 1 && batchDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay * 1000));
      }
    }

    return {
      successCount,
      failureCount,
      errors,
    };
  }
}
