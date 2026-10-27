/**
 * TypeScript types for Shopify SDK
 */

export interface ShopifySDKConfig {
  shopDomain: string;
  apiKey: string;
  sharedSecret: string;
  accessToken: string;
  apiVersion?: string;
  storeName: string;
  adminUrl?: string;
  ApiUrl?: string;
  microtimeOfLastApiCall?: number | null;
  timeAllowedForEachApiCall?: number;
  defaultApiVersion?: string;
}

export interface ShopifyGetParams {
  limit?: number;
  page?: number;
  since_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  status?: string;
  financial_status?: string;
  fulfillment_status?: string;
  [key: string]: any; // Allow additional query parameters
}

export interface ShopifyResponse<T = any> {
  data: T;
  headers?: Record<string, string>;
}

export interface ShopifyListResponse<T = any> {
  data: T[];
  meta?: {
    page?: number;
    limit?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}



