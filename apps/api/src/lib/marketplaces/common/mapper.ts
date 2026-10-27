/**
 * Marketplace Mapper Utility
 * 
 * Maps store IDs to marketplace types based on configuration
 */

import { config } from '../../../config';
import { getLogger } from '../../logger-context';
import { SUPPORTED_MARKETPLACES } from '@admin/shared';

export interface StoreMarketplaceInfo {
  storeId: number;
  marketplace: string;
}

/**
 * Get marketplace type for a given store ID
 * @throws Error if store is not found in configuration
 */
export function getMarketplaceForStore(storeId: number): string {
  try {
    const marketplaceMap = JSON.parse(config.MARKETPLACE_STORE_TYPE_MAP);
    
    if (!marketplaceMap || !marketplaceMap[storeId]) {
      getLogger('marketplace-mapper').error(
        { storeId, availableStores: Object.keys(marketplaceMap || {}) },
        'Store ID not found in MARKETPLACE_STORE_TYPE_MAP'
      );
      throw new Error(`Store ID ${storeId} not found in marketplace configuration. Please add it to MARKETPLACE_STORE_TYPE_MAP environment variable.`);
    }

    const marketplace = marketplaceMap[storeId];
    getLogger('marketplace-mapper').info({ storeId, marketplace }, 'Resolved marketplace for store');
    
    return marketplace.toLowerCase();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Store ID')) {
      throw error; // Re-throw our custom error
    }
    
    getLogger('marketplace-mapper').error({ storeId, error }, 'Failed to parse MARKETPLACE_STORE_TYPE_MAP');
    throw new Error(`Invalid MARKETPLACE_STORE_TYPE_MAP configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate that a marketplace type is supported
 */
export function isSupportedMarketplace(marketplace: string): boolean {
  return SUPPORTED_MARKETPLACES.includes(marketplace.toLowerCase() as any);
}

/**
 * Get all configured store-marketplace mappings
 */
export function getAllStoreMarketplaceMappings(): Record<number, string> {
  try {
    const marketplaceMap = JSON.parse(config.MARKETPLACE_STORE_TYPE_MAP);
    return marketplaceMap || {};
  } catch (error) {
    getLogger('marketplace-mapper').error({ error }, 'Failed to parse MARKETPLACE_STORE_TYPE_MAP');
    return {};
  }
}
