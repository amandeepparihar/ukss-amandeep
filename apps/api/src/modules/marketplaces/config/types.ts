/**
 * Marketplace Configuration Types
 *
 * Defines the configuration schema for all marketplace integrations.
 * Each marketplace has its own config following this structure.
 */

import type { MarketplaceCapabilities } from '../adapters/types';

/**
 * Authentication configuration.
 * Supports multiple auth methods discovered across marketplaces.
 */
export interface AuthConfig {
  /** Type of authentication to use */
  type: 'none' | 'basic' | 'token-header' | 'token-body' | 'oauth2';

  // Basic Auth (Fruugo, Sportdeal)
  /** Username for Basic Auth */
  username?: string;
  /** Password for Basic Auth */
  password?: string;

  // Token Auth (BaseLinker, OnBuy)
  /** API token */
  token?: string;
  /** Parameter name if token goes in body (e.g., 'token' for BaseLinker) */
  tokenParam?: string;
  /** Token prefix for header auth (default: 'Bearer') */
  tokenPrefix?: string;

  // OAuth 2.0 (Walmart, Shopify, OnBuy)
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** OAuth token endpoint URL */
  tokenUrl?: string;
  /** OAuth scope (optional) */
  scope?: string;
}

/**
 * Rate limiting configuration.
 * Prevents hitting marketplace API rate limits.
 */
export interface RateLimitConfig {
  /**
   * Rate limiting strategy:
   * - 'fixed': Wait X milliseconds between each request
   * - 'burst': Allow N requests per window, then wait
   */
  strategy: 'fixed' | 'burst';

  /** Maximum requests allowed per minute */
  requestsPerMinute: number;

  /** Delay between requests in ms (for 'fixed' strategy) */
  delayMs?: number;

  /** Time window in ms (for 'burst' strategy, default: 60000) */
  windowMs?: number;
}

/**
 * Retry configuration for transient failures.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;

  /** Base delay between retries in ms (default: 1000) */
  baseDelayMs: number;

  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs: number;

  /** Whether to add random jitter to delays (default: true) */
  jitter: boolean;
}

/**
 * Feed generation configuration.
 * For marketplaces that use file-based feeds.
 */
export interface FeedConfig {
  /** Directory where feed files are stored */
  directory: string;

  /** Directory for temporary files during generation */
  tempDirectory: string;

  /** Whether to archive old feed files */
  archiveOldFiles: boolean;

  /** File name pattern (can include {date} placeholder) */
  fileNamePattern?: string;
}

/**
 * Complete marketplace configuration.
 * Each marketplace adapter receives this config.
 */
export interface MarketplaceConfig {
  // ========================================
  // Identity
  // ========================================

  /** Unique name of the marketplace (e.g., 'fruugo', 'onbuy') */
  name: string;

  /** Store ID in UKSS database */
  storeId: number;

  /** Whether this marketplace is enabled */
  enabled: boolean;

  // ========================================
  // Authentication
  // ========================================

  /** Authentication configuration */
  auth: AuthConfig;

  // ========================================
  // API Settings
  // ========================================

  /** Base URL for marketplace API */
  apiBaseUrl: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeout: number;

  // ========================================
  // Rate Limiting & Retry
  // ========================================

  /** Rate limiting configuration (optional) */
  rateLimit?: RateLimitConfig;

  /** Retry configuration (optional, has defaults) */
  retry?: RetryConfig;

  // ========================================
  // Batch Settings
  // ========================================

  /** Number of items to process per batch (default: 100) */
  batchSize: number;

  /** Maximum concurrent requests (default: 1) */
  concurrency?: number;

  // ========================================
  // Feed Settings (for feed-based marketplaces)
  // ========================================

  /** Feed generation configuration */
  feed?: FeedConfig;

  // ========================================
  // Capabilities
  // ========================================

  /** What operations this marketplace supports */
  capabilities: MarketplaceCapabilities;

  // ========================================
  // Marketplace-Specific Settings
  // ========================================

  /** Additional marketplace-specific settings */
  settings?: Record<string, unknown>;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Partial<MarketplaceConfig> = {
  enabled: true,
  timeout: 30000,
  batchSize: 100,
  concurrency: 1,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
  },
};

/**
 * Default auth configuration.
 */
export const DEFAULT_AUTH_CONFIG: Partial<AuthConfig> = {
  type: 'none',
  tokenPrefix: 'Bearer',
};

/**
 * Default rate limit configuration.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: Partial<RateLimitConfig> = {
  strategy: 'fixed',
  requestsPerMinute: 60,
  windowMs: 60000,
};
