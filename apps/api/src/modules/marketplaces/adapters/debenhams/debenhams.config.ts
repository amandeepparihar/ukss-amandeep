/**
 * Debenhams/Mirakl Configuration Schema
 *
 * Debenhams uses the Mirakl marketplace platform. API calls go to the Mirakl API
 * with a direct API key in the Authorization header (no Bearer prefix).
 */

import { z } from 'zod';
import { parseNumberArray } from '../../utils/config.utils';

export const debenhamsConfigSchema = z.object({
  storeId: z.number().int().positive().default(150),
  apiBaseUrl: z.string().url('DEBENHAMS_API_BASE_URL must be a valid URL'),
  apiKey: z.string().min(1, 'DEBENHAMS_API_KEY is required'),
  shopId: z.string().min(1, 'DEBENHAMS_SHOP_ID is required'),
  excludedManufacturerIds: z.array(z.number()).default([]),
  excludedProductTypeIds: z.array(z.number()).default([]),
  apiTimeoutMs: z.number().int().positive().default(30000),
  inventoryBatchSize: z.number().int().positive().default(100),
});

export type DebenhamsConfig = z.infer<typeof debenhamsConfigSchema>;

/**
 * Load Debenhams configuration from environment variables.
 * @throws Error if required variables are missing or invalid
 */
export function loadDebenhamsConfig(): DebenhamsConfig {
  const rawConfig = {
    storeId: process.env.DEBENHAMS_STORE_ID
      ? parseInt(process.env.DEBENHAMS_STORE_ID, 10)
      : undefined,
    apiBaseUrl: process.env.DEBENHAMS_API_BASE_URL,
    apiKey: process.env.DEBENHAMS_API_KEY,
    shopId: process.env.DEBENHAMS_SHOP_ID,
    excludedManufacturerIds: parseNumberArray(process.env.DEBENHAMS_EXCLUDED_MANUFACTURER_IDS),
    excludedProductTypeIds: parseNumberArray(process.env.DEBENHAMS_EXCLUDED_PRODUCT_TYPE_IDS),
    apiTimeoutMs: process.env.DEBENHAMS_API_TIMEOUT_MS
      ? parseInt(process.env.DEBENHAMS_API_TIMEOUT_MS, 10)
      : undefined,
    inventoryBatchSize: process.env.DEBENHAMS_INVENTORY_BATCH_SIZE
      ? parseInt(process.env.DEBENHAMS_INVENTORY_BATCH_SIZE, 10)
      : undefined,
  };

  const result = debenhamsConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Debenhams configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Create Debenhams configuration from partial config object.
 * Useful for testing or programmatic configuration.
 */
export function createDebenhamsConfig(config: Partial<DebenhamsConfig>): DebenhamsConfig {
  return debenhamsConfigSchema.parse(config);
}
