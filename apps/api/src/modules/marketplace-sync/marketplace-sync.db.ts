/**
 * Marketplace Sync Database Service
 * 
 * Raw SQL queries for marketplace_listings and legacy product tables
 * 
 * @taskId #165004
 */

import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import type { ListingNeedingSync } from '../../lib/marketplaces/common/types';
import { buildListingsNeedingSyncQuery, buildEbayRelistCandidatesQuery } from './marketplace-sync.query';

// Re-export for backwards compatibility
export type { ListingNeedingSync };
export { buildListingsNeedingSyncQuery };

/**
 * @taskId #165002
 * Get listings that need syncing
 * 
 * Returns listings where:
 * - listing_status IN ('confirmed', 'active', 'inactive')
 *   - For 'active'/'confirmed': syncs actual inventory and price changes
 *   - For 'inactive': syncs quantity as 0 to delist items (only if not already 0)
 * - marketplace_item_id and marketplace_sku are not empty
 * - quantity changed OR price changed (or needs to be set to 0 for inactive)
 * - retry_count < max_retries
 * 
 * Quantity Capping Logic:
 * - If maxQuantityCap = 0: Send full UKSS quantity (no capping)
 * - If maxQuantityCap > 0: Send MIN(actual_quantity, maxQuantityCap)
 * 
 * @param storeId - The store ID to fetch listings for
 * @param limit - Maximum number of listings to fetch (marketplace-specific)
 * @param maxQuantityCap - Maximum quantity cap for this marketplace (0 = no cap)
 * @param maxRetries - Maximum retry attempts for this marketplace
 * @param bestsellersOnly - Whether to sync only bestselling products (products with np_best_seller_lifetime > 0)
 */
export async function getListingsNeedingSync(
  storeId: number,
  limit: number,
  maxQuantityCap: number,
  maxRetries: number,
  bestsellersOnly: boolean = false
): Promise<ListingNeedingSync[]> {

  // Reason for executing Raw SQL here:
  // - To avoid the complexity of using the Prisma ORM for this specific query
  // - To avoid the performance overhead of using the Prisma ORM for this specific query
  const query = buildListingsNeedingSyncQuery(bestsellersOnly);

  try {
    const results = await (prisma.$queryRawUnsafe as <T = unknown>(query: string, ...values: any[]) => Promise<T>)<ListingNeedingSync[]>(
      query,
      maxQuantityCap, // normalized_quantity CASE check for 0
      maxQuantityCap, // normalized_quantity CASE comparison
      maxQuantityCap, // normalized_quantity CASE result
      storeId,
      maxQuantityCap, // WHERE CASE check for 0
      maxQuantityCap, // WHERE CASE comparison
      maxQuantityCap, // WHERE CASE result
      maxRetries,
      limit
    );

    // Log query executed
    getLogger('marketplace-sync-db').debug({ query }, 'Query executed');
    getLogger('marketplace-sync-db').info({ storeId, count: results.length, limit, bestsellersOnly }, 'Fetched listings needing sync');
    return results;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ storeId, error }, 'Failed to fetch listings needing sync');
    throw error;
  }
}

/**
 * A relist candidate: an eBay listing marked terminal `deleted` due to error
 * 21916750 ("FixedPrice item ended") that still has stock (normalized_quantity > 0).
 */
export interface EbayRelistCandidate {
  marketplace_listings_id: number;
  marketplace_item_identifier: string;
  products_sku: string;
  price_adjustment: number;
  /** Base (un-adjusted) current price — persisted to last_synced_price on relist. */
  current_price: number;
  specials_status: string | null;
  specials_price: number | null;
  /** UKSS available quantity after eBay capping/rules — what we relist at. */
  normalized_quantity: number;
}

// Coerce DECIMAL/BigInt columns (Prisma returns Decimal/BigInt for raw numeric cols).
// Shared by getEbayRelistCandidates (21916750 path) and getEbayGhostRelistCandidates
// (ghost path) — both query builders project the exact same candidate row shape.
const mapRelistCandidateRow = (r: any): EbayRelistCandidate => ({
  marketplace_listings_id: Number(r.marketplace_listings_id),
  marketplace_item_identifier: String(r.marketplace_item_identifier),
  products_sku: String(r.products_sku),
  price_adjustment: Number(r.price_adjustment ?? 0),
  current_price: Number(r.current_price ?? 0),
  specials_status: r.specials_status ?? null,
  specials_price: r.specials_price !== null && r.specials_price !== undefined ? Number(r.specials_price) : null,
  normalized_quantity: Number(r.normalized_quantity),
});

