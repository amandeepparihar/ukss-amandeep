/**
 * Base Marketplace Adapter
 * 
 * Abstract interface that all marketplace adapters must implement
 * 
 * @taskId #165004
 */

import type { MarketplaceConfig, ListingItem, ListingNeedingSync } from './types';

export interface MarketplaceSyncResult {
  successCount: number;
  failureCount: number;
  errors: string[];
}

export abstract class MarketplaceAdapter {
  protected config: MarketplaceConfig;

  constructor(config: MarketplaceConfig) {
    this.config = config;
  }

  /**
   * @taskId #165004
   * 
   * Sync listings to the marketplace.
   * Each adapter implements its own sync logic.
   * 
   * @param listings - Typed array of listings from database with all required fields
   * @returns Sync result with success/failure counts and errors
   */
  abstract syncListings(
    listings: ListingNeedingSync[]
  ): Promise<MarketplaceSyncResult>;

  /**
   * Get marketplace-specific name for logging
   */
  abstract getMarketplaceName(): string;
}
