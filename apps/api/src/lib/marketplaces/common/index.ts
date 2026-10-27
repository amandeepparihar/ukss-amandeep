/**
 * Common Marketplace Utilities
 */

export { MarketplaceAdapter, type MarketplaceSyncResult } from './base-adapter';
export { 
  createMarketplaceAdapter, 
  isMarketplaceImplemented,
  getSupportedMarketplaces,
  getAllMarketplaces 
} from './factory';
export {
  getMarketplaceForStore,
  isSupportedMarketplace,
  getAllStoreMarketplaceMappings,
  type StoreMarketplaceInfo
} from './mapper';
export type { SyncResult, MarketplaceConfig, ListingItem } from './types';
export {
  getExchangeRate,
  convertFromGbp,
  applyMarginPercent,
  calculateMarketplacePrice,
  type ExchangeRateResult,
} from './currency-utils';
// Re-export marketplace constants from shared package for convenience
export { 
  MARKETPLACES, 
  SUPPORTED_MARKETPLACES, 
  ALL_MARKETPLACES,
  type Marketplace,
  type SupportedMarketplace 
} from '@admin/shared';