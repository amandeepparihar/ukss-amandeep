import { createLogger } from '../../lib/logger';
import { MarketplaceSyncTracker } from './utils/sync-tracker';

const logger = createLogger('marketplace-dashboard');

interface MarketplaceRegistryEntry {
  name: string;
  marketplaceId: string;
  storeId: number;
  pattern: 'feed' | 'api' | 'hybrid';
  productCreationMethod: string;
}

// Registry entries must match the readonly properties on each adapter class.
// If adding a new marketplace, add an entry here AND create the adapter.
const MARKETPLACE_REGISTRY: MarketplaceRegistryEntry[] = [
  {
    name: 'Fruugo',
    marketplaceId: 'fruugo',
    storeId: 95,
    pattern: 'feed',
    productCreationMethod: 'Feed: CSV product datafeed served via HTTP. Fruugo pulls it periodically. Inventory synced via API push (XML).',
  },
  {
    name: 'Sportdeal',
    marketplaceId: 'sportdeal',
    storeId: 127,
    pattern: 'feed',
    productCreationMethod: 'Feed: XML product feed served via CDN/FTP. Sportdeal pulls it. Inventory synced via separate XML delta feed.',
  },
  {
    name: 'Debenhams',
    marketplaceId: 'debenhams',
    storeId: 150,
    pattern: 'api',
    productCreationMethod: 'Manual: Products created on Mirakl portal by team member. Offers created via O11 API. Inventory/price synced via OF24 API.',
  },
];

export interface MarketplaceDashboardItem {
  name: string;
  marketplaceId: string;
  storeId: number;
  pattern: string;
  productCreationMethod: string;
  counts: {
    total: number;
    active: number;
    newItems: number;
    notCreatedOnMarketplace: number;
    synced: number;
    failed: number;
    syncNotAllowed: number;
  };
}

export async function getDashboardData(): Promise<MarketplaceDashboardItem[]> {
  logger.info('Fetching marketplace dashboard data');

  const results = await Promise.all(
    MARKETPLACE_REGISTRY.map(async (marketplace) => {
      const tracker = new MarketplaceSyncTracker({
        storeId: marketplace.storeId,
        marketplaceName: marketplace.marketplaceId,
      });

      const counts = await tracker.getCounts();

      return {
        name: marketplace.name,
        marketplaceId: marketplace.marketplaceId,
        storeId: marketplace.storeId,
        pattern: marketplace.pattern,
        productCreationMethod: marketplace.productCreationMethod,
        counts: {
          total: counts.total,
          active: counts.active,
          newItems: counts.newItems,
          notCreatedOnMarketplace: counts.notCreatedOnMarketplace,
          synced: counts.synced,
          failed: counts.failed,
          syncNotAllowed: counts.syncNotAllowed,
        },
      };
    })
  );

  logger.info({ marketplaceCount: results.length }, 'Marketplace dashboard data fetched');

  return results;
}