/**
 * Fetch eBay listings that were marked terminal `deleted` for error 21916750 but
 * still have stock, so the relist job can put them back up. Read-only.
 *
 * @param storeId - eBay store ID
 * @param maxQuantityCap - eBay quantity cap (0 = no cap); mirrors the sync cap
 * @param limit - max candidates to return (controls batch size for the job)
 */
export async function getEbayRelistCandidates(
  storeId: number,
  maxQuantityCap: number,
  limit: number
): Promise<EbayRelistCandidate[]> {
  const query = buildEbayRelistCandidatesQuery();
  try {
    const rows = await (prisma.$queryRawUnsafe as <T = unknown>(query: string, ...values: any[]) => Promise<T>)<any[]>(
      query,
      maxQuantityCap, // CASE: cap == 0 check
      maxQuantityCap, // CASE: qty >= cap comparison
      maxQuantityCap, // CASE: capped result
      storeId,
      limit
    );

    const candidates: EbayRelistCandidate[] = rows.map(mapRelistCandidateRow);

    getLogger('marketplace-sync-db').info(
      { storeId, count: candidates.length, limit },
      'Fetched eBay relist candidates (ended with stock)'
    );
    return candidates;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ storeId, error }, 'Failed to fetch eBay relist candidates');
    throw error;
  }
}

/**
 * Relist candidates for GHOST rows (live in DB, absent from eBay's ActiveList):
 * same quantity arms and normalized_quantity > 0 filter as the 21916750 path,
 * but scoped to explicit ItemIDs with live DB status. Ghosts without sellable
 * stock are correctly excluded here — mark-gone is their cleanup path.
 *
 * @param storeId - eBay store ID
 * @param itemIds - ghost ItemIDs to check for sellable stock
 * @param maxQuantityCap - eBay quantity cap (0 = no cap); mirrors the sync cap
 */
export async function getEbayGhostRelistCandidates(
  storeId: number,
  itemIds: string[],
  maxQuantityCap: number
): Promise<EbayRelistCandidate[]> {
  if (itemIds.length === 0) return [];
  const query = buildEbayRelistCandidatesQuery({ ghostItemIdCount: itemIds.length });
  try {
    const rows = await (prisma.$queryRawUnsafe as <T = unknown>(query: string, ...values: any[]) => Promise<T>)<any[]>(
      query,
      maxQuantityCap, // CASE: cap == 0 check
      maxQuantityCap, // CASE: qty >= cap comparison
      maxQuantityCap, // CASE: capped result
      storeId,
      ...itemIds,
      itemIds.length * 50 // generous limit: every variation row of every requested ItemID
    );

    const candidates: EbayRelistCandidate[] = rows.map(mapRelistCandidateRow);

    getLogger('marketplace-sync-db').info(
      { storeId, requested: itemIds.length, count: candidates.length },
      'Fetched eBay ghost relist candidates'
    );
    return candidates;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ storeId, itemIds: itemIds.length, error }, 'Failed to fetch eBay ghost relist candidates');
    throw error;
  }
}


/**
 * Mark sync as successful (using Prisma ORM)
 * 
 * Only updates fields that were actually synced
 * 
 * @param listingId - The marketplace listing ID
 * @param quantity - The quantity that was synced
 * @param price - The price that was synced
 * @param currency - The currency (default: GBP)
 * @param isSpecialPrice - Whether the synced price is a special/sale price
 */
export async function markSyncSuccess(
  listingId: number,
  quantity?: number,
  price?: number,
  currency: string = 'GBP',
  isSpecialPrice: boolean = false
): Promise<boolean> {
  try {
    const updateData: any = {
      lastSyncStatus: 'success',
      lastSyncedAt: new Date(),
      retryCount: 0,
      apiLastErrorCode: null,
      apiLastErrorMessage: null,
    };

    // Only update quantity if it was synced
    if (quantity !== undefined && quantity !== null) {
      updateData.lastSyncedQuantity = quantity;
    }

    // Only update price if it was synced
    if (price !== undefined && price !== null) {
      updateData.lastSyncedPrice = price;
      updateData.lastSyncedPriceCurrency = currency;
      
      // If this is a special price, also save it to last_synced_special_price
      if (isSpecialPrice) {
        updateData.lastSyncedSpecialPrice = price;
      }
    }

    await prisma.marketplaceListing.update({
      where: {
        marketplaceListingsId: listingId,
      },
      data: updateData,
    });

    getLogger('marketplace-sync-db').debug({ listingId, quantity, price, currency, isSpecialPrice }, 'Marked sync as success using Prisma');
    return true;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ listingId, error }, 'Failed to mark sync as success');
    return false;
  }
}

/**
 * Batch mark sync as successful for multiple listings
 * 
 * Performs a SINGLE SQL UPDATE statement using CASE expressions
 * 
 * @param updates - Array of listing updates
 */
