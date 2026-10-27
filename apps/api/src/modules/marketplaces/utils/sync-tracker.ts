/**
 * Sync Tracker
 *
 * Track synchronization status for marketplace listings.
 * Provides delta listing support (new vs changed items),
 * change detection, and sync history recording.
 *
 * Works with the MarketplaceListing Prisma model.
 */

import { createLogger } from '../../../lib/logger';
import { prisma as defaultPrisma } from '../../../lib/prisma';
import type {
  MarketplaceListing,
  MarketplaceSyncStatus,
  MarketplaceSyncHistoryStatus,
} from '../db';
import type { QualificationConfig } from '../adapters/types';

const logger = createLogger('sync-tracker');

// Use 'any' for Prisma client to support both PostgreSQL and MySQL clients
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClientType = any;

/**
 * Sync status values (matches Prisma enum).
 */
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

/**
 * Options for querying items to sync.
 */
export interface SyncQueryOptions {
  /** Maximum number of items to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by priority (descending) */
  orderByPriority?: boolean;
  /** Order by last sync time (ascending - oldest first) */
  orderByLastSync?: boolean;
  /** Maximum retry count to include */
  maxRetries?: number;
  /** Type of sync: inventory, price, or product */
  syncType?: 'inventory' | 'price' | 'product';
}

/**
 * Result of a sync operation for a single item.
 */
export interface SyncItemResult {
  /** Listing ID */
  id: string;
  /** UKSS SKU */
  ukssSku: string;
  /** Whether sync was successful */
  success: boolean;
  /** Whether this was a new listing (first time synced) */
  isNewListing?: boolean;
  /** External SKU ID returned by marketplace */
  externalSkuId?: string;
  /** External product ID returned by marketplace */
  externalProductId?: string;
  /** Error message if failed */
  error?: string;
  /** Synced quantity (for tracking) */
  syncedQuantity?: number;
  /** Synced price (for tracking) */
  syncedPrice?: number;
}

/**
 * Summary of processed sync results.
 */
export interface SyncResultSummary {
  /** Total items processed */
  total: number;
  /** New items listed (first sync) */
  newItemsListed: number;
  /** Existing items updated */
  itemsUpdated: number;
  /** Items that failed */
  itemsFailed: number;
}

/**
 * Sync history record for recording job execution.
 */
export interface SyncHistoryRecord {
  /** Operation name */
  operation: string;
  /** Correlation ID for log tracing */
  correlationId?: string;
  /** Job start time */
  startedAt: Date;
  /** Job end time */
  completedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Total items attempted */
  totalItems: number;
  /** New items listed */
  newItemsListed: number;
  /** Items updated */
  itemsUpdated: number;
  /** Items failed */
  itemsFailed: number;
  /** Error summary */
  errorSummary?: string;
  /** Detailed errors (first N) */
  errorDetails?: Array<{ sku: string; error: string }>;
  /** Who triggered the job */
  triggeredBy?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Sync tracker configuration.
 */
export interface SyncTrackerConfig {
  /** Prisma client instance (optional, uses default if not provided) */
  prisma?: PrismaClientType;
  /** Marketplace store ID */
  storeId: number;
  /** Marketplace name for logging */
  marketplaceName: string;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
}

/**
 * Marketplace listing with computed fields for sync operations.
 */
export type ListingForSync = Pick<
  MarketplaceListing,
  | 'id'
  | 'ukssSku'
  | 'ukssProductId'
  | 'ukssQuantity'
  | 'ukssPrice'
  | 'externalSkuId'
  | 'externalProductId'
  | 'listedAt'
  | 'lastSyncedQuantity'
  | 'lastSyncedPrice'
  | 'retryCount'
  | 'priority'
  | 'syncAllowed'
>;

/**
 * Sync tracker for marketplace listings.
 * Provides delta listing, change detection, and status tracking.
 */
export class MarketplaceSyncTracker {
  private readonly prisma: PrismaClientType;
  private readonly storeId: number;
  private readonly marketplaceName: string;
  private readonly maxRetries: number;

  constructor(config: SyncTrackerConfig) {
    this.prisma = config.prisma ?? defaultPrisma;
    this.storeId = config.storeId;
    this.marketplaceName = config.marketplaceName;
    this.maxRetries = config.maxRetries ?? 3;
  }

