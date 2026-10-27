/**
 * Fruugo Inventory Sync
 *
 * Pushes inventory updates to Fruugo via their Stock Update API.
 * Supports delta sync (only changed items) and full sync.
 */

import { prisma } from '../../../../lib/prisma';
import { createLogger, type Logger } from '../../../../lib/logger';
import {
  HttpClient,
  BatchProcessor,
  xmlUtils,
  MarketplaceSyncTracker,
  type SyncItemResult,
} from '../../utils';
import type { FruugoConfig } from './fruugo.config';
import type {
  FruugoInventoryItem,
  FruugoInventorySyncResult,
  FruugoInventorySyncOptions,
} from './fruugo.types';

/**
 * Fruugo inventory sync service.
 * Handles pushing inventory updates to Fruugo API.
 */
export class FruugoInventorySync {
  private readonly config: FruugoConfig;
  private readonly httpClient: HttpClient;
  private readonly batchProcessor: BatchProcessor;
  private readonly syncTracker: MarketplaceSyncTracker;
  private readonly logger: Logger;

  constructor(
    config: FruugoConfig,
    httpClient: HttpClient,
    batchProcessor: BatchProcessor,
    logger?: Logger
  ) {
    this.config = config;
    this.httpClient = httpClient;
    this.batchProcessor = batchProcessor;
    this.logger = logger ?? createLogger('fruugo-inventory-sync');
    this.syncTracker = new MarketplaceSyncTracker({
      storeId: config.storeId,
      marketplaceName: 'fruugo',
    });
  }

  /**
   * Sync inventory to Fruugo.
   */
  async sync(options?: FruugoInventorySyncOptions): Promise<FruugoInventorySyncResult> {
    const startTime = Date.now();
    const errors: Array<{ sku: string; error: string }> = [];

    this.logger.info(
      { full: options?.full, dryRun: options?.dryRun },
      'Starting Fruugo inventory sync'
    );

    try {
      // 1. Get items to sync
      const items = options?.full
        ? await this.getAllListedItems()
        : await this.getChangedItems();

      if (items.length === 0) {
        this.logger.info('No items to sync');
        return {
          success: true,
          itemsProcessed: 0,
          itemsFailed: 0,
          duration: Date.now() - startTime,
        };
      }

      this.logger.info({ itemCount: items.length }, 'Items found for sync');

      if (options?.dryRun) {
        this.logger.info('Dry run - skipping actual sync');
        return {
          success: true,
          itemsProcessed: items.length,
          itemsFailed: 0,
          duration: Date.now() - startTime,
        };
      }

      // 2. Process in batches
      const batchSize = options?.batchSize || this.config.inventoryBatchSize;
      let processed = 0;
      let failed = 0;

      const batches = this.chunk(items, batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        try {
          await this.syncBatch(batch);
          processed += batch.length;

          // Update sync status for successful items
          await this.updateSyncStatus(batch, true);

          this.logger.debug(
            { batchIndex: i + 1, totalBatches: batches.length, batchSize: batch.length },
            'Batch synced successfully'
          );
        } catch (error) {
          const err = error as Error;
          failed += batch.length;

          // Record errors
          batch.forEach((item) => {
            errors.push({ sku: item.ukssSku, error: err.message });
          });

          // Update sync status for failed items
          await this.updateSyncStatus(batch, false, err.message);

          this.logger.error(
            { batchIndex: i + 1, error: err.message },
            'Batch sync failed'
          );
        }
      }

      const duration = Date.now() - startTime;

      // 3. Record sync history
      await this.syncTracker.recordHistory({
        operation: 'inventory-sync',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: duration,
        totalItems: items.length,
        newItemsListed: 0,
        itemsUpdated: processed,
        itemsFailed: failed,
        errorSummary: failed > 0 ? `${failed} items failed` : undefined,
        errorDetails: errors.slice(0, 10), // First 10 errors
        triggeredBy: 'cli',
      });

      this.logger.info(
        { processed, failed, duration },
        'Fruugo inventory sync completed'
      );

      return {
        success: failed === 0,
        itemsProcessed: processed,
        itemsFailed: failed,
        duration,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'Inventory sync failed');

      return {
        success: false,
        itemsProcessed: 0,
        itemsFailed: 0,
        duration: Date.now() - startTime,
        errors: [{ sku: 'all', error: err.message }],
      };
    }
  }

