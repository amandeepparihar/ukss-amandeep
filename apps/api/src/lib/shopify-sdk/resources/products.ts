import { BaseResource } from '../base-resource';
import type { ShopifyGetParams, ShopifyResponse } from '../types';

export interface ProductParams extends ShopifyGetParams {
    limit?: number;
    page?: number;
    since_id?: number;
    ids?: string; // Comma-separated list of product IDs
    title?: string;
    vendor?: string;
    handle?: string;
    product_type?: string;
    status?: 'active' | 'archived' | 'draft' ;
    collection_id?: number | string;
    created_at_min?: string;
    created_at_max?: string;
    updated_at_min?: string;
    updated_at_max?: string;
    published_at_min?: string;
    published_at_max?: string;
    published_status?: 'published' | 'unpublished' ;
    fields?: string;
}

export interface ProductVariantInput {
    id?: number | string;
    price?: string | number;
    sku?: string;
    compareAtPrice?: string | number | null;
    inventory_management?: 'shopify' | string | null;
    inventory_policy?: 'deny' | 'continue';
    inventory_quantity?: number;
    barcode?: string;
    taxable?: boolean;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    // [key: string]: unknown;
}

export interface ProductOptionInput {
    id?: number | string;
    product_id?: number | string;
    name: string;
    position?: number;
    values: string[];
}

export interface ProductImageInput {
    id?: number | string;
    product_id?: number | string;
    position?: number;
    alt?: string | null;
    width?: number;
    height?: number;
    src: string;
    variant_ids?: (number | string)[];
}

export interface ProductCreateInput {
    title: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    status?: 'active' | 'archived' | 'draft';
    tags?: string | string[];
    handle?: string;
    published_scope?: 'web' | 'global';
    template_suffix?: string | null;
    variants?: ProductVariantInput[];
    options?: ProductOptionInput[];
    images?: ProductImageInput[];
}

// created this because shopify expects the payload to be wrapped in product key 
export interface ProductCreatePayload {
    product: ProductCreateInput;
}

export interface ProductOutput {
  id: number; 
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  handle: string;
  status: 'active' | 'archived' | 'draft';
  created_at: string; 
  updated_at: string; 
  published_at: string | null;
  published_scope: string;
  tags: string;
  template_suffix: string | null;
  variants: Array<ProductVariantInput & { id: number; product_id: number; inventory_item_id: number }>;
  options: Array<ProductOptionInput & { id: number; product_id: number }>;
  images: Array<ProductImageInput & { id: number; product_id: number }>;
}


export class ProductResource extends BaseResource {

    private _shopDomain: string;
    private _accessToken: string;
    private _apiVersion: string;

    constructor(
        shopDomain: string,
        accessToken: string,
        apiVersion: string,
        productId?: string | number
    ) {

        super(shopDomain, accessToken, apiVersion, 'product', productId);
        this._shopDomain = shopDomain;
        this._accessToken = accessToken;
        this._apiVersion = apiVersion;
    }

    /**
     * Fetch a single product or a list of products
     */
    async get(params?: ProductParams): Promise<ShopifyResponse> {
        // Shopify REST API uses 'products' (plural) for list endpoints
        // but 'product' (singular) for a single resource ID
        if (!this.resourceId) {
            // For list endpoints, swap to 'products.json' 
            const originalResourceName = this.resourceName;
            (this as any).resourceName = 'products.json';

            try {
                const result = await super.get(params);
                // Extract the products array from the response namespace
                const products = result.data?.products || result.data || [];
                return {
                    data: products,
                    headers: result.headers || {},
                };
            } finally {
                // Restore original structural name
                (this as any).resourceName = originalResourceName;
            }
        } else {
            // For a single product look up, using the base get runner
            const result = await super.get(params);
            const product = result.data?.product || result.data;
            return {
                data: product,
                headers: result.headers || {},
            };
        }
    }

    /**
     * Create a new product
     */
    async post(data: ProductCreatePayload): Promise<ShopifyResponse<ProductOutput>> {
        try {
            await this.throttle();

            const fullUrl = this.buildApiUrl('products.json');

            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': this._accessToken,
                    'Content-Type': 'application/json',
                },
                body: data ? JSON.stringify(data) : undefined,
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

            const product = responseData.product || responseData;

            return {
                data: product,
                headers,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Request failed';
            throw new Error(`Failed to create product: ${message}`);
        }
    }

    // Not enabled this since we're using graphQl for update queries
    // /**
    //  * Update a product
    //  */
    // async put(data: any): Promise<ShopifyResponse> {
    //     return super.put(data);
    // }

    /**
     * Delete a product
     */
    async delete(): Promise<ShopifyResponse> {
        if (!this.resourceId) {
            throw new Error('Cannot delete product without ID');
        }

        try {
            await this.throttle();

            const fullUrl = this.buildApiUrl(`products/${this.resourceId}.json`);

            const response = await fetch(fullUrl, {
                method: 'DELETE',
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
            throw new Error(`Failed to delete product: ${message}`);
        }
    }

    /**
     * Retrieve a count of products
     */
    async count(params?: Omit<ProductParams, 'limit' | 'page' | 'fields' | 'ids'>): Promise<ShopifyResponse> {
        try {
            await this.throttle();

            // Construct request URL string with optional query params attached
            let path = 'products/count.json';
            if (params && Object.keys(params).length > 0) {
                const queryParams = new URLSearchParams(params as any).toString();
                path += `?${queryParams}`;
            }

            const fullUrl = this.buildApiUrl(path);

            const response = await fetch(fullUrl, {
                method: 'GET',
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
            throw new Error(`Failed to count products: ${message}`);
        }
    }
}