  // ============================================
  // Delta Listing Methods
  // ============================================

  /**
   * Get items never synced to marketplace (new listings).
   * These are items where listedAt IS NULL.
   */
  async getNewItems(options: SyncQueryOptions = {}): Promise<ListingForSync[]> {
    const { limit = 1000, offset = 0 } = options;

    const items = await this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: true,
        listedAt: null, // Never synced
        ukssQuantity: { gt: 0 }, // Only items with stock
      },
      select: this.getSelectFields(),
      orderBy: this.getOrderBy(options),
      take: limit,
      skip: offset,
    });

    logger.debug(
      { storeId: this.storeId, count: items.length, marketplace: this.marketplaceName },
      'Fetched new items for listing'
    );

    return items;
  }

  /**
   * Get items that have been synced but have changes.
   * Compares ukssQuantity vs lastSyncedQuantity and/or ukssPrice vs lastSyncedPrice.
   */
  async getChangedItems(options: SyncQueryOptions = {}): Promise<ListingForSync[]> {
    const { limit = 1000, offset = 0, syncType } = options;

    // Build where clause based on sync type
    const changeConditions: Record<string, unknown>[] = [];

    if (!syncType || syncType === 'inventory') {
      changeConditions.push({
        OR: [
          { lastSyncedQuantity: null },
          { NOT: { ukssQuantity: { equals: this.prisma.marketplaceListing.fields.lastSyncedQuantity } } },
        ],
      });
    }

    if (!syncType || syncType === 'price') {
      changeConditions.push({
        OR: [
          { lastSyncedPrice: null },
          { NOT: { ukssPrice: { equals: this.prisma.marketplaceListing.fields.lastSyncedPrice } } },
        ],
      });
    }

    const items = await this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: true,
        syncAllowed: true, // Only sync items where sync is allowed (e.g. offer created on marketplace)
        listedAt: { not: null }, // Already synced before
        externalSkuId: { not: null }, // Has external ID
        OR: changeConditions.length > 0 ? changeConditions : undefined,
      },
      select: this.getSelectFields(),
      orderBy: this.getOrderBy(options),
      take: limit,
      skip: offset,
    });

    logger.debug(
      { storeId: this.storeId, count: items.length, syncType, marketplace: this.marketplaceName },
      'Fetched changed items for sync'
    );

    return items;
  }

  /**
   * Get all items for a full sync (feed generation).
   * Returns all active items regardless of sync status.
   */
  async getItemsForFullSync(options: SyncQueryOptions = {}): Promise<ListingForSync[]> {
    const { limit = 10000, offset = 0 } = options;

    const items = await this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: true,
        syncAllowed: true, // Only sync items where sync is allowed
      },
      select: this.getSelectFields(),
      orderBy: this.getOrderBy(options),
      take: limit,
      skip: offset,
    });

    logger.debug(
      { storeId: this.storeId, count: items.length, marketplace: this.marketplaceName },
      'Fetched items for full sync'
    );

    return items;
  }

  /**
   * Get items that need syncing (new + changed + retryable).
   * Convenience method combining multiple queries.
   */
  async getItemsToSync(options: SyncQueryOptions = {}): Promise<ListingForSync[]> {
    const { limit = 1000, offset = 0, maxRetries = this.maxRetries } = options;

    const items = await this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: true,
        OR: [
          // New items (never synced) — don't filter by syncAllowed, they need creation regardless
          { listedAt: null, ukssQuantity: { gt: 0 } },
          // Changed items (quantity or price changed) — only if sync is allowed
          {
            syncAllowed: true,
            listedAt: { not: null },
            externalSkuId: { not: null },
            OR: [
              { lastSyncedQuantity: null },
              { lastSyncedPrice: null },
              // Note: Prisma doesn't support field comparison directly,
              // we'll filter in application code or use raw query
            ],
          },
          // Failed items eligible for retry — only if sync is allowed
          {
            syncAllowed: true,
            lastSyncStatus: 'FAILED',
            retryCount: { lt: maxRetries },
          },
          // Pending items — only if sync is allowed
          { syncAllowed: true, lastSyncStatus: 'PENDING' },
        ],
      },
      select: this.getSelectFields(),
      orderBy: this.getOrderBy(options),
      take: limit,
      skip: offset,
    });

    // Filter changed items in application code (Prisma limitation)
    const filteredItems = items.filter((item) => {
      // New item
      if (!item.listedAt) return true;
      // Quantity changed
      if (item.lastSyncedQuantity !== item.ukssQuantity) return true;
      // Price changed
      if (item.lastSyncedPrice?.toString() !== item.ukssPrice.toString()) return true;
      // Failed and retryable
      return true;
    });

    logger.debug(
      { storeId: this.storeId, count: filteredItems.length, marketplace: this.marketplaceName },
      'Fetched items to sync'
    );

    return filteredItems.slice(0, limit);
  }

  // ============================================
  // Status Update Methods
  // ============================================

  /**
   * Mark items as syncing (sync in progress).
   */
  async markSyncing(ids: string[]): Promise<void> {
    await this.prisma.marketplaceListing.updateMany({
      where: {
        id: { in: ids },
        storeId: this.storeId,
      },
      data: {
        lastSyncStatus: 'SYNCING',
        lastSyncedAt: new Date(),
      },
    });

    logger.debug(
      { storeId: this.storeId, count: ids.length, marketplace: this.marketplaceName },
      'Marked items as syncing'
    );
  }

  /**
   * Process sync results and update database.
   * Sets listedAt on first successful sync.
   */
  async processResults(results: SyncItemResult[]): Promise<SyncResultSummary> {
    let newItemsListed = 0;
    let itemsUpdated = 0;
    let itemsFailed = 0;

    for (const result of results) {
      if (result.success) {
        const updateData: Record<string, unknown> = {
          lastSyncStatus: 'SYNCED' as MarketplaceSyncStatus,
          lastSyncedAt: new Date(),
          retryCount: 0,
          lastSyncError: null,
        };

        // Set listedAt on first successful sync
        if (result.isNewListing) {
          updateData.listedAt = new Date();
          newItemsListed++;
        } else {
          itemsUpdated++;
        }

        // Update external IDs if provided
        if (result.externalSkuId) {
          updateData.externalSkuId = result.externalSkuId;
        }
        if (result.externalProductId) {
          updateData.externalProductId = result.externalProductId;
        }

        // Update last synced values
        if (result.syncedQuantity !== undefined) {
          updateData.lastSyncedQuantity = result.syncedQuantity;
        }
        if (result.syncedPrice !== undefined) {
          updateData.lastSyncedPrice = result.syncedPrice;
        }

        await this.prisma.marketplaceListing.update({
          where: { id: result.id },
          data: updateData,
        });
      } else {
        itemsFailed++;

        // Get current retry count
        const listing = await this.prisma.marketplaceListing.findUnique({
          where: { id: result.id },
          select: { retryCount: true },
        });

        const newRetryCount = (listing?.retryCount ?? 0) + 1;
        const newStatus: MarketplaceSyncStatus =
          newRetryCount >= this.maxRetries ? 'FAILED' : 'PENDING';

        await this.prisma.marketplaceListing.update({
          where: { id: result.id },
          data: {
            lastSyncStatus: newStatus,
            lastSyncedAt: new Date(),
            retryCount: newRetryCount,
            lastSyncError: result.error?.substring(0, 500) ?? 'Unknown error',
          },
        });
      }
    }

    const summary: SyncResultSummary = {
      total: results.length,
      newItemsListed,
      itemsUpdated,
      itemsFailed,
    };

    logger.info(
      { ...summary, storeId: this.storeId, marketplace: this.marketplaceName },
      'Processed sync results'
    );

    return summary;
  }

  /**
   * Reset failed items for retry.
   */
  async resetForRetry(ids?: string[]): Promise<number> {
    const result = await this.prisma.marketplaceListing.updateMany({
      where: {
        storeId: this.storeId,
        lastSyncStatus: 'FAILED',
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: {
        lastSyncStatus: 'PENDING',
        retryCount: 0,
        lastSyncError: null,
      },
    });

    logger.info(
      { storeId: this.storeId, count: result.count, marketplace: this.marketplaceName },
      'Reset items for retry'
    );

    return result.count;
  }

  // ============================================
  // Delist Methods
  // ============================================

  /**
   * Mark items for delisting (set quantity to 0 on marketplace).
   */
  async delistItems(ukssSkus: string[]): Promise<number> {
    const result = await this.prisma.marketplaceListing.updateMany({
      where: {
        storeId: this.storeId,
        ukssSku: { in: ukssSkus },
      },
      data: {
        isActive: false,
        ukssQuantity: 0,
        delistedAt: new Date(),
        lastSyncStatus: 'PENDING', // Needs to sync qty=0
      },
    });

    logger.info(
      { storeId: this.storeId, count: result.count, marketplace: this.marketplaceName },
      'Marked items for delisting'
    );

    return result.count;
  }

  /**
   * Get items pending delist sync (inactive with qty=0 that need syncing).
   */
  async getItemsPendingDelistSync(limit: number = 1000): Promise<ListingForSync[]> {
    return this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: false,
        ukssQuantity: 0,
        externalSkuId: { not: null },
        OR: [
          { lastSyncedQuantity: { not: 0 } },
          { lastSyncedQuantity: null },
        ],
      },
      select: this.getSelectFields(),
      take: limit,
    });
  }

  /**
   * Relist items (reactivate for syncing).
   */
  async relistItems(ukssSkus: string[]): Promise<number> {
    const result = await this.prisma.marketplaceListing.updateMany({
      where: {
        storeId: this.storeId,
        ukssSku: { in: ukssSkus },
      },
      data: {
        isActive: true,
        delistedAt: null,
        lastSyncStatus: 'PENDING',
      },
    });

    logger.info(
      { storeId: this.storeId, count: result.count, marketplace: this.marketplaceName },
      'Relisted items'
    );

    return result.count;
  }

  // ============================================
  // Sync History Methods
  // ============================================

  /**
   * Record a sync job execution in history.
   */
  async recordHistory(record: SyncHistoryRecord): Promise<string> {
    const status = record.itemsFailed > 0
      ? (record.itemsFailed === record.totalItems ? 'FAILED' : 'COMPLETED_WITH_ERRORS')
      : 'COMPLETED';

    const history = await this.prisma.marketplaceSyncHistory.create({
      data: {
        storeId: this.storeId,
        marketplaceName: this.marketplaceName,
        operation: record.operation,
        correlationId: record.correlationId,
        startedAt: record.startedAt,
        completedAt: record.completedAt ?? new Date(),
        durationMs: record.durationMs,
        status,
        totalItems: record.totalItems,
        newItemsListed: record.newItemsListed,
        itemsUpdated: record.itemsUpdated,
        itemsFailed: record.itemsFailed,
        errorSummary: record.errorSummary,
        errorDetails: record.errorDetails as unknown as Record<string, unknown>,
        triggeredBy: record.triggeredBy,
        metadata: record.metadata as Record<string, unknown>,
      },
    });

    logger.info(
      {
        historyId: history.id,
        operation: record.operation,
        status,
        storeId: this.storeId,
        marketplace: this.marketplaceName,
      },
      'Recorded sync history'
    );

    return history.id;
  }

  /**
   * Get summary counts for the marketplace.
   */
  async getCounts(): Promise<{
    total: number;
    active: number;
    newItems: number;
    synced: number;
    failed: number;
    notCreatedOnMarketplace: number;
    syncNotAllowed: number;
  }> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      total: bigint;
      active: bigint;
      newItems: bigint;
      synced: bigint;
      failed: bigint;
      notCreatedOnMarketplace: bigint;
      syncNotAllowed: bigint;
    }>>(`
      SELECT
        COUNT(*) as total,
        SUM(isActive = 1) as active,
        SUM(isActive = 1 AND listedAt IS NULL) as newItems,
        SUM(lastSyncStatus = 'SYNCED') as synced,
        SUM(lastSyncStatus = 'FAILED') as failed,
        SUM(isActive = 1 AND externalSkuId IS NULL) as notCreatedOnMarketplace,
        SUM(isActive = 1 AND syncAllowed = 0) as syncNotAllowed
      FROM jsa_marketplacelisting
      WHERE storeId = ?
    `, this.storeId);

    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      newItems: Number(row?.newItems ?? 0),
      synced: Number(row?.synced ?? 0),
      failed: Number(row?.failed ?? 0),
      notCreatedOnMarketplace: Number(row?.notCreatedOnMarketplace ?? 0),
      syncNotAllowed: Number(row?.syncNotAllowed ?? 0),
    };
  }

  // ============================================
  // Offer / Sync Allowed Methods
  // ============================================

  /**
   * Get listings eligible for offer creation.
   * Returns listings where externalProductId IS NOT NULL AND syncAllowed = false.
   * Used by API-based marketplaces (e.g., Debenhams/Mirakl) that require
   * offer creation before inventory sync.
   */
  async getListingsForOfferCreation(options: {
    limit?: number;
  } = {}): Promise<ListingForSync[]> {
    const { limit = 1000 } = options;

    const items = await this.prisma.marketplaceListing.findMany({
      where: {
        storeId: this.storeId,
        isActive: true,
        syncAllowed: false,
        externalProductId: { not: null },
      },
      select: this.getSelectFields(),
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName, count: items.length },
      'Found listings eligible for offer creation'
    );

    return items;
  }

  /**
   * Enable sync for a list of SKUs by flipping syncAllowed to true.
   * Called after successful offer creation on the marketplace.
   */
  async enableSyncForSkus(skus: string[]): Promise<number> {
    if (skus.length === 0) return 0;

    const result = await this.prisma.marketplaceListing.updateMany({
      where: {
        storeId: this.storeId,
        ukssSku: { in: skus },
      },
      data: {
        syncAllowed: true,
      },
    });

    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName, count: result.count },
      'Enabled sync for SKUs after offer creation'
    );

    return result.count;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getSelectFields() {
    return {
      id: true,
      ukssSku: true,
      ukssProductId: true,
      ukssQuantity: true,
      ukssPrice: true,
      externalSkuId: true,
      externalProductId: true,
      listedAt: true,
      lastSyncedQuantity: true,
      lastSyncedPrice: true,
      retryCount: true,
      priority: true,
      syncAllowed: true,
    } as const;
  }

  private getOrderBy(options: SyncQueryOptions) {
    const orderBy: Array<Record<string, 'asc' | 'desc'>> = [];

    if (options.orderByPriority) {
      orderBy.push({ priority: 'desc' });
    }
    if (options.orderByLastSync) {
      orderBy.push({ lastSyncedAt: 'asc' });
    }

    // Default: order by creation time
    if (orderBy.length === 0) {
      orderBy.push({ createdAt: 'asc' });
    }

    return orderBy;
  }

  /**
   * Get store ID.
   */
  getStoreId(): number {
    return this.storeId;
  }

  /**
   * Get marketplace name.
   */
  getMarketplaceName(): string {
    return this.marketplaceName;
  }

  // ============================================
  // UKSS Population Methods
  // ============================================

  /**
   * Result of a population operation.
   */


  /**
   * Initialize listings from UKSS source data.
   * This is a one-time setup that populates the marketplace listings table
   * with products enabled for this store.
   *
   * Source tables:
   * - new_products_variations (npv) - SKU-level inventory and prices
   * - new_products (np) - Product master data
   * - product_to_stores (pts) - Which products are enabled for which store
   *
   * @param options.limit - Maximum records to process (0 = all)
   * @param options.dryRun - If true, don't make changes, just return counts
   */
  async initializeFromUkss(options: {
    limit?: number;
    dryRun?: boolean;
    qualificationConfig?: QualificationConfig;
    syncAllowed?: boolean;
  } = {}): Promise<{
    total: number;
    inserted: number;
    updated: number;
    errors: number;
  }> {
    const { limit = 0, dryRun = false, qualificationConfig, syncAllowed = true } = options;

    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName, limit, dryRun },
      'Starting UKSS population'
    );

    if (qualificationConfig?.description) {
      logger.info({ rules: qualificationConfig.description }, 'Applying marketplace qualification rules');
    }

    // Query products from UKSS source tables
    // TODO: Re-enable product_to_stores filtering once store is configured
    // NOTE: product_to_stores filtering temporarily disabled for testing
    const qualificationJoins = qualificationConfig?.additionalJoins?.join(' ') ?? '';
    const qualificationClauses = qualificationConfig?.additionalWhereClauses?.join(' ') ?? '';

    const baseQuery = `
      SELECT
        npv.npv_products_sku as sku,
        npv.npv_products_id as productId,
        npv.npv_quantities as quantity,
        COALESCE(np.specials_price, np.products_price) as price
      FROM new_products_variations npv
      INNER JOIN new_products np ON np.products_id = npv.npv_products_id
      ${qualificationJoins}
      WHERE np.products_status = '1'
        AND np.delete_product_from_front_end = 0
        AND np.products_image IS NOT NULL
        AND np.products_image != ''
        AND np.out_of_stock = 'no'
        AND npv.npv_products_sku IS NOT NULL
        AND npv.npv_products_sku != ''
        AND npv.npv_quantities > 0
        ${qualificationClauses}
    `;

    const products = limit > 0
      ? await this.prisma.$queryRawUnsafe<Array<{
          sku: string;
          productId: number;
          quantity: number;
          price: number;
        }>>(baseQuery + ' LIMIT ?', limit)
      : await this.prisma.$queryRawUnsafe<Array<{
          sku: string;
          productId: number;
          quantity: number;
          price: number;
        }>>(baseQuery);

    logger.info(
      { storeId: this.storeId, productCount: products.length },
      'Queried products from UKSS'
    );

    if (dryRun) {
      return {
        total: products.length,
        inserted: products.length,
        updated: 0,
        errors: 0,
      };
    }

    // Process in batches
    const batchSize = 500;
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);

      for (const p of batch) {
        const id = `${this.marketplaceName}-${this.storeId}-${p.sku}`;

        try {
          // Check if exists
          const existing = await this.prisma.marketplaceListing.findUnique({
            where: { id },
            select: { id: true },
          });

          await this.prisma.marketplaceListing.upsert({
            where: { id },
            create: {
              id,
              storeId: this.storeId,
              marketplaceName: this.marketplaceName,
              ukssSku: p.sku,
              ukssProductId: p.productId,
              ukssQuantity: p.quantity,
              ukssPrice: p.price,
              isActive: true,
              syncAllowed,
            },
            update: {
              ukssQuantity: p.quantity,
              ukssPrice: p.price,
              isActive: true,
            },
          });

          if (existing) {
            updated++;
          } else {
            inserted++;
          }
        } catch (err) {
          errors++;
          const error = err as Error;
          logger.error(
            { sku: p.sku, error: error.message },
            'Failed to upsert listing'
          );
        }
      }

      logger.debug(
        { processed: Math.min(i + batchSize, products.length), total: products.length },
        'Batch processed'
      );
    }

    const result = { total: products.length, inserted, updated, errors };

    logger.info(
      { ...result, storeId: this.storeId, marketplace: this.marketplaceName },
      'UKSS population completed'
    );

    return result;
  }

  /**
   * Refresh ukss_quantity and ukss_price from UKSS source tables.
   * Updates existing listings with current inventory and pricing.
   */
  async refreshFromUkss(): Promise<{
    total: number;
    updated: number;
    errors: number;
  }> {
    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName },
      'Starting UKSS refresh'
    );

    // Update quantities and prices from source
    const result = await this.prisma.$executeRaw`
      UPDATE jsa_marketplacelisting ml
      INNER JOIN new_products_variations npv ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np ON np.products_id = npv.npv_products_id
      SET
        ml.ukssQuantity = npv.npv_quantities,
        ml.ukssPrice = COALESCE(np.specials_price, np.products_price),
        ml.updatedAt = NOW()
      WHERE ml.storeId = ${this.storeId}
        AND ml.marketplaceName = ${this.marketplaceName}
    `;

    const updated = Number(result);

    logger.info(
      { updated, storeId: this.storeId, marketplace: this.marketplaceName },
      'UKSS refresh completed'
    );

    return { total: updated, updated, errors: 0 };
  }

  /**
   * Add new products from UKSS that don't exist in listings yet.
   */
  async addNewFromUkss(options: {
    qualificationConfig?: QualificationConfig;
    syncAllowed?: boolean;
  } = {}): Promise<{
    total: number;
    inserted: number;
  }> {
    const { qualificationConfig, syncAllowed = true } = options;

    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName },
      'Adding new products from UKSS'
    );

    if (qualificationConfig?.description) {
      logger.info({ rules: qualificationConfig.description }, 'Applying marketplace qualification rules');
    }

    const qualificationJoins = qualificationConfig?.additionalJoins?.join(' ') ?? '';
    const qualificationClauses = qualificationConfig?.additionalWhereClauses?.join(' ') ?? '';

    // Find products in UKSS that don't exist in listings
    const newProducts = await this.prisma.$queryRawUnsafe<Array<{
      sku: string;
      productId: number;
      quantity: number;
      price: number;
    }>>(`
      SELECT
        npv.npv_products_sku as sku,
        npv.npv_products_id as productId,
        npv.npv_quantities as quantity,
        COALESCE(np.specials_price, np.products_price) as price
      FROM new_products_variations npv
      INNER JOIN new_products np ON np.products_id = npv.npv_products_id
      INNER JOIN product_to_stores pts ON np.products_id = pts.pts_product_id
      ${qualificationJoins}
      LEFT JOIN jsa_marketplacelisting ml
        ON ml.ukssSku = npv.npv_products_sku
        AND ml.storeId = ?
        AND ml.marketplaceName = ?
      WHERE pts.pts_store_id = ?
        AND pts.pts_status = 1
        AND np.products_status = '1'
        AND np.delete_product_from_front_end = 0
        AND npv.npv_products_sku IS NOT NULL
        AND npv.npv_products_sku != ''
        AND ml.id IS NULL
        ${qualificationClauses}
    `, this.storeId, this.marketplaceName, this.storeId);

    let inserted = 0;

    for (const p of newProducts) {
      const id = `${this.marketplaceName}-${this.storeId}-${p.sku}`;

      try {
        await this.prisma.marketplaceListing.create({
          data: {
            id,
            storeId: this.storeId,
            marketplaceName: this.marketplaceName,
            ukssSku: p.sku,
            ukssProductId: p.productId,
            ukssQuantity: p.quantity,
            ukssPrice: p.price,
            isActive: true,
            syncAllowed,
          },
        });
        inserted++;
      } catch {
        // Already exists (race condition) - skip
      }
    }

    logger.info(
      { total: newProducts.length, inserted, storeId: this.storeId, marketplace: this.marketplaceName },
      'New products added from UKSS'
    );

    return { total: newProducts.length, inserted };
  }

  /**
   * Deactivate listings for products removed from UKSS.
   */
  async deactivateRemovedFromUkss(): Promise<{
    total: number;
    deactivated: number;
  }> {
    logger.info(
      { storeId: this.storeId, marketplace: this.marketplaceName },
      'Deactivating removed products'
    );

    // Find listings that no longer have corresponding active UKSS products
    const result = await this.prisma.$executeRaw`
      UPDATE jsa_marketplacelisting ml
      LEFT JOIN new_products_variations npv ON npv.npv_products_sku = ml.ukssSku
      LEFT JOIN new_products np ON np.products_id = npv.npv_products_id
      LEFT JOIN product_to_stores pts
        ON np.products_id = pts.pts_product_id
        AND pts.pts_store_id = ${this.storeId}
        AND pts.pts_status = 1
      SET
        ml.isActive = 0,
        ml.delistedAt = NOW(),
        ml.ukssQuantity = 0,
        ml.updatedAt = NOW()
      WHERE ml.storeId = ${this.storeId}
        AND ml.marketplaceName = ${this.marketplaceName}
        AND ml.isActive = 1
        AND (
          npv.npv_products_sku IS NULL
          OR np.products_status != '1'
          OR np.delete_product_from_front_end = 1
          OR pts.pts_product_id IS NULL
        )
    `;

    const deactivated = Number(result);

    logger.info(
      { deactivated, storeId: this.storeId, marketplace: this.marketplaceName },
      'Deactivated removed products'
    );

    return { total: deactivated, deactivated };
  }
}

/**
 * Create a marketplace sync tracker.
 */
export function createMarketplaceSyncTracker(config: SyncTrackerConfig): MarketplaceSyncTracker {
  return new MarketplaceSyncTracker(config);
}

// ============================================
// Legacy exports for backwards compatibility
// ============================================

export type SyncFields = {
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  retryCount: number;
  lastSyncError: string | null;
};

export const defaultSyncFields: SyncFields = {
  lastSyncedAt: null,
  lastSyncStatus: null,
  retryCount: 0,
  lastSyncError: null,
};

/**
 * Build a where clause for finding items that need syncing.
 * @deprecated Use MarketplaceSyncTracker.getItemsToSync() instead
 */
export function buildSyncWhereClause(maxRetries: number = 3): Record<string, unknown> {
  return {
    OR: [
      { lastSyncStatus: null },
      { lastSyncStatus: 'PENDING' },
      {
        AND: [
          { lastSyncStatus: 'FAILED' },
          { retryCount: { lt: maxRetries } },
        ],
      },
    ],
  };
}
