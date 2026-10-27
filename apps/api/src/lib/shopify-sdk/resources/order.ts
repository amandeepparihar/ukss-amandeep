/**
 * Order Resource
 *
 * Provides access to Shopify Order API
 * Usage: shopify.Order.get(params) or shopify.Order(id).get()
 */

import { BaseResource } from '../base-resource';
import type { ShopifyGetParams, ShopifyResponse } from '../types';
import { FulfillmentOrderResource } from './fulfillment-order';

export interface OrderParams extends ShopifyGetParams {
  limit?: number;
  page?: number;
  since_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  status?: 'open' | 'closed' | 'cancelled' | 'any';
  financial_status?: 'authorized' | 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'partially_refunded' | 'unpaid' | 'any';
  fulfillment_status?: 'fulfilled' | 'partial' | 'restocked' | 'unfulfilled' | 'any';
  fields?: string; // Comma-separated list of fields to return
}

export class OrderResource extends BaseResource {
  private _shopDomain: string;
  private _accessToken: string;
  private _apiVersion: string;
  private _orderId?: string | number;

  constructor(
    shopDomain: string,
    accessToken: string,
    apiVersion: string,
    orderId?: string | number
  ) {
    // Shopify's REST endpoint is plural ('orders') for both list and single-order lookups.
    super(shopDomain, accessToken, apiVersion, 'orders', orderId);
    this._shopDomain = shopDomain;
    this._accessToken = accessToken;
    this._apiVersion = apiVersion;
    this._orderId = orderId;
  }

  /**
   * Access FulfillmentOrder sub-resource
   * Usage: shopify.Order(12345).FulfillmentOrder.get()
   */
  get FulfillmentOrder(): FulfillmentOrderResource {
    if (!this._orderId) {
      throw new Error('Cannot access FulfillmentOrder without order ID');
    }
    return new FulfillmentOrderResource(
      this._shopDomain,
      this._accessToken,
      this._apiVersion,
      this._orderId
    );
  }

  /**
   * Get orders
   * 
   * @param params Query parameters for filtering orders
   * @returns Promise with orders data
   * 
   * @example
   * // Get all orders
   * const response = await shopify.Order.get();
   * const orders = response.data.orders || response.data; // Handle both formats
   * 
   * @example
   * // Get orders with filters
   * const response = await shopify.Order.get({
   *   status: 'open',
   *   limit: 50,
   *   created_at_min: '2024-01-01T00:00:00Z'
   * });
   * const orders = response.data.orders || response.data;
   * 
   * @example
   * // Get single order
   * const response = await shopify.Order(12345).get();
   * const order = response.data.order || response.data;
   */
  async get(params?: OrderParams): Promise<ShopifyResponse> {
    // Shopify REST API uses 'orders' (plural) for both the list and single-resource
    // path; only the JSON response body key differs ('orders': [...] vs 'order': {...}).
    if (!this.resourceId) {
      // For list endpoint, we need to use 'orders' instead of 'order'
      const originalResourceName = this.resourceName;
      (this as any).resourceName = 'orders.json';
      
      try {
        const result = await super.get(params);
        // Shopify REST API returns { orders: [...] } format
        // Extract the orders array from the response
        const orders = result.data?.orders || result.data || [];
        return {
          ...result,
          data: orders,
        };
      } finally {
        // Restore original resource name
        (this as any).resourceName = originalResourceName;
      }
    } else {
      // For single order, use the base get method
      const result = await super.get(params);
      // Shopify REST API returns { order: {...} } format
      const order = result.data?.order || result.data;
      return {
        ...result,
        data: order,
      };
    }
  }

  /**
   * Create a new order (draft order)
   * Note: Shopify doesn't allow direct order creation via REST API
   * Use DraftOrder resource instead
   */
  async post(_data: any): Promise<ShopifyResponse> {
    throw new Error('Cannot create orders directly. Use DraftOrder resource instead.');
  }

  /**
   * Update an order
   * 
   * @param data Order data to update
   * @returns Promise with updated order
   */
  async put(data: any): Promise<ShopifyResponse> {
    return super.put(data);
  }

  /**
   * Cancel an order
   *
   * @param options Cancellation options
   * @param options.reason Cancellation reason: 'customer', 'inventory', 'fraud', 'declined', 'other'
   * @param options.email Whether to send cancellation email to customer
   * @param options.restock Whether to restock items
   * @returns Promise with cancellation result
   *
   * @example
   * await shopify.Order(12345).cancel({ reason: 'inventory' });
   */
  async cancel(options?: {
    reason?: 'customer' | 'inventory' | 'fraud' | 'declined' | 'other';
    email?: boolean;
    restock?: boolean;
  }): Promise<ShopifyResponse> {
    if (!this.resourceId) {
      throw new Error('Cannot cancel order without ID');
    }

    try {
      await this.throttle();

      const fullUrl = this.buildApiUrl(`orders/${this.resourceId}/cancel.json`);

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this._accessToken,
          'Content-Type': 'application/json',
        },
        body: options ? JSON.stringify(options) : undefined,
      });

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Shopify returns { order: {...} }
      const order = data.order || data;

      return {
        data: order,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      throw new Error(`Failed to cancel order: ${message}`);
    }
  }

  /**
   * Close an order
   */
  async close(): Promise<ShopifyResponse> {
    if (!this.resourceId) {
      throw new Error('Cannot close order without ID');
    }

    try {
      await this.throttle();

      const fullUrl = this.buildApiUrl(`orders/${this.resourceId}/close.json`);

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this._accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const order = data.order || data;

      return {
        data: order,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      throw new Error(`Failed to close order: ${message}`);
    }
  }

  /**
   * Reopen a closed order
   */
  async open(): Promise<ShopifyResponse> {
    if (!this.resourceId) {
      throw new Error('Cannot open order without ID');
    }

    try {
      await this.throttle();

      const fullUrl = this.buildApiUrl(`orders/${this.resourceId}/open.json`);

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this._accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (response.headers) {
        this.handleRateLimit(response.headers);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Shopify API error (${response.status}): ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const order = data.order || data;

      return {
        data: order,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      throw new Error(`Failed to open order: ${message}`);
    }
  }
}

