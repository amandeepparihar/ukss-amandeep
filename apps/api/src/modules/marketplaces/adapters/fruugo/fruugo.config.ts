/**
 * Fruugo Configuration Schema
 *
 * Defines and validates configuration for the Fruugo marketplace adapter.
 * All settings are loaded from environment variables with FRUUGO_ prefix.
 */

import { z } from 'zod';
import { parseNumberArray, parseStringArray } from '../../utils/config.utils';

/**
 * Zod schema for Fruugo configuration validation.
 */
export const fruugoConfigSchema = z.object({
  // Authentication
  apiId: z.string().email('FRUUGO_API_ID must be a valid email address'),
  apiPassword: z.string().min(1, 'FRUUGO_API_PASSWORD is required'),

  // API Endpoints
  inventoryUpdateUrl: z.string().url('FRUUGO_INVENTORY_URL must be a valid URL'),
  listingsApiUrl: z.string().url('FRUUGO_LISTINGS_URL must be a valid URL'),

  // Feed Settings
  feedDirectory: z.string().min(1, 'FRUUGO_FEED_DIR is required'),
  tempDirectory: z.string().optional(),
  archiveDirectory: z.string().optional(),
  cdnUrl: z.string().url('FRUUGO_CDN_URL must be a valid URL'),

  // Filters
  excludedManufacturerIds: z.array(z.number()).default([]),
  excludedProductTypeIds: z.array(z.number()).default([]),
  kidsSizeGuides: z.array(z.string()).default([]),

  // Store
  storeId: z.number().int().positive('FRUUGO_STORE_ID must be a positive integer'),
  ptsStatus: z.number().int().default(1),

  // Batch Settings
  inventoryBatchSize: z.number().int().positive().default(100),
  skuSyncBatchSize: z.number().int().positive().default(5000),
  parallelPages: z.number().int().positive().default(4),

  // Timeouts
  apiTimeoutMs: z.number().int().positive().default(30000),
});

/**
 * Fruugo configuration type.
 */
export type FruugoConfig = z.infer<typeof fruugoConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_FRUUGO_CONFIG: Partial<FruugoConfig> = {
  inventoryBatchSize: 100,
  skuSyncBatchSize: 5000,
  parallelPages: 4,
  ptsStatus: 1,
  apiTimeoutMs: 30000,
  excludedManufacturerIds: [],
  excludedProductTypeIds: [],
  kidsSizeGuides: [],
};

/**
 * Load Fruugo configuration from environment variables.
 *
 * Required environment variables:
 * - FRUUGO_API_ID: Email address for API authentication
 * - FRUUGO_API_PASSWORD: API password
 * - FRUUGO_INVENTORY_URL: Stock update API endpoint
 * - FRUUGO_LISTINGS_URL: Listings API endpoint (without page number)
 * - FRUUGO_STORE_ID: Store ID in database
 * - FRUUGO_FEED_DIR: Directory for feed files
 * - FRUUGO_CDN_URL: CDN base URL for product images
 *
 * Optional environment variables:
 * - FRUUGO_EXCLUDED_MANUFACTURER_IDS: Comma-separated manufacturer IDs to exclude
 * - FRUUGO_EXCLUDED_PRODUCT_TYPE_IDS: Comma-separated product type IDs to exclude
 * - FRUUGO_KIDS_SIZE_GUIDES: Comma-separated size guide values for 0% VAT
 * - FRUUGO_PTS_STATUS: Product-to-store status (default: 1)
 * - FRUUGO_INVENTORY_BATCH_SIZE: Items per inventory API request (default: 100)
 * - FRUUGO_SKU_SYNC_BATCH_SIZE: Database update batch size (default: 5000)
 * - FRUUGO_PARALLEL_PAGES: Concurrent page fetches for SKU sync (default: 4)
 * - FRUUGO_API_TIMEOUT_MS: API timeout in milliseconds (default: 30000)
 *
 * @throws Error if required variables are missing or invalid
 */
export function loadFruugoConfig(): FruugoConfig {
  const feedDir = process.env.FRUUGO_FEED_DIR || '';

  const rawConfig = {
    // Authentication
    apiId: process.env.FRUUGO_API_ID,
    apiPassword: process.env.FRUUGO_API_PASSWORD,

    // API Endpoints
    inventoryUpdateUrl: process.env.FRUUGO_INVENTORY_URL,
    listingsApiUrl: process.env.FRUUGO_LISTINGS_URL,

    // Feed Settings
    feedDirectory: feedDir,
    tempDirectory: process.env.FRUUGO_TEMP_DIR || `${feedDir}/temp`,
    archiveDirectory: process.env.FRUUGO_ARCHIVE_DIR || `${feedDir}/archive`,
    cdnUrl: process.env.FRUUGO_CDN_URL,

    // Filters
    excludedManufacturerIds: parseNumberArray(process.env.FRUUGO_EXCLUDED_MANUFACTURER_IDS),
    excludedProductTypeIds: parseNumberArray(process.env.FRUUGO_EXCLUDED_PRODUCT_TYPE_IDS),
    kidsSizeGuides: parseStringArray(process.env.FRUUGO_KIDS_SIZE_GUIDES),

    // Store
    storeId: process.env.FRUUGO_STORE_ID ? parseInt(process.env.FRUUGO_STORE_ID, 10) : undefined,
    ptsStatus: process.env.FRUUGO_PTS_STATUS
      ? parseInt(process.env.FRUUGO_PTS_STATUS, 10)
      : DEFAULT_FRUUGO_CONFIG.ptsStatus,

    // Batch Settings
    inventoryBatchSize: process.env.FRUUGO_INVENTORY_BATCH_SIZE
      ? parseInt(process.env.FRUUGO_INVENTORY_BATCH_SIZE, 10)
      : DEFAULT_FRUUGO_CONFIG.inventoryBatchSize,
    skuSyncBatchSize: process.env.FRUUGO_SKU_SYNC_BATCH_SIZE
      ? parseInt(process.env.FRUUGO_SKU_SYNC_BATCH_SIZE, 10)
      : DEFAULT_FRUUGO_CONFIG.skuSyncBatchSize,
    parallelPages: process.env.FRUUGO_PARALLEL_PAGES
      ? parseInt(process.env.FRUUGO_PARALLEL_PAGES, 10)
      : DEFAULT_FRUUGO_CONFIG.parallelPages,

    // Timeouts
    apiTimeoutMs: process.env.FRUUGO_API_TIMEOUT_MS
      ? parseInt(process.env.FRUUGO_API_TIMEOUT_MS, 10)
      : DEFAULT_FRUUGO_CONFIG.apiTimeoutMs,
  };

  const result = fruugoConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Fruugo configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Create Fruugo configuration from partial config object.
 * Useful for testing or programmatic configuration.
 */
export function createFruugoConfig(config: Partial<FruugoConfig>): FruugoConfig {
  const merged = { ...DEFAULT_FRUUGO_CONFIG, ...config };
  return fruugoConfigSchema.parse(merged);
}