  /**
   * Sync a batch of items to Fruugo API.
   */
  private async syncBatch(items: FruugoInventoryItem[]): Promise<void> {
    const xml = this.buildInventoryXml(items);

    const response = await this.httpClient.post<string>(
      this.config.inventoryUpdateUrl,
      xml,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Fruugo API returned status ${response.status}`);
    }
  }

  /**
   * Build XML payload for inventory update.
   */
  buildInventoryXml(items: FruugoInventoryItem[]): string {
    const skus = items.map((item) => ({
      '@fruugoSkuId': item.fruugoSkuId,
      availability: item.quantity > 0 ? 'INSTOCK' : 'OUTOFSTOCK',
      itemsInStock: item.quantity,
    }));

    return xmlUtils.build(
      { skus: { sku: skus } },
      {
        declaration: { encoding: 'UTF-8' },
      }
    );
  }

  /**
   * Get items that have changed since last sync.
   */
  private async getChangedItems(): Promise<FruugoInventoryItem[]> {
    // Query items where fruugo_sku_id is set and quantity has changed
    const items = await prisma.$queryRaw<
      Array<{
        id: string;
        ukssSku: string;
        fruugoSkuId: string;
        quantity: number;
        lastSyncedQuantity: number | null;
      }>
    >`
      SELECT
        ml.id,
        ml.ukssSku,
        npv.fruugo_sku_id as fruugoSkuId,
        npv.fruugo_quantity as quantity,
        ml.lastSyncedQuantity
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON ml.ukssSku = npv.npv_products_sku
      WHERE ml.storeId = ${this.config.storeId}
        AND ml.marketplaceName = 'fruugo'
        AND ml.isActive = true
        AND npv.fruugo_sku_id IS NOT NULL
        AND npv.fruugo_sku_id != ''
        AND (
          ml.lastSyncedQuantity IS NULL
          OR ml.lastSyncedQuantity != npv.fruugo_quantity
        )
      LIMIT 10000
    `;

    return items.map((row) => ({
      id: row.id,
      ukssSku: row.ukssSku,
      fruugoSkuId: row.fruugoSkuId,
      quantity: row.quantity,
      lastSyncedQuantity: row.lastSyncedQuantity,
    }));
  }

  /**
   * Get all listed items (for full sync).
   * Uses jsa_MarketplaceListing as the source of truth.
   */
  private async getAllListedItems(): Promise<FruugoInventoryItem[]> {
    const items = await prisma.$queryRaw<
      Array<{
        id: string;
        ukssSku: string;
        fruugoSkuId: string;
        quantity: number;
        lastSyncedQuantity: number | null;
      }>
    >`
      SELECT
        ml.id,
        ml.ukssSku,
        npv.fruugo_sku_id as fruugoSkuId,
        ml.ukssQuantity as quantity,
        ml.lastSyncedQuantity
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON ml.ukssSku = npv.npv_products_sku
      WHERE ml.storeId = ${this.config.storeId}
        AND ml.marketplaceName = 'fruugo'
        AND ml.isActive = true
        AND npv.fruugo_sku_id IS NOT NULL
        AND npv.fruugo_sku_id != ''
      LIMIT 50000
    `;

    return items.map((row) => ({
      id: row.id,
      ukssSku: row.ukssSku,
      fruugoSkuId: row.fruugoSkuId,
      quantity: row.quantity,
      lastSyncedQuantity: row.lastSyncedQuantity,
    }));
  }

  /**
   * Update sync status in MarketplaceListing table.
   */
  private async updateSyncStatus(
    items: FruugoInventoryItem[],
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    const now = new Date();

    if (success) {
      // Update successful items
      for (const item of items) {
        await prisma.$executeRaw`
          UPDATE jsa_MarketplaceListing
          SET
            lastSyncStatus = 'SYNCED',
            lastSyncedAt = ${now},
            lastSyncedQuantity = ${item.quantity},
            retryCount = 0,
            lastSyncError = NULL,
            updatedAt = ${now}
          WHERE id = ${item.id}
        `;
      }
    } else {
      // Update failed items
      for (const item of items) {
        await prisma.$executeRaw`
          UPDATE jsa_MarketplaceListing
          SET
            lastSyncStatus = 'FAILED',
            lastSyncedAt = ${now},
            retryCount = retryCount + 1,
            lastSyncError = ${errorMessage?.substring(0, 500) || 'Unknown error'},
            updatedAt = ${now}
          WHERE id = ${item.id}
        `;
      }
    }
  }

  /**
   * Split array into chunks.
   */
  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Create Fruugo inventory sync instance.
 */
export function createFruugoInventorySync(
  config: FruugoConfig,
  httpClient: HttpClient,
  batchProcessor: BatchProcessor,
  logger?: Logger
): FruugoInventorySync {
  return new FruugoInventorySync(config, httpClient, batchProcessor, logger);
}
