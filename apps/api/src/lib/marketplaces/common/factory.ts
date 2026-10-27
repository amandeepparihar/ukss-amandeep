/**
 * Marketplace Adapter Factory
 * 
 * Creates the appropriate adapter based on marketplace type
 */

import { MarketplaceAdapter } from './base-adapter';
import { EbayAdapter } from '../ebay/adapter';
import { MiraklAdapter } from '../mirakl/adapter';
import { OnBuyAdapter } from '../onbuy/adapter';
import { SportdealAdapter } from '../sportdeal/adapter';
import { AllegroAdapter } from '../allegro/adapter';
import { SellerDynamicsAdapter } from '../seller-dynamics/adapter';
import type { MarketplaceConfig } from './types';
import { getLogger } from '../../logger-context';
import { MARKETPLACES, SUPPORTED_MARKETPLACES } from '@admin/shared';

/**
 * Create marketplace adapter instance based on marketplace type
 * 
 * @throws Error if marketplace is not supported
 */
export function createMarketplaceAdapter(
  marketplace: string,
  config: MarketplaceConfig
): MarketplaceAdapter {
  const marketplaceLower = marketplace.toLowerCase();

  getLogger('marketplace-factory').info({ marketplace: marketplaceLower, storeId: config.storeId }, 'Creating marketplace adapter');

  switch (marketplaceLower) {
    case MARKETPLACES.EBAY:
      return new EbayAdapter(config);
    
    case MARKETPLACES.DEBENHAMS:
      return new MiraklAdapter(config);
    
    case MARKETPLACES.ONBUY:
      return new OnBuyAdapter(config);
    
    case MARKETPLACES.SPORTDEAL:
      return new SportdealAdapter(config);

    case MARKETPLACES.ALLEGRO:
      return new AllegroAdapter(config);

    case MARKETPLACES.SELLER_DYNAMICS:
      return new SellerDynamicsAdapter(config);

    default:
      throw new Error(`Unknown marketplace type: ${marketplace}. Supported marketplaces: ${SUPPORTED_MARKETPLACES.join(', ')}`);
  }
}

/**
 * Check if a marketplace is implemented
 */
export function isMarketplaceImplemented(marketplace: string): boolean {
  return SUPPORTED_MARKETPLACES.includes(marketplace.toLowerCase() as any);
}

/**
 * Get list of supported marketplaces
 */
export function getSupportedMarketplaces(): readonly string[] {
  return SUPPORTED_MARKETPLACES;
}

/**
 * Get list of all marketplaces
 */
export function getAllMarketplaces(): string[] {
  return [...SUPPORTED_MARKETPLACES];
}
