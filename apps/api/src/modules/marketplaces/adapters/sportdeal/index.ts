/**
 * Sportdeal Marketplace Adapter
 *
 * Exports for Sportdeal marketplace integration.
 */

// Configuration
export {
  sportdealConfigSchema,
  loadSportdealConfig,
  createSportdealConfig,
  type SportdealConfig,
  DEFAULT_SPORTDEAL_CONFIG,
} from './sportdeal.config';

// Types
export type {
  SportdealProductRow,
  SportdealInventoryItem,
  SportdealXmlProduct,
  SportdealXmlInventoryItem,
  SportdealFeedResult,
  SportdealInventoryFeedResult,
  SportdealFeedOptions,
  SportdealInventoryFeedOptions,
} from './sportdeal.types';

// Feed Generators
export {
  SportdealFeedGenerator,
  createSportdealFeedGenerator,
} from './feed-generator';

export {
  SportdealInventoryFeedGenerator,
  createSportdealInventoryFeedGenerator,
} from './inventory-feed';

// Adapter
export {
  SportdealAdapter,
  createSportdealAdapter,
  type SportdealAdapterConfig,
} from './sportdeal.adapter';
