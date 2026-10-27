/**
 * Walmart Marketplace API Client
 *
 * Handles authentication and produces standard headers for the Walmart Marketplace API
 * (https://developer.walmart.com/). Migrated from legacy SMS `app/controllers/app_controller.php`
 * `fetchWalmartAccessToken` (PMS #160071).
 *
 * Auth quirks vs other marketplaces:
 * - Token endpoint uses HTTP Basic Auth header `Authorization: Basic base64(client_id:client_secret)`
 *   with body `grant_type=client_credentials` (form-urlencoded). The shared `OAuth2Provider` in
 *   `marketplaces/utils/auth-provider.ts` does NOT fit — that one sends creds in the body.
 * - Token request requires `WM_QOS.CORRELATION_ID` and `WM_SVC.NAME: Walmart Marketplace`.
 * - Subsequent API calls authenticate via `WM_SEC.ACCESS_TOKEN: <token>` (NOT Bearer) and require
 *   `WM_QOS.CORRELATION_ID` and `WM_SVC.NAME: <WALMART_STORE_NAME>` on every request.
 * - Tokens are short-lived (15 min); we cache with a 60-second buffer like OnBuyClient.
 */

import { config } from '../../../config';
import { getLogger } from '../../logger-context';
import { nanoid } from 'nanoid';

interface CachedToken {
  token: string;
  expiresAt: number; // unix seconds
}

export class WalmartClient {
  private readonly baseUrl: string;
  private readonly storeName: string;
  private readonly isTestEnv: boolean;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private cachedToken?: CachedToken;

  constructor() {
    this.isTestEnv = config.WALMART_TEST_ENVIRONMENT;
    this.baseUrl = this.isTestEnv ? config.WALMART_API_URL_TEST : config.WALMART_API_URL;
    this.storeName = config.WALMART_STORE_NAME;
    this.clientId = this.isTestEnv ? config.WALMART_API_CLIENT_ID_TEST : config.WALMART_CLIENT_ID;
    this.clientSecret = this.isTestEnv
      ? config.WALMART_API_CLIENT_SECRET_TEST
      : config.WALMART_CLIENT_SECRET;

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        `Walmart API credentials not configured (test=${this.isTestEnv}). Set WALMART_CLIENT_ID/_SECRET or WALMART_API_CLIENT_ID_TEST/_SECRET_TEST.`
      );
    }

    getLogger('walmart-client').info(
      {
        environment: this.isTestEnv ? 'sandbox' : 'production',
        baseUrl: this.baseUrl,
        storeName: this.storeName,
      },
      'Walmart API client initialized'
    );
  }

  /** Base URL for the active environment, e.g. `https://marketplace.walmartapis.com`. No trailing slash. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Returns the standard headers required for any authenticated Walmart Marketplace API call.
   * The caller passes the access token (use `fetchAccessToken()` first).
   */
  buildApiHeaders(accessToken: string, correlationId: string): Record<string, string> {
    return {
      'WM_SEC.ACCESS_TOKEN': accessToken,
      'WM_QOS.CORRELATION_ID': correlationId,
      'WM_SVC.NAME': this.storeName,
      Accept: 'application/json',
    };
  }

  /**
   * Generate a Walmart-style correlation id (matches legacy `rand(11111, 99999) . time()` format
   * loosely — we use nanoid for entropy).
   */
  generateCorrelationId(prefix = 'WALMART'): string {
    return `${prefix}_${Date.now()}_${nanoid(8)}`;
  }

  /**
   * Fetch a Walmart Marketplace OAuth2 access token. Cached per-instance with a 60s expiry buffer.
   * Mirrors the legacy `fetchWalmartAccessToken` flow byte-for-byte.
   *
   * @param jobId Caller-supplied id for tracing. Used as `WM_QOS.CORRELATION_ID`.
   */
  async fetchAccessToken(jobId: string = 'SYNC'): Promise<string> {
    const correlationId = this.generateCorrelationId('WALMART_AUTH');

    if (this.cachedToken) {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = this.cachedToken.expiresAt - now;
      if (expiresIn > 60) {
        getLogger('walmart-client').debug(
          { correlationId, jobId, expiresIn },
          'Using cached Walmart access token'
        );
        return this.cachedToken.token;
      }
    }

    const url = `${this.baseUrl}/v3/token`;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    getLogger('walmart-client').info(
      { correlationId, jobId, url, environment: this.isTestEnv ? 'sandbox' : 'production' },
      'Fetching Walmart access token'
    );

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basicAuth}`,
          'WM_QOS.CORRELATION_ID': jobId,
          'WM_SVC.NAME': 'Walmart Marketplace',
        },
        body: 'grant_type=client_credentials',
      });

      const duration = Date.now() - startTime;
      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      // Raw response is logged at debug only (contains the access token — PII).
      getLogger('walmart-client').debug(
        { correlationId, jobId, duration, status: response.status, response: data },
        'Walmart token response'
      );

      if (!response.ok) {
        const message =
          data.error_description || data.error || `HTTP ${response.status}`;
        throw new Error(`Walmart auth failed: ${message}`);
      }

      if (!data.access_token) {
        throw new Error('Invalid Walmart auth response: missing access_token');
      }

      // Walmart returns expires_in as relative seconds (default 900 = 15 min). Convert to absolute.
      const expiresIn = data.expires_in ?? 900;
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

      this.cachedToken = { token: data.access_token, expiresAt };

      getLogger('walmart-client').info(
        { correlationId, jobId, expiresIn, duration },
        'Walmart access token fetched and cached'
      );

      return data.access_token;
    } catch (error) {
      const duration = Date.now() - startTime;
      getLogger('walmart-client').error(
        {
          correlationId,
          jobId,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to fetch Walmart access token'
      );
      throw error;
    }
  }
}

export function createWalmartClient(): WalmartClient {
  return new WalmartClient();
}
