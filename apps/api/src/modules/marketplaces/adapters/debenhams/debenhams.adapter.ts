/**
 * Debenhams/Mirakl Marketplace Adapter
 *
 * Main adapter class for Debenhams marketplace integration via Mirakl.
 * Handles offer creation (O11 API), inventory/price sync (OF24 API),
 * and listing management.
 *
 * Key differences from feed-based marketplaces:
 * - Products are created manually on Mirakl portal by team members
 * - Offers are created via O11 API for products that have an externalProductId
 * - Inventory/price updates use OF24 API
 * - New listings start with syncAllowed=false until offers are created
 * - API key goes directly in Authorization header (no Bearer prefix)
 */

import { createLogger, type Logger } from '../../../../lib/logger';
import {
  BaseMarketplaceAdapter,
  createCapabilities,
  HttpClient,
  type MarketplaceCapabilities,
  type QualificationConfig,
  type ValidationResult,
  type SyncResult,
  type MarketplaceAdapterConfig,
} from '../../index';
import type { DebenhamsConfig } from './debenhams.config';
import type {
  MiraklOfferCreateRequest,
  MiraklOfferCreateResponse,
  MiraklInventoryUpdateRequest,
  MiraklInventoryUpdateResponse,
  MiraklOfferUpdate,
  DebenhamsOfferCreateResult,
  DebenhamsInventorySyncResult,
  DebenhamsOfferCreateOptions,
  DebenhamsInventorySyncOptions,
} from './debenhams.types';

/**
 * Debenhams adapter configuration.
 */
export interface DebenhamsAdapterConfig extends MarketplaceAdapterConfig {
  /** Debenhams/Mirakl-specific configuration */
  debenhams: DebenhamsConfig;
}

/**
 * Debenhams marketplace adapter.
 * Implements API-based offer creation and inventory/price sync via Mirakl.
 */
export class DebenhamsAdapter extends BaseMarketplaceAdapter {
  readonly marketplaceId = 'debenhams';
  readonly name = 'Debenhams';
  readonly pattern = 'api' as const;
  readonly productCreationMethod = 'Manual: Products created on Mirakl portal by team member. Offers created via O11 API. Inventory/price synced via OF24 API.';

  private readonly debenhamsConfig: DebenhamsConfig;
  private readonly miraklHttpClient: HttpClient;

