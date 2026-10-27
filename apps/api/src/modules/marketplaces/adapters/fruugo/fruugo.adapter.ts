/**
 * Fruugo Marketplace Adapter
 *
 * Main adapter class for Fruugo marketplace integration.
 * Handles product feeds, inventory sync, and SKU ID synchronization.
 */

import { createLogger, type Logger } from '../../../../lib/logger';
import {
  BaseMarketplaceAdapter,
  createCapabilities,
  HttpClient,
  BatchProcessor,
  BasicAuthProvider,
  type MarketplaceCapabilities,
  type ValidationResult,
  type SyncResult,
  type FeedResult,
  type MarketplaceAdapterConfig,
} from '../../index';
import { FruugoFeedGenerator } from './feed-generator';
import { FruugoInventorySync } from './inventory-sync';
import { FruugoSkuSync } from './sku-sync';
import type { FruugoConfig } from './fruugo.config';
import type {
  FruugoFeedResult,
  FruugoInventorySyncResult,
  FruugoSkuSyncResult,
  FruugoFeedOptions,
  FruugoInventorySyncOptions,
  FruugoSkuSyncOptions,
} from './fruugo.types';

/**
 * Fruugo adapter configuration.
 */
export interface FruugoAdapterConfig extends MarketplaceAdapterConfig {
  /** Fruugo-specific configuration */
  fruugo: FruugoConfig;
}

/**
 * Fruugo marketplace adapter.
 * Implements feed-based product listing and API-based inventory sync.
 */
export class FruugoAdapter extends BaseMarketplaceAdapter {
  readonly marketplaceId = 'fruugo';
  readonly name = 'Fruugo';
  readonly pattern = 'feed' as const;
  readonly productCreationMethod = 'Feed: CSV product datafeed served via HTTP. Fruugo pulls it periodically. Inventory synced via API push (XML).';

  private readonly fruugoConfig: FruugoConfig;
  private readonly fruugoHttpClient: HttpClient;
  private readonly feedGenerator: FruugoFeedGenerator;
  private readonly inventorySync: FruugoInventorySync;
  private readonly skuSync: FruugoSkuSync;

  constructor(adapterConfig: FruugoAdapterConfig) {
    super(adapterConfig);

    this.fruugoConfig = adapterConfig.fruugo;

    // Create HTTP client with Basic Auth for Fruugo API
    this.fruugoHttpClient = new HttpClient({
      baseUrl: '', // URLs are absolute in Fruugo config
      auth: {
        type: 'basic',
        username: this.fruugoConfig.apiId,
        password: this.fruugoConfig.apiPassword,
      },
      timeout: this.fruugoConfig.apiTimeoutMs,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: true,
      },
    });

