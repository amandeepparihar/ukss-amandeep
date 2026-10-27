import { BaseResource } from '../base-resource';
import type { ShopifyGetParams, ShopifyResponse } from '../types';

export interface SmartCollectionParams extends ShopifyGetParams {
    limit?: number;
    since_id?: number;
    ids?: string; 
    handle?: string;
    title?: string;
    updated_at_min?: string;
    updated_at_max?: string;
    published_at_min?: string;
    published_at_max?: string;
    published_status?: 'any' | 'published' | 'unpublished';
    fields?: string;
}

export interface SmartCollectionInput {
    id?: number | string;
    title?: string;
    body_html?: string;
    handle?: string;
    sort_order?: 'alpha-asc' | 'alpha-desc' | 'best-selling' | 'created' | 'created-desc' | 'manual' | 'price-asc' | 'price-desc';
    published_scope?: 'web' | 'global';
    disjunctive?: boolean;
    rules?: Array<{
        column: string;
        relation: string;
        condition: string;
    }>;
}

export interface SmartCollectionPutPayload {
    smart_collection: SmartCollectionInput & { id: number | string };
}

export class SmartCollectionResource extends BaseResource {
    private _accessToken: string;
    private _shopDomain: string;
    private _apiVersion: string;

    constructor(
        shopDomain: string,
        accessToken: string,
        apiVersion: string,
        collectionId?: string | number
    ) {
        super(shopDomain, accessToken, apiVersion, 'smart_collection', collectionId);
        this._shopDomain = shopDomain;
        this._accessToken = accessToken;
        this._apiVersion = apiVersion;
    }

    public withId(collectionId: string | number): SmartCollectionResource {
        return new SmartCollectionResource(this._shopDomain, this._accessToken, this._apiVersion, collectionId);
    }

    /**
     * Fetch a single smart collection or a list of collections (Supports cursor pagination)
     */
    async get(params?: SmartCollectionParams): Promise<ShopifyResponse> {
        if (!this.resourceId) {
            const originalResourceName = this.resourceName;
            (this as any).resourceName = 'smart_collections.json';

            try {
                const result = await super.get(params);
                const collections = result.data?.smart_collections || result.data || [];
                return {
                    data: collections,
                    headers: result.headers || {},
                };
            } finally {
                (this as any).resourceName = originalResourceName;
            }
        } else {
            const result = await super.get(params);
            const collection = result.data?.smart_collection || result.data;
            return {
                data: collection,
                headers: result.headers || {},
            };
        }
    }

    /**
     * Update a Smart Collection configuration (e.g., changing sort_order to 'manual')
     */
    async put(data: SmartCollectionPutPayload): Promise<ShopifyResponse> {
        const id = this.resourceId || data.smart_collection?.id;
        if (!id) {
            throw new Error('Cannot update smart collection without a valid collection ID');
        }

        try {
            await this.throttle();
            const fullUrl = this.buildApiUrl(`smart_collections/${id}.json`);

            const response = await fetch(fullUrl, {
                method: 'PUT',
                headers: {
                    'X-Shopify-Access-Token': this._accessToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (response.headers) {
                this.handleRateLimit(response.headers);
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Shopify API error (${response.status}): ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json();
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => { headers[key] = value; });

            return {
                data: responseData.smart_collection || responseData,
                headers,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Request failed';
            throw new Error(`Failed to update smart collection: ${message}`);
        }
    }

    /**
     * Reorders products inside a collection using Shopify's modern GraphQL Admin API mutation
     */
    async reorderProducts(orderedProductIds: number[], explicitCollectionId?: string | number): Promise<ShopifyResponse> {
        const targetId = explicitCollectionId || this.resourceId;
        
        if (!targetId) {
            throw new Error('Cannot reorder products without an initialized collection ID');
        }

        try {
            await this.throttle();
            const fullUrl = this.buildApiUrl('graphql.json');

            const movesPayload = orderedProductIds.map((productId, index) => ({
                id: `gid://shopify/Product/${productId}`,
                newPosition: index
            }));

            const graphqlPayload = {
                query: `
                    mutation collectionReorderProducts($id: ID!, $moves: [CollectionReorderProductsInput!]!) {
                        collectionReorderProducts(id: $id, moves: $moves) {
                            job { id }
                            userErrors { field message }
                        }
                    }
                `,
                variables: {
                    id: `gid://shopify/Collection/${targetId}`,
                    moves: movesPayload
                }
            };

            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': this._accessToken,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(graphqlPayload),
            });

            if (response.headers) {
                this.handleRateLimit(response.headers);
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Shopify GraphQL network error (${response.status}): ${errorText}`);
            }

            const responseData = await response.json();
            
            if (responseData.errors || responseData.data?.collectionReorderProducts?.userErrors?.length) {
                const errDetails = responseData.errors || responseData.data?.collectionReorderProducts?.userErrors;
                throw new Error(`Shopify GraphQL execution error: ${JSON.stringify(errDetails)}`);
            }

            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => { headers[key] = value; });

            return {
                data: responseData.data.collectionReorderProducts,
                headers,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Request failed';
            throw new Error(`Failed to execute collection product reorder: ${message}`);
        }
    }
}
