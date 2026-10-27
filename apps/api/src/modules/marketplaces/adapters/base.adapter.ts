/**
 * Base Marketplace Adapter
 *
 * Abstract base class for marketplace adapters.
 * Provides common functionality and utilities.
 *
 * Marketplace-specific adapters extend this class and implement
 * the required methods for their integration pattern.
 */

import { createLogger, type Logger } from '../../../lib/logger';
import { HttpClient, type HttpClientConfig } from '../utils/http-client';
import { BatchProcessor, type BatchConfig } from '../utils/batch-processor';
import { MarketplaceSyncTracker, createMarketplaceSyncTracker } from '../utils/sync-tracker';
import type { MarketplaceConfig } from '../config/types';
import type {
  MarketplaceAdapter,
  MarketplaceAdapterConfig,
  MarketplaceCapabilities,
  IntegrationPattern,
  QualificationConfig,
  ProductData,
  InventoryData,
  PriceData,
  SyncResult,
  FeedResult,
  ValidationResult,
  SkuMapping,
} from './types';

/**
 * Abstract base class for marketplace adapters.
 * Provides common HTTP client, batch processing, and logging.
 */
export abstract class BaseMarketplaceAdapter implements MarketplaceAdapter {
  /** Unique marketplace identifier (e.g., 'fruugo', 'baselinker') */
  abstract readonly marketplaceId: string;

  /** Human-readable marketplace name */
  abstract readonly name: string;

  /** Integration pattern used by this marketplace */
  abstract readonly pattern: IntegrationPattern;

  /**
   * Human-readable description of how products are created on this marketplace.
   * Examples: "Feed: CSV served via HTTP, marketplace pulls it"
   *           "Manual: Products created on marketplace portal"
   */
  abstract readonly productCreationMethod: string;

  /**
   * Get qualification rules for this marketplace.
   * Defines which products from UKSS qualify for listing.
   * Rules are documented here in code — AI generates external documentation from this.
   */
  abstract getQualificationConfig(): QualificationConfig;

  /**
   * Build a standard qualification config with common rules.
   * Subclasses call this from getQualificationConfig() to avoid duplication.
   */
  protected buildQualificationConfig(options: {
    excludedManufacturerIds: number[];
    excludedProductTypeIds?: number[];
    extraRules?: string[];
    extraWhereClauses?: string[];
  }): QualificationConfig {
    const rules = [
      `${this.name} Qualification Rules:`,
      '- Product must be active (products_status=1)',
      '- Product must have an image',
      '- Product must not be deleted from frontend',
      '- Product must not be out of stock',
      '- Product SKU must be non-empty',
      '- Product must have quantity > 0',
      `- Product must be assigned to ${this.name} store (pts_store_id=${this.config.storeId})`,
      `- Product must NOT be from excluded manufacturers: ${options.excludedManufacturerIds.length > 0 ? options.excludedManufacturerIds.join(', ') : 'None'}`,
    ];

    if (options.excludedProductTypeIds && options.excludedProductTypeIds.length > 0) {
      rules.push(`- Product must NOT be from excluded product types: ${options.excludedProductTypeIds.join(', ')}`);
    }

    if (options.extraRules) {
      rules.push(...options.extraRules);
    }

    const whereClauses: string[] = [];
    if (options.excludedManufacturerIds.length > 0) {
      whereClauses.push(`AND np.manufacturers_id NOT IN (${options.excludedManufacturerIds.join(',')})`);
    }
    if (options.excludedProductTypeIds && options.excludedProductTypeIds.length > 0) {
      whereClauses.push(`AND np.virtual_product_type_id NOT IN (${options.excludedProductTypeIds.join(',')})`);
    }
    if (options.extraWhereClauses) {
      whereClauses.push(...options.extraWhereClauses);
    }

    return {
      description: rules.join('\n'),
      additionalWhereClauses: whereClauses,
    };
  }

  /** Marketplace configuration */
  protected readonly config: MarketplaceConfig;

  /** HTTP client for API requests */
  protected readonly httpClient: HttpClient;

  /** Batch processor for large datasets */
  protected readonly batchProcessor: BatchProcessor;

  /** Sync tracker for listing management */
  protected readonly syncTracker: MarketplaceSyncTracker;

  /** Logger instance */
  protected readonly logger: Logger;

  /** Debug mode flag */
  protected readonly debug: boolean;

  constructor(adapterConfig: MarketplaceAdapterConfig) {
    this.config = adapterConfig.config;
    this.debug = adapterConfig.debug ?? false;
    this.logger = createLogger(`marketplace-${this.config.name || 'base'}`);

    // Initialize HTTP client with marketplace config
    this.httpClient = new HttpClient(this.buildHttpClientConfig());

    // Initialize batch processor with default config
    this.batchProcessor = new BatchProcessor(this.getBatchConfig());

    // Initialize sync tracker for listing management
    this.syncTracker = createMarketplaceSyncTracker({
      storeId: this.config.storeId,
      marketplaceName: this.config.name,
    });
  }

