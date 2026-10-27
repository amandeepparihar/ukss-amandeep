/**
 * eBay OAuth 2.0 Token Management
 *
 * Handles OAuth token generation using refresh token flow.
 * Tokens are cached in memory for their lifetime (2 hours).
 *
 * Flow:
 * 1. Check if cached token exists and is not expired
 * 2. If expired, use refresh token to get new access token
 * 3. Cache new token for 110 minutes (10 min buffer before expiry)
 * 4. Return access token for API calls
 *
 * Environment Variables Required:
 * - EBAY_TEST_ENVIRONMENT: 'true' for sandbox, 'false' for live (controls endpoint selection)
 * - EBAY_API_AUTHORIZATION_SANDBOX / EBAY_API_AUTHORIZATION_LIVE: Base64-encoded AppID:CertID
 * - EBAY_API_REFRESH_TOKEN_SANDBOX / EBAY_API_REFRESH_TOKEN_LIVE: Long-lived refresh token
 * - EBAY_API_URL_SANDBOX / EBAY_API_URL_LIVE: Base API URL (OAuth endpoint derived from this)
 */

import axios from 'axios';
import { config } from '../../config';
import { createLogger } from '../logger';
import type { EbayOAuthTokenResponse } from '../../modules/ebay/ebay-api.types';

const logger = createLogger('ebay-oauth');

/**
 * Get eBay configuration values based on EBAY_TEST_ENVIRONMENT.
 * WHY: Senior's existing config uses separate _SANDBOX and _LIVE suffixed variables.
 * EBAY_TEST_ENVIRONMENT=true -> sandbox, EBAY_TEST_ENVIRONMENT=false -> live
 */
function getEbayOAuthConfig() {
  const isTestEnvironment = config.EBAY_TEST_ENVIRONMENT;

  // Select appropriate credentials based on environment
  const base64Auth = isTestEnvironment
    ? config.EBAY_API_AUTHORIZATION_SANDBOX
    : config.EBAY_API_AUTHORIZATION_LIVE;

  const refreshToken = isTestEnvironment
    ? config.EBAY_API_REFRESH_TOKEN_SANDBOX
    : config.EBAY_API_REFRESH_TOKEN_LIVE;

  // Build OAuth URL from base API URL
  const baseUrl = isTestEnvironment
    ? config.EBAY_API_URL_SANDBOX
    : config.EBAY_API_URL_LIVE;
  const oauthUrl = `${baseUrl}/identity/v1/oauth2/token`;

  return { base64Auth, refreshToken, oauthUrl, isTestEnvironment };
}

/**
 * Cached access token and expiry time.
 * Resets to null when token expires.
 */
interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp (ms)
}

let tokenCache: TokenCache | null = null;

/**
 * Token cache duration in milliseconds.
 * eBay tokens last 2 hours (7200s), we cache for 110 minutes (6600s) to add buffer.
 */
const TOKEN_CACHE_DURATION_MS = 110 * 60 * 1000; // 110 minutes

/**
 * Get a valid eBay OAuth access token.
 *
 * This function uses the refresh token to obtain an access token.
 * Tokens are cached in memory for 110 minutes (eBay tokens expire in 120 minutes).
 *
 * @returns Promise resolving to access token string
 * @throws Error if OAuth configuration is missing or token request fails
 *
 * @example
 * const token = await getEbayAccessToken();
 * // Use token in X-EBAY-API-IAF-TOKEN header
 */
export async function getEbayAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    logger.debug('Using cached eBay access token');
    return tokenCache.accessToken;
  }

  // Get config values based on environment (sandbox vs live)
  const { base64Auth, refreshToken, oauthUrl, isTestEnvironment } = getEbayOAuthConfig();

  if (!base64Auth || !refreshToken) {
    const envSuffix = isTestEnvironment ? 'SANDBOX' : 'LIVE';
    const msg = `Missing required eBay OAuth configuration: EBAY_API_AUTHORIZATION_${envSuffix} or EBAY_API_REFRESH_TOKEN_${envSuffix}`;
    logger.error({ isTestEnvironment }, msg);
    throw new Error(msg);
  }

  logger.info({ isTestEnvironment, oauthUrl }, 'Requesting new eBay access token from OAuth endpoint');

  try {
    // Debug logging (redact sensitive credentials)
    logger.debug({
      isTestEnvironment,
      base64AuthLength: base64Auth.length,
      refreshTokenLength: refreshToken.length,
    }, 'OAuth request details');

    // Request new access token
    // WHY: base64Auth is already Base64-encoded from config (EBAY_API_AUTHORIZATION_*)
    const response = await axios.post<EbayOAuthTokenResponse>(
      oauthUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken.trim(), // Trim whitespace from refresh token
        scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${base64Auth}`,
        },
        timeout: 30000, // 30 second timeout
      }
    );

    const accessToken = response.data.access_token;
    const expiresIn = response.data.expires_in; // Usually 7200 seconds (2 hours)

    if (!accessToken) {
      throw new Error('eBay OAuth response missing access_token');
    }

    // Cache the token (with 10 minute buffer before actual expiry)
    const expiresAt = Date.now() + TOKEN_CACHE_DURATION_MS;
    tokenCache = { accessToken, expiresAt };

    logger.info({
      expiresIn,
      cacheExpiresInMinutes: Math.round(TOKEN_CACHE_DURATION_MS / 60000),
    }, 'eBay access token obtained and cached');

    return accessToken;
  } catch (error) {
    // Clear cache on error
    tokenCache = null;

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      logger.error({
        status,
        error: errorData,
        message: error.message,
      }, 'Failed to obtain eBay access token');

      throw new Error(
        `eBay OAuth failed: ${status || 'Network Error'} - ${errorData?.error_description || error.message}`
      );
    }

    logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Unexpected error in eBay OAuth');
    throw error;
  }
}

/**
 * Clear the cached token (useful for testing or forcing refresh).
 *
 * @example
 * clearEbayTokenCache();
 * // Next call to getEbayAccessToken() will fetch a new token
 */
export function clearEbayTokenCache(): void {
  tokenCache = null;
  logger.debug('eBay token cache cleared');
}

/**
 * Check if we have a valid cached token (without requesting a new one).
 *
 * @returns True if cached token exists and is not expired
 *
 * @example
 * if (hasValidEbayToken()) {
 *   console.log('Token is cached and valid');
 * }
 */
export function hasValidEbayToken(): boolean {
  return tokenCache !== null && tokenCache.expiresAt > Date.now();
}

/**
 * Get the eBay Trading API endpoint based on EBAY_TEST_ENVIRONMENT.
 *
 * WHY: Senior's config uses separate _SANDBOX and _LIVE endpoints.
 * EBAY_TEST_ENVIRONMENT=true -> sandbox endpoint, false -> live endpoint
 *
 * @returns Trading API URL (e.g., https://api.sandbox.ebay.com/ws/api.dll)
 */
export function getEbayTradingApiEndpoint(): string {
  const isTestEnvironment = config.EBAY_TEST_ENVIRONMENT;

  return isTestEnvironment
    ? config.EBAY_TRADING_API_ENDPOINT_SANDBOX
    : config.EBAY_TRADING_API_ENDPOINT_LIVE;
}

/**
 * Check if we're using the eBay sandbox environment.
 *
 * @returns True if EBAY_TEST_ENVIRONMENT is set to 'true' or '1'
 */
export function isEbaySandboxEnvironment(): boolean {
  return config.EBAY_TEST_ENVIRONMENT;
}
