import { BaseResource } from '../base-resource';
import type { ShopifyResponse } from '../types';
import type { ProductVariantInput } from './products';


export interface ProductVariantCreatePayload {
    variant: ProductVariantInput;
}

export interface ProductVariantOutput extends ProductVariantInput {
    id: number;
    product_id: number;
    inventory_item_id: number;
    created_at: string;
    updated_at: string;
}

export class ProductVariantResource extends BaseResource {
    private _accessToken: string;

    constructor(
        shopDomain: string,
        accessToken: string,
        apiVersion: string,
        productId?: string | number,
        variantId?: string | number
    ) {
        // Fallback target singular identifier for BaseResource mapping
        super(shopDomain, accessToken, apiVersion, 'variant', variantId);
        this._accessToken = accessToken;
    }

    /**
     * Create a new variant for a specific product
     * Endpoint: POST /admin/api/{version}/products/{product_id}/variants.json
     */
    async create(productId: string | number, data: ProductVariantInput): Promise<ShopifyResponse<ProductVariantOutput>> {
        if (!productId) {
            throw new Error('Cannot create a product variant without a valid parent productId');
        }

        try {
            await this.throttle();


            const fullUrl = this.buildApiUrl(`products/${productId}/variants.json`);

            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': this._accessToken,
                    'Content-Type': 'application/json',
                },
                body: data ? JSON.stringify({ variant: data }) : undefined,
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

            // Extract variants nested namespace value
            const variant = responseData.variant || responseData;

            return {
                data: variant,
                headers,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Request failed';
            throw new Error(`Failed to create product variant: ${message}`);
        }
    }
}