  /**
   * Get marketplace capabilities.
   * Override in subclass to declare supported operations.
   */
  abstract getCapabilities(): MarketplaceCapabilities;

  /**
   * Validate credentials with marketplace API.
   * Override in subclass with marketplace-specific validation.
   */
  abstract validateCredentials(): Promise<ValidationResult>;

  /**
   * Sync inventory to marketplace.
   * Override in subclass with marketplace-specific implementation.
   */
  abstract syncInventory(inventory: InventoryData[]): Promise<SyncResult>;

  /**
   * Generate product feed (for feed-based marketplaces).
   * Override in subclass if marketplace uses feeds.
   */
  generateProductFeed?(products: ProductData[]): Promise<FeedResult>;

  /**
   * Sync products via API (for API-based marketplaces).
   * Override in subclass if marketplace uses direct API.
   */
  syncProducts?(products: ProductData[]): Promise<SyncResult>;

  /**
   * Sync prices (if supported separately from inventory).
   * Override in subclass if marketplace supports separate price updates.
   */
  syncPrices?(prices: PriceData[]): Promise<SyncResult>;

  /**
   * Fetch SKU ID mappings from marketplace.
   * Override in subclass if marketplace provides SKU mappings.
   */
  fetchSkuMappings?(): Promise<SkuMapping[]>;

  /**
   * Build HTTP client configuration from marketplace config.
   * Override in subclass to customize HTTP client behavior.
   */
  protected buildHttpClientConfig(): HttpClientConfig {
    return {
      baseUrl: this.config.apiBaseUrl,
      auth: this.config.auth,
      timeout: this.config.timeout || 30000,
      rateLimit: this.config.rateLimit,
      retry: this.config.retry,
      marketplace: this.config.name,
    };
  }

  /**
   * Get batch processor configuration.
   * Override in subclass to customize batch processing.
   */
  protected getBatchConfig(): Partial<BatchConfig> {
    return {
      batchSize: 100,
      continueOnError: true,
      delayBetweenBatches: 0,
    };
  }

  /**
   * Create a successful sync result.
   */
  protected createSuccessResult<T>(
    processed: number,
    duration: number,
    data?: T
  ): SyncResult<T> {
    return {
      success: true,
      processed,
      failed: 0,
      errors: [],
      data,
      duration,
    };
  }

  /**
   * Create a failed sync result.
   */
  protected createFailureResult(
    error: string,
    duration: number,
    processed: number = 0,
    errors: Array<{ sku: string; error: string }> = []
  ): SyncResult {
    return {
      success: false,
      processed,
      failed: errors.length || 1,
      errors: errors.length > 0 ? errors : [{ sku: '', error }],
      duration,
    };
  }

  /**
   * Create a sync result from batch processing results.
   */
  protected createResultFromBatch<T>(
    batchResult: {
      successful: T[];
      failed: Array<{ item: T; error: Error }>;
      duration: number;
    },
    getSkuFromItem: (item: T) => string
  ): SyncResult {
    const errors = batchResult.failed.map((f) => ({
      sku: getSkuFromItem(f.item),
      error: f.error.message,
    }));

    return {
      success: batchResult.failed.length === 0,
      processed: batchResult.successful.length,
      failed: batchResult.failed.length,
      errors,
      duration: batchResult.duration,
    };
  }

  /**
   * Log operation start.
   */
  protected logStart(operation: string, itemCount?: number): void {
    this.logger.info(
      { operation, itemCount, marketplace: this.name },
      `Starting ${operation}`
    );
  }

  /**
   * Log operation completion.
   */
  protected logComplete(
    operation: string,
    result: SyncResult | FeedResult,
    duration: number
  ): void {
    const level = result.success ? 'info' : 'error';
    this.logger[level](
      { operation, result, duration, marketplace: this.name },
      `Completed ${operation} in ${duration}ms`
    );
  }

  /**
   * Measure operation duration.
   */
  protected async withTiming<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      return { result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        { operation, error, duration, marketplace: this.name },
        `${operation} failed after ${duration}ms`
      );
      throw error;
    }
  }

  /**
   * Get marketplace configuration.
   */
  getConfig(): MarketplaceConfig {
    return this.config;
  }

  /**
   * Check if a capability is supported.
   */
  hasCapability(capability: keyof MarketplaceCapabilities): boolean {
    return this.getCapabilities()[capability];
  }
}
