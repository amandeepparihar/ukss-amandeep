/**
 * OnBuy API Client
 * 
 * Handles authentication and API calls to OnBuy marketplace
 * https://onbuy.com/gb/developers/
 */

import { config } from '../../../config';
import { getLogger } from '../../logger-context';
import { nanoid } from 'nanoid';

export interface OnBuyItem {
  sku: string;
  stock?: number;
  price?: string;  // OnBuy expects string with 2 decimals (e.g., "25.99")
}

export interface OnBuyApiResponse {
  success: boolean;
  response: any;
  request: any;
  error?: string;
  errorCode?: string;
  correlationId?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class OnBuyClient {
  private baseUrl: string;
  private isTestEnv: boolean;
  private marketplace: string;
  private consumerKey: string;
  private secretKey: string;
  private siteId: string;
  private cachedToken?: CachedToken;

  constructor(marketplace: string = 'onbuy') {
    this.marketplace = marketplace.toLowerCase();
    this.isTestEnv = config.ONBUY_TEST_ENVIRONMENT;

    // Set credentials based on environment
    this.consumerKey = this.isTestEnv
      ? config.ONBUY_API_CONSUMER_KEY_TEST
      : config.ONBUY_API_CONSUMER_KEY_LIVE;

    this.secretKey = this.isTestEnv
      ? config.ONBUY_API_SECRET_KEY_TEST
      : config.ONBUY_API_SECRET_KEY_LIVE;

    this.baseUrl = config.ONBUY_API_BASE_URL;
    this.siteId = config.ONBUY_SITE_ID;

    // Validate configuration
    if (!this.consumerKey || !this.secretKey) {
      throw new Error('OnBuy API credentials not configured');
    }

    getLogger('marketplace-sync-onbuy').info(
      {
        marketplace: this.marketplace,
        environment: this.isTestEnv ? 'test' : 'live',
        baseUrl: this.baseUrl,
        siteId: this.siteId,
      },
      'OnBuy API client initialized'
    );
  }

  /**
   * Parse a fetch Response as JSON defensively.
   *
   * OnBuy's gateway sometimes returns an HTML/plain-text error page (e.g. a 502
   * "upstream connect error" or an HTML "<html>..." page) instead of JSON.
   * Calling response.json() directly then throws a cryptic
   * "Unexpected token '<'" before we ever see the status code. This reads the
   * body once and surfaces a clear, actionable error including the HTTP status
   * and a short snippet of the body.
   */
  private async parseJsonResponse(response: Response, context: string): Promise<any> {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
      throw new Error(
        `OnBuy ${context} returned non-JSON response (HTTP ${response.status}): ${snippet}`
      );
    }
  }

