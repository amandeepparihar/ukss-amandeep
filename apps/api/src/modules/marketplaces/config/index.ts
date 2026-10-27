/**
 * Marketplace Configuration
 *
 * Re-exports configuration types and defaults.
 *
 * @example
 * import { type MarketplaceConfig, DEFAULT_CONFIG } from '../config';
 */

export type {
  MarketplaceConfig,
  AuthConfig,
  RateLimitConfig,
  RetryConfig,
  FeedConfig,
} from './types';

export {
  DEFAULT_CONFIG,
  DEFAULT_AUTH_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
} from './types';
