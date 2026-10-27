/**
 * Fulfillment Order Resource
 *
 * Provides access to Shopify Fulfillment Orders API
 * This is a sub-resource of Order
 *
 * Usage: shopify.Order(orderId).FulfillmentOrder.get()
 *
 * API Endpoint: GET /admin/api/{version}/orders/{order_id}/fulfillment_orders.json
 */

import { BaseResource } from '../base-resource';
import type { ShopifyResponse } from '../types';

export interface FulfillmentOrderLineItem {
  id: number;
  shop_id: number;
  fulfillment_order_id: number;
  quantity: number;
  line_item_id: number;
  inventory_item_id: number;
  fulfillable_quantity: number;
  variant_id: number;
}

export interface FulfillmentOrder {
  id: number;
  shop_id: number;
  order_id: number;
  assigned_location_id: number;
  request_status: string;
  status: string;
  supported_actions: string[];
  destination: {
    id: number;
    address1: string;
    address2: string | null;
    city: string;
    company: string | null;
    country: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    province: string;
    zip: string;
  };
  line_items: FulfillmentOrderLineItem[];
  fulfill_at: string | null;
  fulfill_by: string | null;
  international_duties: any | null;
  fulfillment_holds: any[];
  created_at: string;
  updated_at: string;
}

export class FulfillmentOrderResource extends BaseResource {
  private orderId: string | number;

  constructor(
    shopDomain: string,
    accessToken: string,
    apiVersion: string,
    orderId: string | number
  ) {
    // We'll handle the path manually since it's a nested resource
    super(shopDomain, accessToken, apiVersion, 'fulfillment_orders');
    this.orderId = orderId;
  }

  /**
   * Build the resource path for fulfillment orders
   * Path: orders/{order_id}/fulfillment_orders
   */
  protected override getResourcePath(): string {
    return `orders/${this.orderId}/fulfillment_orders`;
  }

  /**
   * Get fulfillment orders for an order
   *
   * @returns Promise with fulfillment orders data
   *
   * @example
   * const response = await shopify.Order(12345).FulfillmentOrder.get();
   * const fulfillmentOrders = response.data;
   */
  async get(): Promise<ShopifyResponse<FulfillmentOrder[]>> {
    try {
      await this.throttle();

      const path = this.getResourcePath();
      const fullUrl = this.buildApiUrl(`${path}.json`);

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
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

      // Shopify returns { fulfillment_orders: [...] }
      const fulfillmentOrders = data.fulfillment_orders || data || [];

      return {
        data: fulfillmentOrders,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      throw new Error(`Failed to get fulfillment orders: ${message}`);
    }
  }
}
