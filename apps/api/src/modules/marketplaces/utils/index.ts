/**
 * Marketplace Utilities
 *
 * Re-exports all utility modules for convenient importing.
 *
 * @example
 * import { HttpClient, xmlUtils, csvUtils } from '../utils';
 */

// HTTP Client and related
export {
  HttpClient,
  createHttpClient,
  type HttpClientConfig,
  type RequestOptions,
  type HttpResponse,
} from './http-client';

// Authentication
export {
  type AuthProvider,
  NoAuthProvider,
  BasicAuthProvider,
  TokenHeaderAuthProvider,
  TokenBodyAuthProvider,
  OAuth2Provider,
  AuthProviderFactory,
  type OAuth2Config,
} from './auth-provider';

// Rate Limiting
export {
  RateLimiter,
  createRateLimiter,
  type RateLimiterStatus,
} from './rate-limiter';

// Retry Handling
export { RetryHandler, createRetryHandler } from './retry-handler';

// Batch Processing
export {
  BatchProcessor,
  createBatchProcessor,
  chunk,
  type BatchConfig,
  type BatchResult,
  type BatchProgressCallback,
} from './batch-processor';

// Sync Tracking
export {
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
} from './sync-tracker';

// Data Format Utilities
export { xmlUtils } from './xml.utils';
export { csvUtils, type CsvOptions, type CsvWriteOptions } from './csv.utils';
export { fileUtils, StreamingFileWriter } from './file.utils';

// Error Classes
export {
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
} from './errors';