  /**
   * Fetch OnBuy access token
   * Uses token caching to avoid unnecessary API calls
   */
  async fetchAccessToken(jobId: string = 'SYNC'): Promise<string> {
    const correlationId = `ONBUY_AUTH_${Date.now()}_${nanoid(8)}`;

    // Check if cached token is still valid (with 60 second buffer)
    if (this.cachedToken) {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = this.cachedToken.expiresAt - now;

      if (expiresIn > 60) {
        getLogger('marketplace-sync-onbuy').debug(
          { correlationId, jobId, expiresIn },
          'Using cached OnBuy access token'
        );
        return this.cachedToken.token;
      } else {
        getLogger('marketplace-sync-onbuy').info(
          { correlationId, jobId },
          'Cached token expired or expiring soon, fetching new token'
        );
      }
    }

    getLogger('marketplace-sync-onbuy').info(
      { correlationId, jobId, marketplace: this.marketplace },
      'Fetching OnBuy access token'
    );

    const url = `${this.baseUrl}auth/request-token`;
    const requestPayload = {
      consumer_key: this.consumerKey,
      secret_key: this.secretKey,
    };

    // Log request (without sensitive data)
    getLogger('marketplace-sync-request-onbuy').info(
      {
        correlationId,
        jobId,
        marketplace: this.marketplace,
        url,
        method: 'POST',
        payload: {
          consumer_key: this.consumerKey.substring(0, 10) + '...',
          secret_key: '***REDACTED***',
        },
      },
      'OnBuy Auth Request'
    );

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      const duration = Date.now() - startTime;
      const data = await this.parseJsonResponse(response, 'auth');

      // Log response
      getLogger('marketplace-sync-response-onbuy').info(
        {
          correlationId,
          jobId,
          marketplace: this.marketplace,
          duration,
          status: response.status,
          response: data,
        },
        'OnBuy Auth Response'
      );

      if (!response.ok) {
        const errorMessage = data.error || data.message || 'Authentication failed';
        throw new Error(`OnBuy auth failed: ${errorMessage} (${response.status})`);
      }

      if (!data.access_token || !data.expires_at) {
        throw new Error('Invalid OnBuy auth response: missing access_token or expires_at');
      }

      // Cache token
      this.cachedToken = {
        token: data.access_token,
        expiresAt: data.expires_at,
      };

      const expiresIn = data.expires_at - Math.floor(Date.now() / 1000);
      getLogger('marketplace-sync-onbuy').info(
        { correlationId, jobId, expiresIn },
        'OnBuy access token fetched and cached successfully'
      );

      return data.access_token;
    } catch (error) {
      const duration = Date.now() - startTime;

      getLogger('marketplace-sync-response-onbuy').error(
        {
          correlationId,
          jobId,
          marketplace: this.marketplace,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
        'OnBuy Auth Error'
      );

      getLogger('marketplace-sync-onbuy').error(
        { correlationId, jobId, error },
        'Failed to fetch OnBuy access token'
      );

      throw error;
    }
  }

