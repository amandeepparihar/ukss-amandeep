/**
 * Debenhams/Mirakl Marketplace Adapter
 *
 * Exports for the Debenhams marketplace integration.
 *
 * @example
 * ```typescript
 * import { createDebenhamsAdapter, loadDebenhamsConfig } from '@/modules/marketplaces/adapters/debenhams';
 *
 * const config = loadDebenhamsConfig();
 * const adapter = createDebenhamsAdapter(config);
 *
 * // Populate listings (syncAllowed=false)
 * const populateResult = await adapter.populateListings();
 *
 * // Create offers on Mirakl (flips syncAllowed=true on success)
 * const offerResult = await adapter.createOffers();
 *
 * // Sync inventory (only syncAllowed=true items)
 * const inventoryResult = await adapter.syncInventory({ full: true });
 * ```
 */

// Main adapter
export { DebenhamsAdapter, createDebenhamsAdapter } from './debenhams.adapter';
export type { DebenhamsAdapterConfig } from './debenhams.adapter';

// Configuration
export {
  debenhamsConfigSchema,
  loadDebenhamsConfig,
  createDebenhamsConfig,
} from './debenhams.config';
export type { DebenhamsConfig } from './debenhams.config';

// Types
export type {
  // Mirakl API types
  MiraklOffer,
  MiraklOfferCreateRequest,
  MiraklOfferCreateResponse,
  MiraklInventoryUpdateRequest,
  MiraklInventoryUpdateResponse,
  MiraklOfferUpdate,
  MiraklOfferCreateResponseItem,
  MiraklInventoryUpdateResponseItem,
  // Result types
  DebenhamsOfferCreateResult,
  DebenhamsInventorySyncResult,
  // Option types
  DebenhamsOfferCreateOptions,
  DebenhamsInventorySyncOptions,
} from './debenhams.types';