export async function markSyncSuccessBatch(
  updates: Array<{
    listingId: number;
    quantity?: number;
    price?: number;
    currency?: string;
    isSpecialPrice?: boolean;
  }>
): Promise<number> {
  if (updates.length === 0) return 0;

  try {
    // Use Prisma transaction with individual updates for SQL injection safety
    // This is safer than raw SQL with string interpolation
    await prisma.$transaction(
      updates.map(u => {
        const data: any = {
          lastSyncStatus: 'success',
          lastSyncedAt: new Date(),
          retryCount: 0,
          apiLastErrorCode: null,
          apiLastErrorMessage: null,
        };

        // Only update fields that were actually synced
        if (u.quantity !== undefined && u.quantity !== null) {
          data.lastSyncedQuantity = u.quantity;
        }

        if (u.price !== undefined && u.price !== null) {
          data.lastSyncedPrice = u.price;
          data.lastSyncedPriceCurrency = u.currency || 'GBP';
          
          if (u.isSpecialPrice) {
            data.lastSyncedSpecialPrice = u.price;
          }
        }

        return prisma.marketplaceListing.update({
          where: { marketplaceListingsId: u.listingId },
          data,
        });
      })
    );

    getLogger('marketplace-sync-db').debug({ count: updates.length }, 'Batch marked sync as success using Prisma transaction');
    return updates.length;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ error, count: updates.length }, 'Failed to batch mark sync as success');
    return 0;
  }
}

/**
 * Batch mark sync as failed for multiple listings
 * 
 * Performs a SINGLE SQL UPDATE statement using CASE expressions
 * 
 * @param failures - Array of listing failures
 */
export async function markSyncFailureBatch(
  failures: Array<{
    listingId: number;
    errorCode: string;
    errorMessage: string;
    correlationId?: string;
  }>
): Promise<number> {
  if (failures.length === 0) return 0;

  try {
    // Use Prisma transaction with individual updates for SQL injection safety
    // This is safer than raw SQL with manual string escaping
    await prisma.$transaction(
      failures.map(f => {
        const fullMessage = f.correlationId 
          ? `[${f.correlationId}] ${f.errorMessage}`
          : f.errorMessage;

        return prisma.marketplaceListing.update({
          where: { marketplaceListingsId: f.listingId },
          data: {
            lastSyncStatus: 'failed',
            retryCount: { increment: 1 },
            apiLastErrorCode: f.errorCode,
            apiLastErrorMessage: fullMessage,
          },
        });
      })
    );

    getLogger('marketplace-sync-db').debug({ count: failures.length }, 'Batch marked sync as failed using Prisma transaction');
    return failures.length;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ error, count: failures.length }, 'Failed to batch mark sync as failed');
    return 0;
  }
}

/**
 * Batch mark listings as terminal (ended/removed on the marketplace).
 *
 * Some marketplace errors mean the listing no longer exists or can't be revised
 * (e.g. eBay "FixedPrice item ended" / "removed for policy violation"). Retrying
 * such a listing fails forever and leaves it stuck as last_sync_status='failed'.
 *
 * This sets a non-syncable marketplace_listing_status ('deleted' | 'suspended' |
 * 'paused' | 'draft') so the listing drops out of getListingsNeedingSync (which
 * only syncs 'confirmed'/'active'/'inactive'), and sets last_sync_status='success'
 * so it stops being counted as a perpetually-failing row. The marketplace error
 * code/message is retained for audit of *why* it became terminal.
 */
export async function markListingsTerminalBatch(
  updates: Array<{
    listingId: number;
    status: 'deleted' | 'suspended' | 'paused' | 'draft';
    errorCode: string;
    errorMessage: string;
  }>
): Promise<number> {
  if (updates.length === 0) return 0;

  try {
    await prisma.$transaction(
      updates.map(u =>
        prisma.marketplaceListing.update({
          where: { marketplaceListingsId: u.listingId },
          data: {
            marketplaceListingStatus: u.status,
            lastSyncStatus: 'success',
            retryCount: 0,
            apiLastErrorCode: u.errorCode,
            apiLastErrorMessage: u.errorMessage,
          },
        })
      )
    );

    getLogger('marketplace-sync-db').info(
      { count: updates.length },
      'Batch marked listings terminal (excluded from future sync)'
    );
    return updates.length;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ error, count: updates.length }, 'Failed to batch mark listings terminal');
    return 0;
  }
}

/** An eBay row that was marked terminal `deleted` for error 21916750 ("ended"). */
export interface EbayDeletedEndedRow {
  marketplace_listings_id: number;
  marketplace_item_identifier: string;
}

/**
 * All eBay rows marked terminal `deleted` due to error 21916750 ("FixedPrice item
 * ended") for a store. Used by reconciliation to cross-check against eBay's live
 * ActiveList and by the relist guard. Read-only.
 */
