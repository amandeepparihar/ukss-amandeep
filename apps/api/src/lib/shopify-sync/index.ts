/**
 * Shopify Sync Engine
 *
 * Main orchestrator for syncing products to Shopify stores
 */

import { prisma } from '../prisma';
import { createLogger } from '../logger';
import { decrypt } from '../encryption';
import { ShopifyClient } from './client';
import { CheckpointManager } from './checkpoint';
import { ProductAdapter } from './adapters/product.adapter';
import type { CheckpointState, ProductWithVariants, SyncJobData } from './types';

const logger = createLogger('shopify-sync');

const BATCH_SIZE = 500;

export interface SyncOptions {
  storeId: string;
  syncId?: string;
  isManual?: boolean;
}

export interface SyncSummary {
  syncId: string;
  status: 'COMPLETED' | 'FAILED';
  processed: number;
  created: number;
  updated: number;
  failed: number;
  duration: number;
  error?: string;
}

/**
 * Main sync orchestrator
 */
export class ShopifySyncEngine {
  private storeId: string;
  private syncId: string;
  private client!: ShopifyClient;
  private checkpoint!: CheckpointManager;
  private adapter: ProductAdapter;
  private locationId: string | null = null;

  constructor(options: SyncOptions) {
    this.storeId = options.storeId;
    this.syncId = options.syncId || '';
    this.adapter = new ProductAdapter();
  }