  /**
   * Update listings by SKU (bulk update)
   * 
   * @param storeId - Store ID for logging
   * @param items - Array of OnBuy items to update
   * @param accessToken - OnBuy access token
   * @returns API response
   */
  async updateListingsBySKU(
    storeId: number,
    items: OnBuyItem[],
    accessToken: string
  ): Promise<OnBuyApiResponse> {
    const correlationId = `${this.marketplace.toUpperCase()}_${storeId}_${Date.now()}_${nanoid(8)}`;

    // Validate inputs
    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        response: null,
        request: null,
        error: 'No items provided for sync',
        errorCode: 'VALIDATION_EMPTY_ITEMS',
      };
    }

    if (items.length > 1000) {
      return {
        success: false,
        response: null,
        request: null,
        error: 'OnBuy API limit: maximum 1000 items per call',
        errorCode: 'VALIDATION_BATCH_SIZE_EXCEEDED',
      };
    }

    // Validate item format
    const validationError = this.validateItems(items);
    if (validationError) {
      return {
        success: false,
        response: null,
        request: null,
        error: validationError.message,
        errorCode: validationError.code,
      };
    }

    const url = `${this.baseUrl}listings/by-sku`;

    // Build request payload
    const listings = items.map((item) => {
      const listing: any = {
        sku: item.sku,
      };

      if (item.stock !== undefined && item.stock !== null) {
        listing.stock = item.stock;
      }

      if (item.price !== undefined && item.price !== null) {
        // Use price as-is (no rounding)
        listing.price = item.price;
      }

      return listing;
    });

    const requestPayload = {
      site_id: parseInt(this.siteId, 10),
      listings,
    };

    // Log request
    getLogger('marketplace-sync-request-onbuy').info(
      {
        correlationId,
        storeId,
        marketplace: this.marketplace,
        url,
        method: 'PUT',
        itemCount: items.length,
        siteId: this.siteId,
        payload: requestPayload,
      },
      'OnBuy Update Request'
    );

    const startTime = Date.now();

    try {
      getLogger('marketplace-sync-onbuy').debug(
        { correlationId, storeId, itemCount: items.length },
        'Calling OnBuy updateListingsBySKU API'
      );

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': accessToken,
        },
        body: JSON.stringify(requestPayload),
      });

      const duration = Date.now() - startTime;
      const data = await this.parseJsonResponse(response, 'update');

      // Log response
      getLogger('marketplace-sync-response-onbuy').info(
        {
          correlationId,
          storeId,
          marketplace: this.marketplace,
          duration,
          status: response.status,
          response: data,
        },
        'OnBuy Update Response'
      );

      getLogger('marketplace-sync-onbuy').debug(
        { correlationId, storeId, status: response.status, duration },
        'OnBuy API response received'
      );

      // Handle success
      if (response.ok) {
        return {
          success: true,
          response: data,
          request: requestPayload,
          correlationId,
        };
      }

      // Handle errors
      let errorCode = response.status.toString();
      let errorMessage = data.error || data.message || 'Unknown error';

      // Special handling for common errors
      if (response.status === 401) {
        errorCode = 'UNAUTHORIZED';
        errorMessage = 'OnBuy access token expired or invalid';
      } else if (response.status === 429) {
        errorCode = 'RATE_LIMIT_EXCEEDED';
        errorMessage = 'OnBuy rate limit exceeded';
      } else if (response.status === 422) {
        errorCode = 'VALIDATION_ERROR';
        errorMessage = `OnBuy validation error: ${errorMessage}`;
      } else if (response.status === 404) {
        errorCode = 'NOT_FOUND';
        errorMessage = 'One or more SKUs not found on OnBuy';
      }

      getLogger('marketplace-sync-onbuy').error(
        {
          correlationId,
          storeId,
          status: response.status,
          errorCode,
          errorMessage,
        },
        'OnBuy API returned error'
      );

      return {
        success: false,
        response: data,
        request: requestPayload,
        error: errorMessage,
        errorCode,
        correlationId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      getLogger('marketplace-sync-response-onbuy').error(
        {
          correlationId,
          storeId,
          marketplace: this.marketplace,
          duration,
          error: errorMessage,
        },
        'OnBuy API Exception'
      );

      getLogger('marketplace-sync-onbuy').error(
        { correlationId, storeId, error: errorMessage },
        'OnBuy API call failed with exception'
      );

      return {
        success: false,
        response: null,
        request: requestPayload,
        error: errorMessage,
        errorCode: 'API_EXCEPTION',
        correlationId,
      };
    }
  }

  /**
   * Validate OnBuy items
   */
  private validateItems(items: OnBuyItem[]): { code: string; message: string } | null {
    for (const item of items) {
      // Validate SKU
      if (!item.sku || item.sku.trim() === '') {
        return {
          code: 'VALIDATION_EMPTY_SKU',
          message: 'SKU cannot be empty',
        };
      }

      // Validate stock if provided
      if (item.stock !== undefined && item.stock !== null) {
        if (item.stock < 0) {
          return {
            code: 'VALIDATION_NEGATIVE_STOCK',
            message: `Stock cannot be negative: ${item.stock} for SKU ${item.sku}`,
          };
        }

        if (item.stock > 999999) {
          return {
            code: 'VALIDATION_STOCK_TOO_HIGH',
            message: `Stock exceeds maximum (999999): ${item.stock} for SKU ${item.sku}`,
          };
        }
      }

      // Validate price if provided
      if (item.price !== undefined && item.price !== null) {
        const priceNum = typeof item.price === 'string' ? parseFloat(item.price) : item.price;

        if (isNaN(priceNum) || priceNum <= 0) {
          return {
            code: 'VALIDATION_INVALID_PRICE',
            message: `Price must be greater than 0: ${item.price} for SKU ${item.sku}`,
          };
        }

        if (priceNum > 999999.99) {
          return {
            code: 'VALIDATION_PRICE_TOO_HIGH',
            message: `Price exceeds maximum (999999.99): ${item.price} for SKU ${item.sku}`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Split items into batches
   */
  createBatches<T>(items: T[], batchSize: number): T[][] {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return [];
    }

    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

/**
 * Create OnBuy client instance
 * @param marketplace - Marketplace name (defaults to 'onbuy')
 */
export function createOnBuyClient(marketplace: string = 'onbuy'): OnBuyClient {
  return new OnBuyClient(marketplace);
}