export async function getEbayDeletedEndedRows(storeId: number): Promise<EbayDeletedEndedRow[]> {
  const rows = await prisma.marketplaceListing.findMany({
    where: {
      storeId,
      marketplaceListingStatus: 'deleted',
      apiLastErrorCode: '21916750',
      marketplaceItemIdentifier: { not: null },
    },
    select: { marketplaceListingsId: true, marketplaceItemIdentifier: true },
  });
  return rows
    .filter((r) => r.marketplaceItemIdentifier && r.marketplaceItemIdentifier !== '')
    .map((r) => ({
      marketplace_listings_id: r.marketplaceListingsId,
      marketplace_item_identifier: r.marketplaceItemIdentifier as string,
    }));
}

/**
 * Reactivate eBay rows that were FALSELY marked `deleted` for error 21916750 but
 * whose listing is actually still live on eBay. Restores them to the sync set
 * exactly like a manual fix: `confirmed`, `last_synced_quantity=NULL` (forces a
 * resync so the current stock is re-pushed), retry reset, error cleared. Only
 * touches `deleted` + `21916750` rows for the given ItemIDs (never other deletions).
 *
 * @returns number of rows reactivated
 */
export async function reactivateEbayFalseDeletes(storeId: number, itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  try {
    const result = await prisma.marketplaceListing.updateMany({
      where: {
        storeId,
        marketplaceListingStatus: 'deleted',
        apiLastErrorCode: '21916750',
        marketplaceItemIdentifier: { in: itemIds },
      },
      data: {
        marketplaceListingStatus: 'confirmed',
        lastSyncStatus: 'pending',
        lastSyncedQuantity: null,
        retryCount: 0,
        apiLastErrorCode: null,
        apiLastErrorMessage: null,
      },
    });
    getLogger('marketplace-sync-db').info(
      { storeId, items: itemIds.length, reactivated: result.count },
      'Reactivated falsely-deleted eBay listings (still live on eBay)'
    );
    return result.count;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ error, storeId, items: itemIds.length }, 'Failed to reactivate false-deleted eBay listings');
    return 0;
  }
}

/**
 * Point all rows for an OLD (ended) eBay ItemID at the NEW ItemID produced by
 * RelistFixedPriceItem, reactivate them, and reset last_synced so the next sync
 * re-pushes current per-variation quantities/prices to the relisted listing.
 *
 * A single eBay ItemID backs all variation rows, so this updates EVERY row for the
 * old ItemID (not just the candidate variation). RelistFixedPriceItem reuses the
 * item's prior data, so we deliberately do NOT write a quantity here.
 *
 * @returns number of rows updated
 */
export async function markEbayRelistedByItemId(storeId: number, oldItemId: string, newItemId: string): Promise<number> {
  try {
    const result = await prisma.marketplaceListing.updateMany({
      where: { storeId, marketplaceItemIdentifier: oldItemId },
      data: {
        marketplaceItemIdentifier: newItemId,
        marketplaceListingStatus: 'active',
        lastSyncStatus: 'pending',
        lastSyncedQuantity: null,
        retryCount: 0,
        apiLastErrorCode: null,
        apiLastErrorMessage: null,
      },
    });
    getLogger('marketplace-sync-db').info(
      { storeId, oldItemId, newItemId, rows: result.count },
      'Repointed listing rows to relisted ItemID (reactivated, resync forced)'
    );
    return result.count;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ error, storeId, oldItemId, newItemId }, 'Failed to repoint relisted ItemID');
    return 0;
  }
}

/**
 * Mark sync as failed (using Prisma ORM)
 * 
 * Increments retry_count and stores error details
 * 
 * @param listingId - The marketplace listing ID
 * @param errorCode - Error code
 * @param errorMessage - Error message
 * @param correlationId - Optional correlation ID to track the request
 */
export async function markSyncFailure(
  listingId: number,
  errorCode: string,
  errorMessage: string,
  correlationId?: string
): Promise<boolean> {
  try {
    // Include correlation ID in error message if provided
    const fullErrorMessage = correlationId 
      ? `[${correlationId}] ${errorMessage}`
      : errorMessage;

    await prisma.marketplaceListing.update({
      where: {
        marketplaceListingsId: listingId,
      },
      data: {
        lastSyncStatus: 'failed',
        retryCount: {
          increment: 1,
        },
        apiLastErrorCode: errorCode,
        apiLastErrorMessage: fullErrorMessage,
      },
    });

    getLogger('marketplace-sync-db').debug({ listingId, errorCode, correlationId }, 'Marked sync as failed using Prisma');
    return true;
  } catch (error) {
    getLogger('marketplace-sync-db').error({ listingId, error }, 'Failed to mark sync as failed');
    return false;
  }
}

