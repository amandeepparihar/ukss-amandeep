/**
 * Shopify API Client Wrapper
 *
 * Uses the official @shopify/shopify-api package for REST/GraphQL calls
 */

import { createAdminRestApiClient, createAdminApiClient } from '@shopify/admin-api-client';
import { createLogger } from '../logger';
import { getRateLimiter } from './rate-limiter';
import type { ShopifyProductInput, ShopifyVariantInput, SyncResult } from './types';

const logger = createLogger('shopify-client');

export class ShopifyClient {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private rateLimiter;

  constructor(shopDomain: string, accessToken: string, apiVersion = '2024-01') {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.rateLimiter = getRateLimiter(shopDomain);
  }

  /**
   * Create GraphQL client
   */
  private getGraphQLClient() {
    return createAdminApiClient({
      storeDomain: this.shopDomain,
      accessToken: this.accessToken,
      apiVersion: this.apiVersion,
    });
  }

  /**
   * Create REST client
   */
  private getRestClient() {
    return createAdminRestApiClient({
      storeDomain: this.shopDomain,
      accessToken: this.accessToken,
      apiVersion: this.apiVersion,
    });
  }

  /**
   * Test connection to Shopify store
   */
  async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();
      const response = await client.request(`
        query {
          shop {
            name
            primaryDomain {
              url
            }
          }
        }
      `);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Unknown GraphQL error');
      }

      return {
        success: true,
        shopName: response.data?.shop?.name,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      logger.error({ error, shopDomain: this.shopDomain }, 'Shopify connection test failed');
      return { success: false, error: message };
    }
  }

  /**
   * Get a product by ID
   */
  async getProduct(shopifyId: string): Promise<{ id: string; variants: { id: string; sku: string }[] } | null> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();
      const response = await client.request(`
        query getProduct($id: ID!) {
          product(id: $id) {
            id
            title
            status
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      `, {
        variables: { id: shopifyId },
      });

      if (response.errors || !response.data?.product) {
        return null;
      }

      const product = response.data.product;
      return {
        id: product.id,
        variants: product.variants.edges.map((e: any) => ({
          id: e.node.id,
          sku: e.node.sku,
          inventoryItemId: e.node.inventoryItem?.id,
        })),
      };
    } catch (error) {
      logger.error({ error, shopifyId }, 'Failed to get product');
      return null;
    }
  }

  /**
   * Find product by SKU
   */
  async findProductBySku(sku: string): Promise<string | null> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();
      const response = await client.request(`
        query findBySku($query: String!) {
          products(first: 1, query: $query) {
            edges {
              node {
                id
              }
            }
          }
        }
      `, {
        variables: { query: `sku:${sku}` },
      });

      if (response.errors) {
        throw new Error(response.errors[0]?.message);
      }

      const edges = response.data?.products?.edges;
      return edges?.[0]?.node?.id || null;
    } catch (error) {
      logger.error({ error, sku }, 'Failed to find product by SKU');
      return null;
    }
  }

  /**
   * Create a new product in Shopify
   */
  async createProduct(input: ShopifyProductInput): Promise<SyncResult> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();

      // Prepare variants for GraphQL input
      const variantInputs = input.variants.map(v => ({
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compare_at_price || null,
        options: [v.option1, v.option2, v.option3].filter(Boolean),
      }));

      const response = await client.request(`
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            title: input.title,
            descriptionHtml: input.body_html || '',
            status: input.status,
            variants: variantInputs,
          },
        },
      });

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'GraphQL error');
      }

      const userErrors = response.data?.productCreate?.userErrors;
      if (userErrors?.length > 0) {
        throw new Error(userErrors.map((e: any) => e.message).join(', '));
      }

      const productId = response.data?.productCreate?.product?.id;
      if (!productId) {
        throw new Error('No product ID returned');
      }

      logger.info({ shopifyId: productId, title: input.title }, 'Product created in Shopify');

      return { success: true, shopifyId: productId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      logger.error({ error, title: input.title }, 'Failed to create product');
      return { success: false, error: message };
    }
  }

  /**
   * Update an existing product in Shopify
   */
  async updateProduct(shopifyId: string, input: Partial<ShopifyProductInput>): Promise<SyncResult> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();

      const response = await client.request(`
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            id: shopifyId,
            title: input.title,
            descriptionHtml: input.body_html,
            status: input.status,
          },
        },
      });

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'GraphQL error');
      }

      const userErrors = response.data?.productUpdate?.userErrors;
      if (userErrors?.length > 0) {
        throw new Error(userErrors.map((e: any) => e.message).join(', '));
      }

      logger.info({ shopifyId }, 'Product updated in Shopify');

      return { success: true, shopifyId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      logger.error({ error, shopifyId }, 'Failed to update product');
      return { success: false, error: message };
    }
  }

  /**
   * Update variant price
   */
  async updateVariantPrice(
    variantId: string,
    price: string,
    compareAtPrice?: string
  ): Promise<SyncResult> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();

      const response = await client.request(`
        mutation productVariantUpdate($input: ProductVariantInput!) {
          productVariantUpdate(input: $input) {
            productVariant {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            id: variantId,
            price,
            compareAtPrice: compareAtPrice || null,
          },
        },
      });

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'GraphQL error');
      }

      const userErrors = response.data?.productVariantUpdate?.userErrors;
      if (userErrors?.length > 0) {
        throw new Error(userErrors.map((e: any) => e.message).join(', '));
      }

      return { success: true, shopifyId: variantId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Price update failed';
      logger.error({ error, variantId }, 'Failed to update variant price');
      return { success: false, error: message };
    }
  }

  /**
   * Update inventory quantity
   */
  async updateInventory(
    inventoryItemId: string,
    locationId: string,
    quantity: number
  ): Promise<SyncResult> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();

      const response = await client.request(`
        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              createdAt
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            name: 'available',
            reason: 'correction',
            quantities: [{
              inventoryItemId,
              locationId,
              quantity,
            }],
          },
        },
      });

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'GraphQL error');
      }

      const userErrors = response.data?.inventorySetQuantities?.userErrors;
      if (userErrors?.length > 0) {
        throw new Error(userErrors.map((e: any) => e.message).join(', '));
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inventory update failed';
      logger.error({ error, inventoryItemId }, 'Failed to update inventory');
      return { success: false, error: message };
    }
  }

  /**
   * Unpublish (set to draft) a product in Shopify
   */
  async unpublishProduct(shopifyId: string): Promise<SyncResult> {
    return this.updateProduct(shopifyId, { status: 'DRAFT' });
  }

  /**
   * Get the primary location ID for inventory updates
   */
  async getPrimaryLocationId(): Promise<string | null> {
    try {
      await this.rateLimiter.throttle();

      const client = this.getGraphQLClient();

      const response = await client.request(`
        query {
          locations(first: 1) {
            edges {
              node {
                id
                name
                isActive
              }
            }
          }
        }
      `);

      if (response.errors) {
        throw new Error(response.errors[0]?.message);
      }

      const location = response.data?.locations?.edges?.[0]?.node;
      return location?.id || null;
    } catch (error) {
      logger.error({ error }, 'Failed to get primary location');
      return null;
    }
  }
}
