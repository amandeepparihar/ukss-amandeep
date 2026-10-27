/**
 * Marketplace Sync Types
 * 
 * Shared types and interfaces for marketplace sync system
 * 
 * @taskId #165004
 */

export interface SyncResult {
  success: boolean;
  storeName: string;
  storeId: number;
  marketplace: string;
  total: number;
  successCount: number;
  failureCount: number;
  message: string;
}

/**
 * Listing item with all fields needed for marketplace sync.
 * Represents a product listing ready to be synced to a marketplace.
 * 
 * @taskId #165004
 */
export interface ListingItem {
  marketplace_listings_id: number;
  products_sku: string;
  product_sku_internal: string;
  marketplace_item_identifier: string;
  quantity: number;
  price: number;
  quantity_changed: boolean;
  price_changed: boolean;
  is_special_price: boolean;
  regular_price: number;
  special_price: number | null;
  price_adjustment: number; // Required: always present from DB (default 0)
}

/**
 * Listing that needs to be synced to marketplace.
 * This is the raw data structure returned from the database query.
 * 
 * @taskId #165004
 */
export interface ListingNeedingSync {
  marketplace_listings_id: number;
  products_id: number;
  store_id: number;
  marketplace_item_identifier: string;
  products_sku: string;
  upc: string | null;
  ean: string | null;
  gtin: string | null;
  last_synced_quantity: number | null;
  last_synced_price: number | null;
  last_synced_special_price: number | null;
  last_synced_price_currency: string | null;
  retry_count: number;
  marketplace_listing_status: string;
  current_quantity: number;
  current_price: number;
  normalized_quantity: number;
  npv_products_sku: string;
  npv_products_id: number;
  npv_id: number;
  products_price: number;
  specials_status: string;
  specials_price: number | null;
  price_adjustment: number;
  current_price_in_synced_currency: number;
  /** new_products.virtual_product_type_id; 4 = T-shirt (print-on-demand). Drives SD T-shirt markup. */
  virtual_product_type_id: number;
}

export interface MarketplaceConfig {
  storeId: number;
  storeName: string;
  marketplace: string;
  maxProducts: number;
  batchSize: number;
  batchDelay: number;
  maxQuantityCap: number;
}

export interface MarketplaceSyncAdapter {
  /**
   * Sync listings for a specific store
   */
  syncListings(
    config: MarketplaceConfig,
    listings: ListingNeedingSync[]
  ): Promise<{
    successCount: number;
    failureCount: number;
    errors: string[];
  }>;
}