  constructor(adapterConfig: DebenhamsAdapterConfig) {
    super(adapterConfig);

    this.debenhamsConfig = adapterConfig.debenhams;

    // Create HTTP client with Mirakl API key auth.
    // IMPORTANT: Mirakl uses the API key directly in the Authorization header
    // with NO "Bearer" prefix.
    this.miraklHttpClient = new HttpClient({
      baseUrl: this.debenhamsConfig.apiBaseUrl,
      auth: {
        type: 'token-header',
        token: this.debenhamsConfig.apiKey,
        tokenPrefix: '', // No prefix — raw API key in Authorization header
      },
      timeout: this.debenhamsConfig.apiTimeoutMs,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: true,
      },
    });
  }

  /**
   * Get Debenhams marketplace capabilities.
   */
  getCapabilities(): MarketplaceCapabilities {
    return createCapabilities({
      productCreation: false, // Products created manually on Mirakl portal
      inventorySync: true,
      priceSync: true,
      orderImport: true,
      orderStatusUpdate: true,
      skuMapping: false,
    });
  }

  getQualificationConfig(): QualificationConfig {
    return this.buildQualificationConfig({
      excludedManufacturerIds: this.debenhamsConfig.excludedManufacturerIds,
      excludedProductTypeIds: this.debenhamsConfig.excludedProductTypeIds,
    });
  }

  /**
   * Validate Mirakl API credentials.
   * Tests connection by fetching offers list.
   */
  async validateCredentials(): Promise<ValidationResult> {
    try {
      this.logger.info('Validating Debenhams/Mirakl credentials');

      const response = await this.miraklHttpClient.get<string>(
        `/api/offers?shop_id=${this.debenhamsConfig.shopId}&max=1`
      );

      if (response.status === 200) {
        this.logger.info('Debenhams credentials validated successfully');
        return {
          valid: true,
        };
      } else if (response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key - authentication failed (HTTP 401)',
        };
      } else {
        return {
          valid: false,
          error: `Unexpected response status: HTTP ${response.status}`,
        };
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Credential validation failed');

      return {
        valid: false,
        error: err.message,
      };
    }
  }

  /**
   * Create offers on Mirakl for listings that have an externalProductId
   * but syncAllowed is still false.
   *
   * Flow:
   * 1. Query listings where externalProductId IS NOT NULL AND syncAllowed = false
   * 2. Build O11 API request with offer data
   * 3. POST to Mirakl O11 API
   * 4. On success, flip syncAllowed = true for those listings
   */
  async createOffers(options?: DebenhamsOfferCreateOptions): Promise<DebenhamsOfferCreateResult> {
    const startTime = Date.now();
    const { limit = 0, dryRun = false } = options || {};

    this.logger.info({ limit, dryRun }, 'Starting offer creation on Mirakl');

    try {
      // Query listings with externalProductId but syncAllowed = false
      const listings = await this.syncTracker.getListingsForOfferCreation({
        limit: limit > 0 ? limit : undefined,
      });

      if (listings.length === 0) {
        this.logger.info('No listings eligible for offer creation');
        return {
          success: true,
          offersSubmitted: 0,
          offersFailed: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      this.logger.info({ count: listings.length }, 'Found listings eligible for offer creation');

      if (dryRun) {
        this.logger.info('Dry run — skipping API calls');
        return {
          success: true,
          offersSubmitted: listings.length,
          offersFailed: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // Build O11 request
      const offers = listings.map((listing) => ({
        shop_sku: listing.ukssSku,
        product_id: listing.externalProductId!,
        product_id_type: 'SHOP_SKU',
        price: listing.ukssPrice ?? 0,
        quantity: listing.ukssQuantity ?? 0,
        state_code: '11',
        active: true,
      }));

      const requestBody: MiraklOfferCreateRequest = { offers };

      // POST to O11 API
      const response = await this.miraklHttpClient.post<MiraklOfferCreateResponse>(
        '/api/offers',
        requestBody
      );

      if (response.status >= 200 && response.status < 300 && response.data) {
        // Success — flip syncAllowed to true for submitted listings
        const skus = listings.map((l) => l.ukssSku);
        await this.syncTracker.enableSyncForSkus(skus);

        this.logger.info(
          { importId: response.data.import_id, count: offers.length },
          'Offers submitted successfully'
        );

        return {
          success: true,
          offersSubmitted: offers.length,
          offersFailed: 0,
          importId: response.data.import_id,
          errors: [],
          duration: Date.now() - startTime,
        };
      } else {
        return {
          success: false,
          offersSubmitted: 0,
          offersFailed: offers.length,
          errors: [{ sku: 'all', error: `Mirakl API returned status ${response.status}` }],
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Offer creation failed');

      return {
        success: false,
        offersSubmitted: 0,
        offersFailed: 0,
        errors: [{ sku: 'all', error: err.message }],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sync inventory and prices to Mirakl via OF24 API.
   * Only processes items where syncAllowed = true.
   */
  async syncInventory(options?: DebenhamsInventorySyncOptions): Promise<DebenhamsInventorySyncResult> {
    const startTime = Date.now();
    const {
      full = false,
      batchSize = this.debenhamsConfig.inventoryBatchSize,
      dryRun = false,
    } = options || {};

    this.logger.info({ full, batchSize, dryRun }, 'Starting inventory sync to Mirakl');

    try {
      // Get items to sync — getChangedItems for delta, getItemsForFullSync for full
      // Both already filter by syncAllowed = true
      const items = full
        ? await this.syncTracker.getItemsForFullSync({ limit: 0 })
        : await this.syncTracker.getChangedItems({ limit: batchSize * 10 });

      if (items.length === 0) {
        this.logger.info('No items to sync');
        return {
          success: true,
          itemsProcessed: 0,
          itemsFailed: 0,
          importIds: [],
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      this.logger.info({ count: items.length }, 'Found items to sync');

      if (dryRun) {
        this.logger.info('Dry run — skipping API calls');
        return {
          success: true,
          itemsProcessed: items.length,
          itemsFailed: 0,
          importIds: [],
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // Process in batches
      const importIds: number[] = [];
      const errors: Array<{ sku: string; error: string }> = [];
      let totalProcessed = 0;

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        const offerUpdates: MiraklOfferUpdate[] = batch.map((item) => ({
          shop_sku: item.ukssSku,
          quantity: item.ukssQuantity ?? 0,
          price: item.ukssPrice ?? 0,
          active: (item.ukssQuantity ?? 0) > 0,
        }));

        const requestBody: MiraklInventoryUpdateRequest = { offers: offerUpdates };

        try {
          const response = await this.miraklHttpClient.put<MiraklInventoryUpdateResponse>(
            '/api/offers',
            requestBody
          );

          if (response.status >= 200 && response.status < 300 && response.data) {
            importIds.push(response.data.import_id);
            totalProcessed += batch.length;

            // Update sync tracking state for successfully synced items
            await this.syncTracker.processResults(
              batch.map((item) => ({
                id: item.id,
                ukssSku: item.ukssSku,
                success: true,
                syncedQuantity: item.ukssQuantity ?? 0,
                syncedPrice: Number(item.ukssPrice ?? 0),
              }))
            );

            this.logger.info(
              { importId: response.data.import_id, batchSize: batch.length },
              'Batch synced successfully'
            );
          } else {
            batch.forEach((item) => {
              errors.push({ sku: item.ukssSku, error: `Mirakl API returned status ${response.status}` });
            });
          }
        } catch (batchError) {
          const batchErr = batchError as Error;
          this.logger.error({ error: batchErr.message, batchIndex: i }, 'Batch sync failed');
          batch.forEach((item) => {
            errors.push({ sku: item.ukssSku, error: batchErr.message });
          });
        }
      }

      const duration = Date.now() - startTime;
      const success = errors.length === 0;

      // Record sync history
      await this.syncTracker.recordHistory({
        operation: 'inventory_sync',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: duration,
        totalItems: items.length,
        newItemsListed: 0,
        itemsUpdated: totalProcessed,
        itemsFailed: errors.length,
        errorSummary: errors.length > 0 ? `${errors.length} items failed` : undefined,
        errorDetails: errors.length > 0 ? errors.slice(0, 10) : undefined,
        triggeredBy: 'manual',
      });

      this.logger.info(
        { totalProcessed, errors: errors.length, importIds },
        `Inventory sync ${success ? 'completed' : 'completed with errors'}`
      );

      return {
        success,
        itemsProcessed: totalProcessed,
        itemsFailed: errors.length,
        importIds,
        errors,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Inventory sync failed');

      return {
        success: false,
        itemsProcessed: 0,
        itemsFailed: 0,
        importIds: [],
        errors: [{ sku: 'all', error: err.message }],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Populate marketplace listings from UKSS source data.
   * Initializes the jsa_marketplacelisting table with products
   * enabled for this marketplace.
   *
   * IMPORTANT: Sets syncAllowed = false because Debenhams requires
   * offer creation (O11 API) before inventory sync can begin.
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
    this.logger.info({ options }, 'Starting listing population (syncAllowed=false)');
    return this.syncTracker.initializeFromUkss({
      ...options,
      syncAllowed: false,
      qualificationConfig: this.getQualificationConfig(),
    });
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
   * Adds new products (syncAllowed=false), deactivates removed products,
   * and refreshes existing.
   */
  async syncListings(): Promise<{
    added: { total: number; inserted: number };
    deactivated: { total: number; deactivated: number };
    refreshed: { total: number; updated: number; errors: number };
  }> {
    this.logger.info('Starting full listing sync');

    // Step 1: Add new products from UKSS (syncAllowed=false)
    this.logger.info('Step 1/3: Adding new products from UKSS (syncAllowed=false)');
    const added = await this.syncTracker.addNewFromUkss({
      syncAllowed: false,
      qualificationConfig: this.getQualificationConfig(),
    });

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
    notCreatedOnMarketplace: number;
    syncNotAllowed: number;
  }> {
    return this.syncTracker.getCounts();
  }

  /**
   * Get the Debenhams-specific configuration.
   */
  getDebenhamsConfig(): DebenhamsConfig {
    return this.debenhamsConfig;
  }
}

/**
 * Create a Debenhams adapter instance.
 */
export function createDebenhamsAdapter(debenhamsConfig: DebenhamsConfig): DebenhamsAdapter {
  // Build base marketplace config
  const baseConfig: MarketplaceAdapterConfig = {
    config: {
      name: 'debenhams',
      storeId: debenhamsConfig.storeId,
      enabled: true,
      auth: {
        type: 'token-header',
        token: debenhamsConfig.apiKey,
        tokenPrefix: '', // No prefix — raw API key in Authorization header
      },
      apiBaseUrl: debenhamsConfig.apiBaseUrl,
      timeout: debenhamsConfig.apiTimeoutMs,
      batchSize: debenhamsConfig.inventoryBatchSize,
      capabilities: createCapabilities({
        inventorySync: true,
        priceSync: true,
        orderImport: true,
        orderStatusUpdate: true,
      }),
    },
  };

  return new DebenhamsAdapter({
    ...baseConfig,
    debenhams: debenhamsConfig,
  });
}
