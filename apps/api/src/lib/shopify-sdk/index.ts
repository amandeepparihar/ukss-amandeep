/**
 * Shopify SDK
 *
 * Resource-based SDK wrapper for Shopify API
 * Similar to PHPShopify SDK structure
 *
 * Usage:
 * const shopify = new ShopifySDK({
 *   shopDomain: 'yourshop.myshopify.com',
 *   accessToken: 'shpat_xxx',
 *   apiVersion: '2024-01'
 * });
 *
 * // Get all orders
 * const orders = await shopify.Order.get();
 *
 * // Get specific order
 * const order = await shopify.Order(12345).get();
 *
 * // Get orders with filters
 * const orders = await shopify.Order.get({
 *   status: 'open',
 *   limit: 50
 * });
 */

import { OrderResource } from './resources/order';
import { ProductResource } from './resources/products';
import { ProductVariantResource } from './resources/product-variant';
import { CollectionResource } from './resources/collection';
import { SmartCollectionResource } from './resources/smart-collection';
import { FulfillmentResource } from './resources/fulfillment';
import type { ShopifySDKConfig } from './types';

export class ShopifySDK {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;
  public microtimeOfLastApiCall: number | null;
  public timeAllowedForEachApiCall: number;
  public defaultApiVersion: string;
  public config: Record<string, unknown>;

  constructor(config: ShopifySDKConfig) {
    this.shopDomain = config.shopDomain;
    this.accessToken = config.accessToken;
    this.defaultApiVersion = config.defaultApiVersion || config.apiVersion || '2023-07';
    this.apiVersion = config.apiVersion || this.defaultApiVersion;
    this.microtimeOfLastApiCall = config.microtimeOfLastApiCall ?? null;
    this.timeAllowedForEachApiCall = config.timeAllowedForEachApiCall ?? 0.5;

    const { adminUrl, apiUrl } = ShopifySDK.setAdminUrl({
      ...config,
      apiVersion: this.apiVersion,
    });

    this.config = {
      ApiVersion: this.apiVersion,
      ShopUrl: this.shopDomain,
      ApiKey: config.apiKey,
      SharedSecret: config.sharedSecret,
      AccessToken: this.accessToken,
      StoreName: config.storeName,
      AdminUrl: adminUrl,
      ApiUrl: apiUrl,
    };
  }

  public static setAdminUrl(config: ShopifySDKConfig){
    let shopUrl = config.shopDomain;
    const apiVersion = config.apiVersion || config.defaultApiVersion || '2023-07';
    shopUrl = shopUrl.replace('https://', '').replace('http://', '').replace('www.', '');

    const adminUrl = `https://${shopUrl}/admin/`;
    const apiUrl = `${adminUrl}api/${apiVersion}/`;
    return {
      adminUrl,
      apiUrl,
    };

  }

  /**
   * Access Order resource
   * Usage:
   * - shopify.Order.get() - Get all orders
   * - shopify.Order(12345).get() - Get specific order
   * - shopify.Order(12345).FulfillmentOrder.get() - Get fulfillment orders
   * - shopify.Order(12345).cancel({ reason: 'inventory' }) - Cancel order
   */
  Order(id?: string | number): OrderResource {
    return new OrderResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion,
      id
    );
  }

  
  /**
   * Access Fulfillment resource
   * Usage:
   * - shopify.Fulfillment.post(data) - Create a fulfillment
   */
  get Fulfillment(): FulfillmentResource {
    return new FulfillmentResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion
    );
  }

  
  /**
   * Access Products resource
   * Usage:
   * - shopify.products.post(data) - Create a Product
   */
  get Product(): ProductResource {
    return new ProductResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion
    );
  }

  /**
   * Access ProductVariant resource
   * Usage:
   * - shopify.ProductVariants.post(data) - Create a Product
   */
  get ProductVariant(): ProductVariantResource {
    return new ProductVariantResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion
    );
  }


  /**
   * Access Collection resource
   * Usage:
   * - shopify.Collection.get(id) - Get getProducts
   */
  get Collection(): CollectionResource {
    return new CollectionResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion
    );
  }

  /**
   * Access SmartCollection resource
   * Usage:
   * - shopify.SmartCollection.post(data) - Create a Product
   */
  get SmartCollection(): SmartCollectionResource {
    return new SmartCollectionResource(
      this.shopDomain,
      this.accessToken,
      this.apiVersion
    );
  }

  // TODO: Add other resources as needed
  // get Customer(): CustomerResource { ... }
  // etc.
}

// Export types
export type { ShopifySDKConfig, ShopifyGetParams, ShopifyResponse, ShopifyListResponse } from './types';
export type { OrderParams } from './resources/order';
export type {
  FulfillmentOrder,
  FulfillmentOrderLineItem,
} from './resources/fulfillment-order';
export type {
  CreateFulfillmentRequest,
  FulfillmentResponse,
  FulfillmentLineItem,
  FulfillmentOrderLineItems,
  TrackingInfo,
} from './resources/fulfillment';

// Export resources
export { OrderResource } from './resources/order';
export { ProductResource } from './resources/products';
export { ProductVariantResource } from './resources/product-variant';
export { SmartCollectionResource } from './resources/smart-collection';
export { CollectionResource } from './resources/collection';
export { FulfillmentResource } from './resources/fulfillment';
export { FulfillmentOrderResource } from './resources/fulfillment-order';
export { BaseResource } from './base-resource';

