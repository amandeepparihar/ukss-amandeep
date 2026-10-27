/**
 * Marketplace Adapter Types
 *
 * Core interfaces for marketplace integrations.
 * All marketplace adapters must implement MarketplaceAdapter.
 */

import type { MarketplaceConfig } from '../config/types';

/**
 * Marketplace capability flags.
 * Declare what operations the marketplace supports.
 */
export interface MarketplaceCapabilities {
  /** Can create new products on marketplace */
  productCreation: boolean;
  /** Can update existing product details */
  productUpdate: boolean;
  /** Can sync inventory/stock levels */
  inventorySync: boolean;
  /** Can sync prices */
  priceSync: boolean;
  /** Can import orders from marketplace */
  orderImport: boolean;
  /** Can update order status on marketplace */
  orderStatusUpdate: boolean;
  /** Can fetch SKU ID mappings from marketplace */
  skuMapping: boolean;
}

/**
 * Integration pattern used by the marketplace.
 */
export type IntegrationPattern = 'feed' | 'api' | 'hybrid';

/**
 * Feed format for feed-based integrations.
 */
export type FeedFormat = 'csv' | 'xml' | 'json';

/**
 * Delivery method for feeds.
 */
export type FeedDeliveryMethod = 'ftp' | 'sftp' | 'http-upload' | 'http-pull';

/**
 * Product data for syncing.
 */
export interface ProductData {
  /** Internal SKU */
  sku: string;
  /** Product name/title */
  name: string;
  /** Price */
  price: number;
  /** Currency code */
  currency: string;
  /** Stock quantity */
  quantity: number;
  /** Product description */
  description?: string;
  /** Brand name */
  brand?: string;
  /** Category */
  category?: string;
  /** Additional marketplace-specific fields */
  [key: string]: unknown;
}

/**
 * Inventory data for syncing.
 */
export interface InventoryData {
  /** Internal SKU */
  sku: string;
  /** External marketplace SKU ID */
  externalSkuId?: string;
  /** Stock quantity */
  quantity: number;
  /** Availability status */
  availability?: 'INSTOCK' | 'OUTOFSTOCK' | 'PREORDER';
}

/**
 * Price data for syncing.
 */
export interface PriceData {
  /** Internal SKU */
  sku: string;
  /** External marketplace SKU ID */
  externalSkuId?: string;
  /** Regular price */
  price: number;
  /** Sale price (optional) */
  salePrice?: number;
  /** Currency code */
  currency: string;
}

/**
 * SKU mapping between internal and external IDs.
 */
export interface SkuMapping {
  /** Internal SKU */
  sku: string;
  /** External marketplace SKU ID */
  externalSkuId: string;
  /** External product ID (if different from SKU) */
  externalProductId?: string;
}

/**
 * Qualification rules for adding products to marketplace listing table.
 * Each marketplace defines its own rules as SQL fragments.
 * The sync tracker appends these to the base qualification query.
 *
 * Rules are documented here in code — AI generates external documentation from this.
 */
export interface QualificationConfig {
  /** Human-readable description of ALL rules for this marketplace */
  description: string;
  /**
   * Additional SQL WHERE clauses (appended with AND to the base query).
   * SAFETY: Only use literal values (e.g. integer arrays from config).
   * Never interpolate user input — these are injected into $queryRawUnsafe.
   */
  additionalWhereClauses?: string[];
  /** Additional SQL JOINs (if marketplace needs extra tables for qualification) */
  additionalJoins?: string[];
}

/**
 * Result of a sync operation.
 */
export interface SyncResult<T = unknown> {
  /** Whether the operation was successful */
  success: boolean;
  /** Number of items processed */
  processed: number;
  /** Number of items that failed */
  failed: number;
  /** Error messages for failed items */
  errors: Array<{ sku: string; error: string }>;
  /** Additional data from the operation */
  data?: T;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of a feed generation operation.
 */
export interface FeedResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Path to generated feed file */
  filePath: string;
  /** Number of items in feed */
  itemCount: number;
  /** File size in bytes */
  fileSize: number;
  /** Feed format */
  format: FeedFormat;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of credential validation.
 */
export interface ValidationResult {
  /** Whether credentials are valid */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Additional details from validation */
  details?: Record<string, unknown>;
}

/**
 * Core marketplace adapter interface.
 * All marketplace adapters must implement this interface.
 */
export interface MarketplaceAdapter {
  /**
   * Unique marketplace identifier.
   */
  readonly marketplaceId: string;

  /**
   * Human-readable marketplace name.
   */
  readonly name: string;

  /**
   * Integration pattern used.
   */
  readonly pattern: IntegrationPattern;

  /**
   * Human-readable description of how products are created on this marketplace.
   * Examples: "Feed: CSV served via HTTP, marketplace pulls it"
   *           "API: Products created via Mirakl P11 import"
   *           "Manual: Products created on marketplace portal"
   */
  readonly productCreationMethod: string;

  /**
   * Get qualification rules for this marketplace.
   * Defines which products from UKSS qualify for listing on this marketplace.
   * Rules are documented here in code — AI generates external documentation from this.
   */
  getQualificationConfig(): QualificationConfig;

  /**
   * Get marketplace capabilities.
   * Declares what operations this adapter supports.
   */
  getCapabilities(): MarketplaceCapabilities;

  /**
   * Validate API credentials/configuration.
   * Should make a test API call to verify access.
   */
  validateCredentials(): Promise<ValidationResult>;

  /**
   * Generate product feed file (for feed-based marketplaces).
   * Marketplace pulls the feed via FTP or HTTP.
   *
   * @param products - Products to include in feed
   * @returns Feed generation result
   */
  generateProductFeed?(products: ProductData[]): Promise<FeedResult>;

  /**
   * Sync products via API (for API-based marketplaces).
   * Pushes products directly to marketplace API.
   *
   * @param products - Products to sync
   * @returns Sync result
   */
  syncProducts?(products: ProductData[]): Promise<SyncResult>;

  /**
   * Sync inventory levels.
   * Updates stock quantities on marketplace.
   *
   * @param inventory - Inventory data to sync
   * @returns Sync result
   */
  syncInventory(inventory: InventoryData[]): Promise<SyncResult>;

  /**
   * Sync prices (if supported separately from inventory).
   *
   * @param prices - Price data to sync
   * @returns Sync result
   */
  syncPrices?(prices: PriceData[]): Promise<SyncResult>;

  /**
   * Fetch SKU ID mappings from marketplace.
   * Gets external IDs for synced products.
   *
   * @returns Array of SKU mappings
   */
  fetchSkuMappings?(): Promise<SkuMapping[]>;
}

/**
 * Base configuration for marketplace adapters.
 */
export interface MarketplaceAdapterConfig {
  /** Marketplace configuration */
  config: MarketplaceConfig;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Helper to create a default capabilities object.
 */
export function createCapabilities(
  overrides: Partial<MarketplaceCapabilities> = {}
): MarketplaceCapabilities {
  return {
    productCreation: false,
    productUpdate: false,
    inventorySync: false,
    priceSync: false,
    orderImport: false,
    orderStatusUpdate: false,
    skuMapping: false,
    ...overrides,
  };
}
