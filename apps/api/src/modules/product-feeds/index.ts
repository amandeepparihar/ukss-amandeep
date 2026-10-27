/**
 * Product Feeds Module - Public API
 *
 * Generates multi-country XML/CSV product feeds for Google Merchant Center
 * and Microsoft Advertising. See documentation/PRODUCT_FEED_MIGRATION_PLAN.md.
 */

export * from './product-feeds.types.js';
export * from './product-feeds.constants.js';
export { getProductFeedsConfig } from './product-feeds.config.js';
export type { ProductFeedsConfig, SftpCredentials } from './product-feeds.config.js';
