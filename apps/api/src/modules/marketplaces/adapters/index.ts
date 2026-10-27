/**
 * Marketplace Adapters
 *
 * Re-exports adapter types and base class.
 *
 * Marketplace-specific adapters will be added here as they are implemented:
 * - FruugoAdapter
 * - BaseLinkerAdapter
 * - ShopifyAdapter
 * - etc.
 *
 * @example
 * import { BaseMarketplaceAdapter, type MarketplaceAdapter } from '../adapters';
 */

// Types
export type {
  MarketplaceAdapter,
  MarketplaceAdapterConfig,
  MarketplaceCapabilities,
  IntegrationPattern,
  QualificationConfig,
  FeedFormat,
  FeedDeliveryMethod,
  ProductData,
  InventoryData,
  PriceData,
  SkuMapping,
  SyncResult,
  FeedResult,
  ValidationResult,
} from './types';

// Helper functions
export { createCapabilities } from './types';

// Base adapter class
export { BaseMarketplaceAdapter } from './base.adapter';
