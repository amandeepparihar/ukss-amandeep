/**
 * Base Resource Class
 *
 * Provides common CRUD operations for Shopify resources
 */

import { createAdminRestApiClient } from '@shopify/admin-api-client';
import { createLogger } from '../logger';
import { getRateLimiter } from '../shopify-sync/rate-limiter';
import { serializeError } from '../helpers/error-utils';
import type { ShopifyGetParams, ShopifyResponse } from './types';

const logger = createLogger('shopify-resource');

export abstract class BaseResource {
  protected shopDomain: string;
  protected accessToken: string;
  protected apiVersion: string;
  protected resourceName: string;
  protected resourceId?: string | number;
  protected rateLimiter;

  constructor(
    shopDomain: string,
    accessToken: string,
    apiVersion: string,
    resourceName: string,
    resourceId?: string | number
  ) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.resourceName = resourceName;
    this.resourceId = resourceId;
    this.rateLimiter = getRateLimiter(shopDomain);
  }

  /**
   * Get REST API client
   */
  protected getRestClient() {
    return createAdminRestApiClient({
      storeDomain: this.shopDomain,
      accessToken: this.accessToken,
      apiVersion: this.apiVersion,
    });
  }

  /**
   * Build resource path
   */
  protected getResourcePath(): string {
    if (this.resourceId) {
      // Shopify REST endpoints require the .json extension; list-endpoint callers
      // manage their own resourceName (e.g. 'orders.json') and never set resourceId.
      return `${this.resourceName}/${this.resourceId}.json`;
    }
    return this.resourceName;
  }

  /**
   * Convert params object to query string
   */
  protected buildQueryString(params?: ShopifyGetParams): string {
    if (!params || Object.keys(params).length === 0) {
      return '';
    }

    const queryParams = new URLSearchParams();
    
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Handle array parameters (e.g., ids[]=1&ids[]=2)
          value.forEach(v => queryParams.append(`${key}[]`, String(v)));
        } else {
          queryParams.append(key, String(value));
        }
      }
    }

    const queryString = queryParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Handle rate limiting
   */
  protected async throttle(): Promise<void> {
    await this.rateLimiter.throttle();
  }

  /**
   * Update rate limiter from response headers
   */
  protected handleRateLimit(headers: Headers): void {
    const headersObj: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    this.rateLimiter.handleResponse(headersObj);
  }

  /**
   * Build full API URL
   */
  protected buildApiUrl(path: string): string {
    // Remove leading slash if present
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    // Build full URL: https://{shopDomain}/admin/api/{apiVersion}/{path}
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}/${cleanPath}`;
  }

  /**
   * GET request - List or retrieve resource(s)
   */
  async get(params?: ShopifyGetParams): Promise<ShopifyResponse> {
    try {
      await this.throttle();

      const path = this.getResourcePath();
      const queryString = this.buildQueryString(params);
      const fullUrl = this.buildApiUrl(`${path}${queryString}`);

      logger.debug({ resource: this.resourceName, url: fullUrl }, 'GET request');

      // Make direct fetch call to Shopify API
      const startTime = Date.now();
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
      });
      const duration = Date.now() - startTime;
      logger.info({ resource: this.resourceName, url: fullUrl, statusCode: response.status, duration }, 'GET response received');

      // Handle rate limiting from response headers
      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      // Check if response is OK
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            resource: this.resourceName,
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            duration,
          },
          'GET request failed with non-OK status'
        );
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      // Parse JSON response
      const data = await response.json();

      // Convert Headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      logger.debug(
        {
          resource: this.resourceName,
          dataType: typeof data,
          isArray: Array.isArray(data),
          dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        },
        'GET request successful'
      );

      return {
        data,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      logger.error(
        { error: serializeError(error), resource: this.resourceName, resourceId: this.resourceId },
        'GET request failed'
      );
      throw new Error(`Failed to get ${this.resourceName}: ${message}`);
    }
  }

  /**
   * POST request - Create resource
   */
  async post(data: any): Promise<ShopifyResponse> {
    try {
      await this.throttle();

      const path = this.getResourcePath();
      const fullUrl = this.buildApiUrl(path);

      logger.debug({ resource: this.resourceName, url: fullUrl }, 'POST request');

      const startTime = Date.now();
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [this.resourceName]: data,
        }),
      });
      const duration = Date.now() - startTime;
      logger.info({ resource: this.resourceName, url: fullUrl, statusCode: response.status, duration }, 'POST response received');

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      const responseData = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        data: responseData,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      logger.error({ error: serializeError(error), resource: this.resourceName, resourceId: this.resourceId }, 'POST request failed');
      throw new Error(`Failed to create ${this.resourceName}: ${message}`);
    }
  }

  /**
   * PUT request - Update resource
   */
  async put(data: any): Promise<ShopifyResponse> {
    if (!this.resourceId) {
      throw new Error(`Cannot update ${this.resourceName} without ID`);
    }

    try {
      await this.throttle();

      const path = this.getResourcePath();
      const fullUrl = this.buildApiUrl(path);

      logger.debug({ resource: this.resourceName, url: fullUrl }, 'PUT request');

      const startTime = Date.now();
      const response = await fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [this.resourceName]: data,
        }),
      });
      const duration = Date.now() - startTime;
      logger.info({ resource: this.resourceName, url: fullUrl, statusCode: response.status, duration }, 'PUT response received');

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      const responseData = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        data: responseData,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      logger.error(
        { error: serializeError(error), resource: this.resourceName, resourceId: this.resourceId },
        'PUT request failed'
      );
      throw new Error(`Failed to update ${this.resourceName}: ${message}`);
    }
  }

  /**
   * DELETE request - Delete resource
   */
  async delete(): Promise<ShopifyResponse> {
    if (!this.resourceId) {
      throw new Error(`Cannot delete ${this.resourceName} without ID`);
    }

    try {
      await this.throttle();

      const path = this.getResourcePath();
      const fullUrl = this.buildApiUrl(path);

      logger.debug({ resource: this.resourceName, url: fullUrl }, 'DELETE request');

      const startTime = Date.now();
      const response = await fetch(fullUrl, {
        method: 'DELETE',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
      });
      const duration = Date.now() - startTime;
      logger.info({ resource: this.resourceName, url: fullUrl, statusCode: response.status, duration }, 'DELETE response received');

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      // DELETE might return empty body
      let responseData: any = null;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await response.text();
        responseData = text ? JSON.parse(text) : null;
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        data: responseData,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      logger.error(
        { error: serializeError(error), resource: this.resourceName, resourceId: this.resourceId },
        'DELETE request failed'
      );
      throw new Error(`Failed to delete ${this.resourceName}: ${message}`);
    }
  }
}



