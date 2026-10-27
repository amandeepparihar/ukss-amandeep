/**
 * Debenhams/Mirakl Type Definitions
 *
 * Types for Mirakl API requests and responses.
 * Covers O11 (create offers) and OF24 (update inventory/price) APIs.
 */

// ============================================================
// Mirakl Offer Types
// ============================================================

/**
 * Single offer structure for Mirakl API.
 * Used in both O11 (create) and OF24 (update) requests.
 */
export interface MiraklOffer {
  /** Shop SKU (our internal SKU) */
  shop_sku: string;
  /** Product SKU on Mirakl (product_shop_sku format: p-XXXXX-XXXX) */
  product_id?: string;
  /** Product ID type (typically 'SHOP_SKU') */
  product_id_type?: string;
  /** Offer price */
  price: number;
  /** Quantity available */
  quantity: number;
  /** Offer state code (e.g., '11' for new) */
  state_code?: string;
  /** Description of offer */
  description?: string;
  /** Whether offer is active */
  active?: boolean;
  /** Currency code (e.g., 'GBP') */
  currency_iso_code?: string;
  /** Discount price (sale price) */
  discount_price?: number;
  /** Discount start date (ISO format) */
  discount_start_date?: string;
  /** Discount end date (ISO format) */
  discount_end_date?: string;
  /** Logistic class (shipping method) */
  logistic_class?: string;
  /** Lead time to ship (in days) */
  leadtime_to_ship?: number;
  /** Additional fields */
  [key: string]: unknown;
}

// ============================================================
// O11 API - Create Offers
// ============================================================

/**
 * Request body for Mirakl O11 API (create/update offers).
 * POST /api/offers
 */
export interface MiraklOfferCreateRequest {
  /** Array of offers to create or update */
  offers: MiraklOffer[];
}

/**
 * Single offer result from O11 API response.
 */
export interface MiraklOfferCreateResponseItem {
  /** Shop SKU */
  shop_sku: string;
  /** Whether the offer was created/updated successfully */
  status: string;
  /** Error message if failed */
  error_message?: string;
  /** Offer ID assigned by Mirakl */
  offer_id?: number;
}

/**
 * Response from Mirakl O11 API (create/update offers).
 */
export interface MiraklOfferCreateResponse {
  /** Import ID for tracking the offer import */
  import_id: number;
  /** Status of the import */
  status?: string;
}

// ============================================================
// OF24 API - Update Inventory/Price
// ============================================================

/**
 * Single offer update for OF24 API.
 */
export interface MiraklOfferUpdate {
  /** Shop SKU (our internal SKU) */
  shop_sku: string;
  /** Updated quantity */
  quantity?: number;
  /** Updated price */
  price?: number;
  /** Whether offer is active */
  active?: boolean;
  /** Discount price */
  discount_price?: number;
  /** Discount start date */
  discount_start_date?: string;
  /** Discount end date */
  discount_end_date?: string;
}

/**
 * Request body for Mirakl OF24 API (update offers).
 * PUT /api/offers
 */
export interface MiraklInventoryUpdateRequest {
  /** Array of offer updates */
  offers: MiraklOfferUpdate[];
}

/**
 * Single item result from OF24 API response.
 */
export interface MiraklInventoryUpdateResponseItem {
  /** Shop SKU */
  shop_sku: string;
  /** Whether the update was successful */
  status: string;
  /** Error message if failed */
  error_message?: string;
}

/**
 * Response from Mirakl OF24 API (update offers).
 */
export interface MiraklInventoryUpdateResponse {
  /** Import ID for tracking the update */
  import_id: number;
  /** Status of the import */
  status?: string;
}

// ============================================================
// Debenhams Adapter Result Types
// ============================================================

/**
 * Result of offer creation operation.
 */
export interface DebenhamsOfferCreateResult {
  /** Whether the operation completed successfully */
  success: boolean;
  /** Number of offers submitted */
  offersSubmitted: number;
  /** Number of offers that failed */
  offersFailed: number;
  /** Mirakl import ID for tracking */
  importId?: number;
  /** Error messages */
  errors: Array<{ sku: string; error: string }>;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of inventory sync operation.
 */
export interface DebenhamsInventorySyncResult {
  /** Whether the operation completed successfully */
  success: boolean;
  /** Number of items processed */
  itemsProcessed: number;
  /** Number of items that failed */
  itemsFailed: number;
  /** Mirakl import IDs for tracking */
  importIds: number[];
  /** Error messages */
  errors: Array<{ sku: string; error: string }>;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Options for offer creation.
 */
export interface DebenhamsOfferCreateOptions {
  /** Limit number of offers to create */
  limit?: number;
  /** Show what would be done without making API calls */
  dryRun?: boolean;
}

/**
 * Options for inventory sync.
 */
export interface DebenhamsInventorySyncOptions {
  /** Sync all items, not just changes */
  full?: boolean;
  /** Items per API request */
  batchSize?: number;
  /** Show what would be synced without making API calls */
  dryRun?: boolean;
}