  /**
   * Run the sync process
   */
  async run(): Promise<SyncSummary> {
    const startTime = Date.now();
    let state: CheckpointState;

    try {
      // Initialize sync
      await this.initialize();

      // Load or create checkpoint
      state = await this.checkpoint.load() || CheckpointManager.createInitialState();

      // Update sync status to IN_PROGRESS
      await this.updateSyncStatus('IN_PROGRESS');

      // Get primary location for inventory updates
      this.locationId = await this.client.getPrimaryLocationId();
      if (!this.locationId) {
        logger.warn({ storeId: this.storeId }, 'No location found, inventory updates will be skipped');
      }

      // Count total products to sync
      const totalProducts = await this.countProductsToSync();
      await prisma.shopifySync.update({
        where: { id: this.syncId },
        data: { totalProducts },
      });

      // Process products in batches
      await this.processBatches(state);

      // Mark sync as completed
      await this.updateSyncStatus('COMPLETED', state);
      await this.checkpoint.clear();

      const duration = Date.now() - startTime;
      logger.info(
        { syncId: this.syncId, duration, ...state },
        'Sync completed successfully'
      );

      return {
        syncId: this.syncId,
        status: 'COMPLETED',
        processed: state.processed,
        created: state.created,
        updated: state.updated,
        failed: state.failed,
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, syncId: this.syncId }, 'Sync failed');

      await this.updateSyncStatus('FAILED', undefined, message);

      const duration = Date.now() - startTime;
      return {
        syncId: this.syncId,
        status: 'FAILED',
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        duration,
        error: message,
      };
    }
  }

  /**
   * Initialize the sync engine
   */
  private async initialize(): Promise<void> {
    // Load store configuration
    const store = await prisma.shopifyStore.findUnique({
      where: { id: this.storeId },
    });

    if (!store) {
      throw new Error(`Store not found: ${this.storeId}`);
    }

    if (!store.isActive) {
      throw new Error(`Store is not active: ${store.name}`);
    }

    // Decrypt access token
    const accessToken = decrypt(store.accessToken);

    // Create Shopify client
    this.client = new ShopifyClient(store.shopDomain, accessToken, store.apiVersion);

    // Test connection
    const connectionTest = await this.client.testConnection();
    if (!connectionTest.success) {
      throw new Error(`Connection failed: ${connectionTest.error}`);
    }

    // Create sync record if not provided
    if (!this.syncId) {
      const sync = await prisma.shopifySync.create({
        data: {
          storeId: this.storeId,
          status: 'PENDING',
        },
      });
      this.syncId = sync.id;
    }

    // Initialize checkpoint manager
    this.checkpoint = new CheckpointManager(this.syncId, BATCH_SIZE);

    logger.info(
      { syncId: this.syncId, storeId: this.storeId, shopName: connectionTest.shopName },
      'Sync initialized'
    );
  }

  /**
   * Count products that need syncing
   */
  private async countProductsToSync(): Promise<number> {
    return prisma.productSyncStatus.count({
      where: {
        storeId: this.storeId,
        needsSync: true,
      },
    });
  }

  /**
   * Process products in batches
   */
  private async processBatches(state: CheckpointState): Promise<void> {
    let hasMore = true;

    while (hasMore) {
      // Query batch of products
      const products = await this.getNextBatch(state.lastProductId);

      if (products.length === 0) {
        hasMore = false;
        continue;
      }

      // Process each product
      for (const product of products) {
        try {
          await this.syncProduct(product, state);
          state.lastProductId = product.id;
          state.processed++;

          // Save checkpoint periodically
          if (this.checkpoint.shouldSaveCheckpoint(state.processed)) {
            state.batchNumber++;
            await this.checkpoint.save(state);
          }
        } catch (error) {
          logger.error({ error, productId: product.id }, 'Failed to sync product');
          state.failed++;

          // Record failure
          await this.recordItemFailure(product.id, error);
        }
      }

      // Check if we got a full batch (more to process)
      hasMore = products.length === BATCH_SIZE;
    }

    // Final checkpoint save
    await this.checkpoint.save(state);
  }

  /**
   * Get next batch of products to sync
   */
  private async getNextBatch(lastProductId: string | null): Promise<ProductWithVariants[]> {
    const syncStatuses = await prisma.productSyncStatus.findMany({
      where: {
        storeId: this.storeId,
        needsSync: true,
        ...(lastProductId ? { productId: { gt: lastProductId } } : {}),
      },
      orderBy: { productId: 'asc' },
      take: BATCH_SIZE,
      include: {
        product: {
          include: {
            variants: true,
          },
        },
      },
    });

    return syncStatuses.map(ss => ({
      ...ss.product,
      price: Number(ss.product.price),
      compareAtPrice: ss.product.compareAtPrice ? Number(ss.product.compareAtPrice) : null,
      variants: ss.product.variants.map(v => ({
        ...v,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
      })),
      syncStatus: {
        shopifyId: ss.shopifyId,
        needsSync: ss.needsSync,
      },
    }));
  }

  /**
   * Sync a single product to Shopify
   */
  private async syncProduct(product: ProductWithVariants, state: CheckpointState): Promise<void> {
    const existingShopifyId = product.syncStatus?.shopifyId;

    if (product.isDeleted && existingShopifyId) {
      // Unpublish deleted products
      const result = await this.client.unpublishProduct(existingShopifyId);
      if (result.success) {
        await this.markSynced(product.id, existingShopifyId);
        state.updated++;
      } else {
        throw new Error(result.error);
      }
      return;
    }

    if (existingShopifyId) {
      // Update existing product - just price and inventory for now
      await this.updateExistingProduct(product, existingShopifyId, state);
    } else {
      // Create new product
      await this.createNewProduct(product, state);
    }
  }

  /**
   * Create a new product in Shopify
   */
  private async createNewProduct(product: ProductWithVariants, state: CheckpointState): Promise<void> {
    const input = this.adapter.mapToShopify(product);
    const result = await this.client.createProduct(input);

    if (result.success && result.shopifyId) {
      await this.markSynced(product.id, result.shopifyId);
      state.created++;

      // TODO: Update variant Shopify IDs from response
      logger.debug({ productId: product.id, shopifyId: result.shopifyId }, 'Product created');
    } else {
      throw new Error(result.error || 'Failed to create product');
    }
  }

  /**
   * Update existing product in Shopify
   */
  private async updateExistingProduct(
    product: ProductWithVariants,
    shopifyId: string,
    state: CheckpointState
  ): Promise<void> {
    // Get current Shopify product to map variants
    const shopifyProduct = await this.client.getProduct(shopifyId);
    if (!shopifyProduct) {
      throw new Error('Product not found in Shopify');
    }

    // Update variant prices
    const priceUpdate = this.adapter.mapPriceUpdate(product);
    if (priceUpdate && priceUpdate.variants.length > 0) {
      for (const variant of priceUpdate.variants) {
        await this.client.updateVariantPrice(
          variant.variantId,
          variant.price,
          variant.compareAtPrice
        );
      }
    }

    // Update inventory if location is available
    if (this.locationId && product.variants) {
      const variantInventoryMap = new Map<string, string>();
      for (const sv of shopifyProduct.variants) {
        if (sv.inventoryItemId) {
          variantInventoryMap.set(sv.id, sv.inventoryItemId);
        }
      }

      const inventoryUpdates = this.adapter.mapInventoryUpdates(
        product,
        this.locationId,
        variantInventoryMap
      );

      for (const update of inventoryUpdates) {
        await this.client.updateInventory(
          update.inventoryItemId,
          update.locationId,
          update.quantity
        );
      }
    }

    await this.markSynced(product.id, shopifyId);
    state.updated++;
  }

  /**
   * Mark product as synced
   */
  private async markSynced(productId: string, shopifyId: string): Promise<void> {
    await prisma.productSyncStatus.update({
      where: {
        productId_storeId: {
          productId,
          storeId: this.storeId,
        },
      },
      data: {
        needsSync: false,
        shopifyId,
        lastSyncAt: new Date(),
      },
    });
  }

  /**
   * Record sync item failure
   */
  private async recordItemFailure(productId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';

    await prisma.shopifySyncItem.create({
      data: {
        syncId: this.syncId,
        productId,
        status: 'FAILED',
        errorMessage: message,
      },
    });
  }

  /**
   * Update sync status in database
   */
  private async updateSyncStatus(
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED',
    state?: CheckpointState,
    errorMessage?: string
  ): Promise<void> {
    const data: any = { status };

    if (status === 'IN_PROGRESS') {
      data.startedAt = new Date();
    } else if (status === 'COMPLETED' || status === 'FAILED') {
      data.completedAt = new Date();
    }

    if (state) {
      data.processed = state.processed;
      data.created = state.created;
      data.updated = state.updated;
      data.failed = state.failed;
    }

    if (errorMessage) {
      data.errorMessage = errorMessage;
    }

    await prisma.shopifySync.update({
      where: { id: this.syncId },
      data,
    });

    // Update store lastSyncAt
    if (status === 'COMPLETED') {
      await prisma.shopifyStore.update({
        where: { id: this.storeId },
        data: { lastSyncAt: new Date() },
      });
    }
  }
}

/**
 * Create and run a sync
 */
export async function runSync(options: SyncOptions): Promise<SyncSummary> {
  const engine = new ShopifySyncEngine(options);
  return engine.run();
}

// Re-export types and utilities
export * from './types';
export { ShopifyClient } from './client';
export { CheckpointManager } from './checkpoint';
export { ProductAdapter } from './adapters/product.adapter';
export { getRateLimiter, clearRateLimiter } from './rate-limiter';