    // Initialize sub-components
    this.feedGenerator = new FruugoFeedGenerator(this.fruugoConfig, this.logger);
    this.inventorySync = new FruugoInventorySync(
      this.fruugoConfig,
      this.fruugoHttpClient,
      this.batchProcessor,
      this.logger
    );
    this.skuSync = new FruugoSkuSync(
      this.fruugoConfig,
      this.fruugoHttpClient,
      this.logger
    );
  }

  /**
   * Get Fruugo marketplace capabilities.
   */
  getCapabilities(): MarketplaceCapabilities {
    return createCapabilities({
      productFeed: true,
      inventorySync: true,
      priceSync: false, // Price is included in product feed
      skuMapping: true,
      orderImport: false, // Handled by separate order integration
      orderStatusUpdate: false,
      feedFormat: 'csv',
      feedDelivery: 'ftp-pull',
    });
  }

  getQualificationConfig(): QualificationConfig {
    return this.buildQualificationConfig({
      excludedManufacturerIds: this.fruugoConfig.excludedManufacturerIds,
      excludedProductTypeIds: this.fruugoConfig.excludedProductTypeIds,
    });
  }

  /**
   * Validate Fruugo API credentials.
   * Tests connection by fetching page 1 of listings.
   */
  async validateCredentials(): Promise<ValidationResult> {
    try {
      this.logger.info('Validating Fruugo credentials');

      // Try to fetch first page of listings
      const url = `${this.fruugoConfig.listingsApiUrl}1`;
      const response = await this.fruugoHttpClient.get<string>(url);

      if (response.status === 200) {
        this.logger.info('Fruugo credentials validated successfully');
        return {
          valid: true,
          message: 'Credentials are valid',
        };
      } else if (response.status === 401) {
        return {
          valid: false,
          message: 'Invalid credentials - authentication failed',
          error: 'HTTP 401 Unauthorized',
        };
      } else {
        return {
          valid: false,
          message: `Unexpected response status: ${response.status}`,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Credential validation failed');

      return {
        valid: false,
        message: 'Failed to validate credentials',
        error: err.message,
      };
    }
  }

  /**
   * Generate Fruugo product feed.
   * Creates CSV file for FTP pickup by Fruugo.
   */
  async generateProductFeed(options?: FruugoFeedOptions): Promise<FruugoFeedResult> {
    return this.feedGenerator.generate(options);
  }

  /**
   * Sync inventory to Fruugo.
   * Pushes inventory updates via Fruugo Stock Update API.
   */
  async syncInventory(options?: FruugoInventorySyncOptions): Promise<FruugoInventorySyncResult> {
    return this.inventorySync.sync(options);
  }

  /**
   * Fetch and sync SKU mappings from Fruugo.
   * Gets Fruugo SKU IDs for merchant SKUs.
   */
  async fetchSkuMappings(options?: FruugoSkuSyncOptions): Promise<FruugoSkuSyncResult> {
    return this.skuSync.sync(options);
  }

  /**
   * Sync prices to Fruugo.
   * Not supported - prices are included in the product feed.
   */
  async syncPrices(): Promise<SyncResult> {
    return {
      success: false,
      itemsProcessed: 0,
      itemsFailed: 0,
      errors: [{ sku: 'all', error: 'Price sync not supported. Use generateProductFeed instead.' }],
    };
  }

  /**
   * Sync products to Fruugo.
   * Not supported directly - use generateProductFeed instead.
   */
  async syncProducts(): Promise<SyncResult> {
    return {
      success: false,
      itemsProcessed: 0,
      itemsFailed: 0,
      errors: [{ sku: 'all', error: 'Direct product sync not supported. Use generateProductFeed instead.' }],
    };
  }

  /**
   * Get the Fruugo-specific configuration.
   */
  getFruugoConfig(): FruugoConfig {
    return this.fruugoConfig;
  }

  /**
   * Populate marketplace listings from UKSS source data.
   * This initializes the jsa_marketplacelisting table with products
   * enabled for this marketplace.
   */
  async populateListings(options?: {
    limit?: number;
    dryRun?: boolean;
  }): Promise<{
    total: number;
    inserted: number;
    updated: number;
    errors: number;
  }> {
    this.logger.info({ options }, 'Starting listing population');
    return this.syncTracker.initializeFromUkss(options);
  }

  /**
   * Refresh listings from UKSS source data.
   * Updates quantities and prices for existing listings.
   */
  async refreshListings(): Promise<{
    total: number;
    updated: number;
    errors: number;
  }> {
    this.logger.info('Starting listing refresh');
    return this.syncTracker.refreshFromUkss();
  }

  /**
   * Full sync of listings with UKSS.
   * Adds new products, deactivates removed products, and refreshes existing.
   */
  async syncListings(): Promise<{
    added: { total: number; inserted: number };
    deactivated: { total: number; deactivated: number };
    refreshed: { total: number; updated: number; errors: number };
  }> {
    this.logger.info('Starting full listing sync');

    // Step 1: Add new products from UKSS
    this.logger.info('Step 1/3: Adding new products from UKSS');
    const added = await this.syncTracker.addNewFromUkss();

    // Step 2: Deactivate removed products
    this.logger.info('Step 2/3: Deactivating removed products');
    const deactivated = await this.syncTracker.deactivateRemovedFromUkss();

    // Step 3: Refresh existing listings
    this.logger.info('Step 3/3: Refreshing existing listings');
    const refreshed = await this.syncTracker.refreshFromUkss();

    this.logger.info(
      { added, deactivated, refreshed },
      'Full listing sync completed'
    );

    return { added, deactivated, refreshed };
  }

  /**
   * Get listing counts for this marketplace.
   */
  async getListingCounts(): Promise<{
    total: number;
    active: number;
    newItems: number;
    synced: number;
    failed: number;
  }> {
    return this.syncTracker.getCounts();
  }
}

/**
 * Create a Fruugo adapter instance.
 */
export function createFruugoAdapter(fruugoConfig: FruugoConfig): FruugoAdapter {
  // Build base marketplace config
  const baseConfig: MarketplaceAdapterConfig = {
    config: {
      name: 'fruugo',
      storeId: fruugoConfig.storeId,
      enabled: true,
      auth: {
        type: 'basic',
        username: fruugoConfig.apiId,
        password: fruugoConfig.apiPassword,
      },
      apiBaseUrl: fruugoConfig.inventoryUpdateUrl,
      timeout: fruugoConfig.apiTimeoutMs,
      batchSize: fruugoConfig.inventoryBatchSize,
      capabilities: createCapabilities({
        productFeed: true,
        inventorySync: true,
        skuMapping: true,
        feedFormat: 'csv',
        feedDelivery: 'ftp-pull',
      }),
    },
  };

  return new FruugoAdapter({
    ...baseConfig,
    fruugo: fruugoConfig,
  });
}
