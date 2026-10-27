import { BaseResource } from '../base-resource';
import type {  ShopifyResponse } from '../types';

export class CollectionResource extends BaseResource {
    private _accessToken: string;
    private _shopDomain: string;
    private _apiVersion: string;

    constructor(
        shopDomain: string,
        accessToken: string,
        apiVersion: string,
        collectionId?: string | number
    ) {
        super(shopDomain, accessToken, apiVersion, 'collection', collectionId);
        this._shopDomain = shopDomain;
        this._accessToken = accessToken;
        this._apiVersion = apiVersion;
    }

    public withId(collectionId: string | number): CollectionResource {
        return new CollectionResource(this._shopDomain, this._accessToken, this._apiVersion, collectionId);
    }

    /**
     * GET /admin/api/2026-01/collections/{collection_id}/products.json
     */
    async getProducts(params?: any): Promise<ShopifyResponse> {
        if (!this.resourceId) {
            throw new Error('Cannot fetch products for a collection without initializing the resource collectionId');
        }

        try {
            await this.throttle();
            const fullUrl = this.buildApiUrl(`collections/${this.resourceId}/products.json`);

            const urlWithParams = new URL(fullUrl);
            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        urlWithParams.searchParams.append(key, String(value));
                    }
                });
            }

            const response = await fetch(urlWithParams.toString(), {
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
                throw new Error(`Shopify API Error (${response.status}): ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json();
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

            return {
                data: responseData.products || responseData,
                headers,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Request failed';
            throw new Error(`Failed to fetch products belonging to collection ${this.resourceId}: ${message}`);
        }
    }
}
