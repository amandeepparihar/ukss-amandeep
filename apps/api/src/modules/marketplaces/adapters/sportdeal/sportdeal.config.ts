/**
 * Sportdeal Configuration Schema
 *
 * Defines and validates configuration for the Sportdeal marketplace adapter.
 * All settings are loaded from environment variables with SPORTDEAL_ prefix.
 */

import { z } from 'zod';
import { parseNumberArray } from '../../utils/config.utils';

/**
 * Zod schema for Sportdeal configuration validation.
 */
export const sportdealConfigSchema = z.object({
  // Feed Settings
  feedDirectory: z.string().min(1, 'SPORTDEAL_FEED_DIR is required'),
  inventoryFeedDirectory: z.string().optional(),
  tempDirectory: z.string().optional(),
  archiveDirectory: z.string().optional(),
  cdnUrl: z.string().url('SPORTDEAL_CDN_URL must be a valid URL'),

  // Filters
  excludedManufacturerIds: z.array(z.number()).default([]),

  // Store
  storeId: z.number().int().positive('SPORTDEAL_STORE_ID must be a positive integer'),
  ptsStatus: z.number().int().default(1),

  // Feed File Names
  productFeedFileName: z.string().default('uksoccershop_products_UK.xml'),
  inventoryFeedFileName: z.string().default('sportdeal_inventory.xml'),

  // IOSS Number (EU VAT compliance)
  iossNumber: z.string().optional(),
});

/**
 * Sportdeal configuration type.
 */
export type SportdealConfig = z.infer<typeof sportdealConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_SPORTDEAL_CONFIG: Partial<SportdealConfig> = {
  ptsStatus: 1,
  excludedManufacturerIds: [],
  productFeedFileName: 'uksoccershop_products_UK.xml',
  inventoryFeedFileName: 'sportdeal_inventory.xml',
};

/**
 * Load Sportdeal configuration from environment variables.
 *
 * Required environment variables:
 * - SPORTDEAL_STORE_ID: Store ID in database (127)
 * - SPORTDEAL_FEED_DIR: Directory for feed files
 * - SPORTDEAL_CDN_URL: CDN base URL for product images
 *
 * Optional environment variables:
 * - SPORTDEAL_PTS_STATUS: Product-to-store status (default: 1)
 * - SPORTDEAL_EXCLUDED_MANUFACTURER_IDS: Comma-separated manufacturer IDs to exclude
 * - SPORTDEAL_IOSS_NUMBER: IOSS number for EU VAT compliance
 *
 * @throws Error if required variables are missing or invalid
 */
export function loadSportdealConfig(): SportdealConfig {
  const feedDir = process.env.SPORTDEAL_FEED_DIR || '';

  const rawConfig = {
    // Feed Settings
    feedDirectory: feedDir,
    inventoryFeedDirectory: process.env.SPORTDEAL_INVENTORY_FEED_DIR || `${feedDir}/inventory`,
    tempDirectory: process.env.SPORTDEAL_TEMP_DIR || `${feedDir}/temp`,
    archiveDirectory: process.env.SPORTDEAL_ARCHIVE_DIR || `${feedDir}/Archive`,
    cdnUrl: process.env.SPORTDEAL_CDN_URL,

    // Filters
    excludedManufacturerIds: parseNumberArray(process.env.SPORTDEAL_EXCLUDED_MANUFACTURER_IDS),

    // Store
    storeId: process.env.SPORTDEAL_STORE_ID ? parseInt(process.env.SPORTDEAL_STORE_ID, 10) : undefined,
    ptsStatus: process.env.SPORTDEAL_PTS_STATUS
      ? parseInt(process.env.SPORTDEAL_PTS_STATUS, 10)
      : DEFAULT_SPORTDEAL_CONFIG.ptsStatus,

    // Feed File Names
    productFeedFileName: process.env.SPORTDEAL_PRODUCT_FEED_FILE || DEFAULT_SPORTDEAL_CONFIG.productFeedFileName,
    inventoryFeedFileName: process.env.SPORTDEAL_INVENTORY_FEED_FILE || DEFAULT_SPORTDEAL_CONFIG.inventoryFeedFileName,

    // IOSS
    iossNumber: process.env.SPORTDEAL_IOSS_NUMBER,
  };

  const result = sportdealConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Sportdeal configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Create Sportdeal configuration from partial config object.
 * Useful for testing or programmatic configuration.
 */
export function createSportdealConfig(config: Partial<SportdealConfig>): SportdealConfig {
  const merged = { ...DEFAULT_SPORTDEAL_CONFIG, ...config };
  return sportdealConfigSchema.parse(merged);
}
