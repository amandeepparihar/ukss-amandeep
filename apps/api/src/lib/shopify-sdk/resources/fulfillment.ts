/**
 * Fulfillment Resource
 *
 * Provides access to Shopify Fulfillments API
 * Used to create fulfillments with tracking information
 *
 * Usage: shopify.Fulfillment.post(data)
 *
 * API Endpoint: POST /admin/api/{version}/fulfillments.json
 */

import { BaseResource } from '../base-resource';
import type { ShopifyResponse } from '../types';

export interface FulfillmentLineItem {
  id: number;
  quantity: number;
}

export interface FulfillmentOrderLineItems {
  fulfillment_order_id: number;
  fulfillment_order_line_items: FulfillmentLineItem[];
}

export interface TrackingInfo {
  number: string;
  company: string;
  url?: string;
}

export interface CreateFulfillmentRequest {
  line_items_by_fulfillment_order: FulfillmentOrderLineItems[];
  tracking_info?: TrackingInfo;
  notify_customer?: boolean;
  origin_address?: {
    address1?: string;
    address2?: string;
    city?: string;
    country_code?: string;
    province_code?: string;
    zip?: string;
  };
}

export interface FulfillmentResponse {
  id: number;
  order_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_numbers: string[];
  tracking_url: string | null;
  tracking_urls: string[];
  receipt: any;
  name: string;
  admin_graphql_api_id: string;
  line_items: any[];
}

export class FulfillmentResource extends BaseResource {
  constructor(
    shopDomain: string,
    accessToken: string,
    apiVersion: string
  ) {
    super(shopDomain, accessToken, apiVersion, 'fulfillments');
  }

  /**
   * Create a fulfillment
   *
   * @param data Fulfillment creation data
   * @returns Promise with fulfillment response
   *
   * @example
   * const response = await shopify.Fulfillment.post({
   *   line_items_by_fulfillment_order: [{
   *     fulfillment_order_id: 123456,
   *     fulfillment_order_line_items: [{ id: 111, quantity: 1 }]
   *   }],
   *   tracking_info: {
   *     number: "TRACK123",
   *     company: "Royal Mail"
   *   },
   *   notify_customer: true
   * });
   */
  async post(data: CreateFulfillmentRequest): Promise<ShopifyResponse<FulfillmentResponse>> {
    try {
      await this.throttle();

      const fullUrl = this.buildApiUrl('fulfillments.json');

      const requestBody = {
        fulfillment: data,
      };

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
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

      const responseData = await response.json();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Shopify returns { fulfillment: {...} }
      const fulfillment = responseData.fulfillment || responseData;

      return {
        data: fulfillment,
        headers,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      throw new Error(`Failed to create fulfillment: ${message}`);
    }
  }
}
