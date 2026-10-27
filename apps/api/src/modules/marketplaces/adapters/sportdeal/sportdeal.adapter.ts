/**
 * Sportdeal Marketplace Adapter
 *
 * Main adapter class for Sportdeal marketplace integration.
 * Handles product feeds and inventory feeds via XML.
 */

import { createLogger, type Logger } from '../../../../lib/logger';
import {
  BaseMarketplaceAdapter,
  createCapabilities,
  type MarketplaceCapabilities,
  type ValidationResult,
  type SyncResult,
  type MarketplaceAdapterConfig,
} from '../../index';
import { SportdealFeedGenerator } from './feed-generator';
import { SportdealInventoryFeedGenerator } from './inventory-feed';
import type { SportdealConfig } from './sportdeal.config';
import type {
  SportdealFeedResult,
  SportdealInventoryFeedResult,
  SportdealFeedOptions,
  SportdealInventoryFeedOptions,
} from './sportdeal.types';

/**
 * Sportdeal adapter configuration.
 */
export interface SportdealAdapterConfig extends MarketplaceAdapterConfig {
  /** Sportdeal-specific configuration */
  sportdeal: SportdealConfig;
}

/**
 * Sportdeal marketplace adapter.
 * Implements feed-based product listing and inventory sync.
 */
export class SportdealAdapter extends BaseMarketplaceAdapter {
  readonly marketplaceId = 'sportdeal';
  readonly name = 'Sportdeal';
  readonly pattern = 'feed' as const;
  readonly productCreationMethod = 'Feed: XML product feed served via CDN/FTP. Sportdeal pulls it. Inventory synced via separate XML delta feed.';

  private readonly sportdealConfig: SportdealConfig;
  private readonly feedGenerator: SportdealFeedGenerator;
  private readonly inventoryFeedGenerator: SportdealInventoryFeedGenerator;

  constructor(adapterConfig: SportdealAdapterConfig) {
    super(adapterConfig);

    this.sportdealConfig = adapterConfig.sportdeal;

    // Initialize sub-components
    this.feedGenerator = new SportdealFeedGenerator(this.sportdealConfig, this.logger);
    this.inventoryFeedGenerator = new SportdealInventoryFeedGenerator(this.sportdealConfig, this.logger);
  }

  /**
   * Get Sportdeal marketplace capabilities.
   */
  getCapabilities(): MarketplaceCapabilities {
    return createCapabilities({
      productFeed: true,
      inventorySync: true, // Via feed file
      priceSync: true, // Price included in inventory feed
      skuMapping: false, // Not required for Sportdeal
      orderImport: false, // Not implemented in this adapter
      orderStatusUpdate: false,
      feedFormat: 'xml',
      feedDelivery: 'ftp-pull',
    });
  }

  getQualificationConfig(): QualificationConfig {
    return this.buildQualificationConfig({
      excludedManufacturerIds: this.sportdealConfig.excludedManufacturerIds,
    });
  }

  /**
   * Validate Sportdeal configuration.
   * Since Sportdeal is feed-based, we validate the feed directory exists.
   */
  async validateCredentials(): Promise<ValidationResult> {
    try {
      this.logger.info('Validating Sportdeal configuration');

      // Check feed directory is configured
      if (!this.sportdealConfig.feedDirectory) {
        return {
          valid: false,
          message: 'Feed directory not configured',
          error: 'SPORTDEAL_FEED_DIR is required',
        };
      }

      // Check CDN URL is configured
      if (!this.sportdealConfig.cdnUrl) {
        return {
          valid: false,
          message: 'CDN URL not configured',
          error: 'SPORTDEAL_CDN_URL is required',
        };
      }

      this.logger.info('Sportdeal configuration validated successfully');
      return {
        valid: true,
        message: 'Configuration is valid',
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Configuration validation failed');

      return {
        valid: false,
        message: 'Failed to validate configuration',
        error: err.message,
      };
    }
  }

  /**
   * Generate Sportdeal product feed.
   * Creates XML file for pickup by Sportdeal.
   */
  async generateProductFeed(options?: SportdealFeedOptions): Promise<SportdealFeedResult> {
    return this.feedGenerator.generate(options);
  }

  /**
   * Generate Sportdeal inventory feed.
   * Creates XML file with inventory and price updates.
   * By default, generates delta feed (only changed items).
   */
  async generateInventoryFeed(options?: SportdealInventoryFeedOptions): Promise<SportdealInventoryFeedResult> {
    return this.inventoryFeedGenerator.generate(options);
  }

  /**
   * Sync inventory to Sportdeal.
   * For Sportdeal, this generates the inventory feed file.
   */
  async syncInventory(options?: { full?: boolean; dryRun?: boolean }): Promise<SyncResult> {
    const result = await this.generateInventoryFeed(options);

    return {
      success: result.success,
      itemsProcessed: result.itemCount,
      itemsFailed: 0,
      errors: result.error ? [{ sku: 'all', error: result.error }] : undefined,
    };
  }

  /**
   * Sync prices to Sportdeal.
   * Prices are included in the inventory feed, so this generates the inventory feed.
   */
  async syncPrices(): Promise<SyncResult> {
    const result = await this.generateInventoryFeed({ full: true });

    return {
      success: result.success,
      itemsProcessed: result.itemCount,
      itemsFailed: 0,
      errors: result.error ? [{ sku: 'all', error: result.error }] : undefined,
    };
  }

  /**
   * Sync products to Sportdeal.
   * This generates the full product feed.
   */
  async syncProducts(): Promise<SyncResult> {
    const result = await this.generateProductFeed();

    return {
      success: result.success,
      itemsProcessed: result.itemCount,
      itemsFailed: 0,
      errors: result.error ? [{ sku: 'all', error: result.error }] : undefined,
    };
  }

  /**
   * Get the Sportdeal-specific configuration.
   */
  getSportdealConfig(): SportdealConfig {
    return this.sportdealConfig;
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
 * Create a Sportdeal adapter instance.
 */
export function createSportdealAdapter(sportdealConfig: SportdealConfig): SportdealAdapter {
  // Build base marketplace config
  const baseConfig: MarketplaceAdapterConfig = {
    config: {
      name: 'sportdeal',
      storeId: sportdealConfig.storeId,
      enabled: true,
      auth: {
        type: 'none', // Feed-based, no API auth
      },
      timeout: 30000,
      batchSize: 100,
      capabilities: createCapabilities({
        productFeed: true,
        inventorySync: true,
        priceSync: true,
        feedFormat: 'xml',
        feedDelivery: 'ftp-pull',
      }),
    },
  };

  return new SportdealAdapter({
    ...baseConfig,
    sportdeal: sportdealConfig,
  });
}
