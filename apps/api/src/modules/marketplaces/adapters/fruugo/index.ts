/**
 * Fruugo Marketplace Adapter
 *
 * Exports for the Fruugo marketplace integration.
 *
 * @example
 * ```typescript
 * import { createFruugoAdapter, loadFruugoConfig } from '@/modules/marketplaces/adapters/fruugo';
 *
 * const config = loadFruugoConfig();
 * const adapter = createFruugoAdapter(config);
 *
 * // Generate product feed
 * const feedResult = await adapter.generateProductFeed();
 *
 * // Sync inventory
 * const inventoryResult = await adapter.syncInventory({ full: false });
 *
 * // Sync SKU IDs
 * const skuResult = await adapter.fetchSkuMappings();
 * ```
 */

// Main adapter
export { FruugoAdapter, createFruugoAdapter } from './fruugo.adapter';
export type { FruugoAdapterConfig } from './fruugo.adapter';

// Configuration
export {
  fruugoConfigSchema,
  loadFruugoConfig,
  createFruugoConfig,
  DEFAULT_FRUUGO_CONFIG,
} from './fruugo.config';
export type { FruugoConfig } from './fruugo.config';

// Types
export type {
  // Database types
  FruugoProductRow,
  FruugoInventoryItem,
  FruugoSkuMapping,
  // CSV types
  FruugoCsvRow,
  // API types
  FruugoListingsResponse,
  FruugoListingsSku,
  FruugoInventoryResponse,
  // Result types
  FruugoSyncItemResult,
  FruugoFeedResult,
  FruugoInventorySyncResult,
  FruugoSkuSyncResult,
  // Option types
  FruugoFeedOptions,
  FruugoInventorySyncOptions,
  FruugoSkuSyncOptions,
} from './fruugo.types';

export { FRUUGO_CSV_HEADERS } from './fruugo.types';

// Sub-components (for advanced usage)
export { FruugoFeedGenerator, createFruugoFeedGenerator } from './feed-generator';
export { FruugoInventorySync, createFruugoInventorySync } from './inventory-sync';
export { FruugoSkuSync, createFruugoSkuSync } from './sku-sync';
