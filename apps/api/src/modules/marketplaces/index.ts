/**
 * Marketplaces Module
 *
 * Base framework for marketplace integrations.
 * Provides reusable utilities for both feed-based and API-based marketplaces.
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   BaseMarketplaceAdapter,
 *   HttpClient,
 *   xmlUtils,
 *   csvUtils,
 *   type MarketplaceAdapter,
 *   type MarketplaceConfig,
 * } from '@/modules/marketplaces';
 * ```
 *
 * ## Creating a New Adapter
 *
 * ```typescript
 * import {
 *   BaseMarketplaceAdapter,
 *   createCapabilities,
 *   type MarketplaceCapabilities,
 *   type InventoryData,
 *   type SyncResult,
 *   type ValidationResult,
 * } from '@/modules/marketplaces';
 *
 * export class MyMarketplaceAdapter extends BaseMarketplaceAdapter {
 *   readonly marketplaceId = 'my-marketplace';
 *   readonly name = 'My Marketplace';
 *   readonly pattern = 'api';
 *
 *   getCapabilities(): MarketplaceCapabilities {
 *     return createCapabilities({
 *       inventorySync: true,
 *       priceSync: true,
 *     });
 *   }
 *
 *   async validateCredentials(): Promise<ValidationResult> {
 *     // Make test API call
 *   }
 *
 *   async syncInventory(inventory: InventoryData[]): Promise<SyncResult> {
 *     // Sync inventory to marketplace
 *   }
 * }
 * ```
 *
 * ## Using Utilities Directly
 *
 * ```typescript
 * import { HttpClient, xmlUtils, csvUtils } from '@/modules/marketplaces';
 *
 * // Create HTTP client
 * const client = new HttpClient({
 *   baseUrl: 'https://api.example.com',
 *   auth: { type: 'token-header', token: 'xxx' },
 *   rateLimit: { strategy: 'burst', requestsPerMinute: 100 },
 * });
 *
 * // Parse XML
 * const data = xmlUtils.parse<MyType>('<root>...</root>');
 *
 * // Build CSV
 * const csv = csvUtils.build(headers, rows);
 * ```
 *
 * @module marketplaces
 */

// Configuration
export type {
  MarketplaceConfig,
  AuthConfig,
  RateLimitConfig,
  RetryConfig,
  FeedConfig,
} from './config';

export {
  DEFAULT_CONFIG,
  DEFAULT_AUTH_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
} from './config';

// Adapters
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
} from './adapters';

export { BaseMarketplaceAdapter, createCapabilities } from './adapters';

// Utilities
export {
  // HTTP Client
  HttpClient,
  createHttpClient,
  type HttpClientConfig,
  type RequestOptions,
  type HttpResponse,
  // Auth
  type AuthProvider,
  NoAuthProvider,
  BasicAuthProvider,
  TokenHeaderAuthProvider,
  TokenBodyAuthProvider,
  OAuth2Provider,
  AuthProviderFactory,
  type OAuth2Config,
  // Rate Limiting
  RateLimiter,
  createRateLimiter,
  type RateLimiterStatus,
  // Retry
  RetryHandler,
  createRetryHandler,
  // Batch Processing
  BatchProcessor,
  createBatchProcessor,
  chunk,
  type BatchConfig,
  type BatchResult,
  type BatchProgressCallback,
  // Sync Tracking
  MarketplaceSyncTracker,
  createMarketplaceSyncTracker,
  buildSyncWhereClause,
  defaultSyncFields,
  type SyncFields,
  type SyncStatus,
  type SyncQueryOptions,
  type SyncItemResult,
  type SyncResultSummary,
  type SyncHistoryRecord,
  type SyncTrackerConfig,
  type ListingForSync,
  // Data Formats
  xmlUtils,
  csvUtils,
  type CsvOptions,
  type CsvWriteOptions,
  fileUtils,
  // Errors
  MarketplaceError,
  HttpError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  ValidationError,
  ConfigurationError,
  ParseError,
  isRetryableError,
  wrapError,
} from './utils';

// Database types
export type {
  MarketplaceSyncStatus,
  MarketplaceSyncHistoryStatus,
  MarketplaceListing,
  MarketplaceSyncHistory,
  MarketplaceListingCreateInput,
  MarketplaceListingUpdateInput,
  MarketplaceSyncHistoryCreateInput,
} from './db';
