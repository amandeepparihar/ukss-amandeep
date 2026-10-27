/**
 * Fruugo Type Definitions
 *
 * TypeScript interfaces for Fruugo-specific data structures.
 */

import type { Decimal } from '@prisma/client/runtime/library';

// ============================================
// Database Query Types
// ============================================

/**
 * Product row from SMS database query.
 * Maps to the JOIN result of new_products + new_products_variations + related tables.
 */
export interface FruugoProductRow {
  // From new_products_variations
  fruugo_quantity: number;
  npv_products_sku: string;
  npv_products_barcodes: string | null;
  npv_products_name: string;
  npv_size_options_value_id: number;

  // From new_products
  products_id: number;
  manufacturers_name: string | null;
  virtual_product_type_id: number | null;
  products_image: string | null;
  fruugo_category_path: string | null;
  products_description: string | null;
  np_color: string | null;
  np_sizeguide: string | null;
  products_price: number | Decimal;
  specials_price: number | Decimal | null;

  // From products_options_values
  products_options_values_name: string;
  shortname: string | null;
}

/**
 * Inventory item from database for sync.
 */
export interface FruugoInventoryItem {
  /** Internal listing ID (from MarketplaceListing) */
  id: string;
  /** UKSS SKU (npv_products_sku) */
  ukssSku: string;
  /** Fruugo's SKU ID */
  fruugoSkuId: string;
  /** Current quantity */
  quantity: number;
  /** Last synced quantity (for change detection) */
  lastSyncedQuantity?: number | null;
}

/**
 * SKU mapping from Fruugo listings API.
 */
export interface FruugoSkuMapping {
  /** Fruugo's SKU identifier */
  fruugoSkuId: string;
  /** Merchant's SKU (npv_products_sku) */
  merchantSkuId: string;
  /** Current stock level on Fruugo */
  quantity: number;
}

// ============================================
// CSV Feed Types
// ============================================

/**
 * CSV row for Fruugo product feed.
 * Exactly 22 columns as required by Fruugo specification.
 */
export interface FruugoCsvRow {
  ProductId: string;
  SkuId: string;
  EAN: string;
  ISBN: string;
  Brand: string;
  Manufacturer: string;
  Category: string;
  Imageurl1: string;
  StockStatus: 'INSTOCK' | 'OUTOFSTOCK';
  StockQuantity: number;
  RestockDate: string;
  LeadTime: number;
  PackageWeight: string;
  Language: string;
  Title: string;
  Description: string;
  AttributeColor: string;
  AttributeSize: string;
  Currency: string;
  Country: string;
  NormalPriceWithVAT: number | string;
  VATRate: number;
}

/**
 * CSV header row for Fruugo feed.
 */
export const FRUUGO_CSV_HEADERS: (keyof FruugoCsvRow)[] = [
  'ProductId',
  'SkuId',
  'EAN',
  'ISBN',
  'Brand',
  'Manufacturer',
  'Category',
  'Imageurl1',
  'StockStatus',
  'StockQuantity',
  'RestockDate',
  'LeadTime',
  'PackageWeight',
  'Language',
  'Title',
  'Description',
  'AttributeColor',
  'AttributeSize',
  'Currency',
  'Country',
  'NormalPriceWithVAT',
  'VATRate',
];

// ============================================
// API Response Types
// ============================================

/**
 * Fruugo listings API response structure.
 */
export interface FruugoListingsResponse {
  root: {
    '@numberOfPages': string;
    sku: FruugoListingsSku | FruugoListingsSku[];
  };
}

/**
 * Single SKU element from listings response.
 */
export interface FruugoListingsSku {
  '@fruugoSkuId': string;
  '@merchantSkuId': string;
  itemsInStock: string;
}

/**
 * Fruugo inventory update response.
 */
export interface FruugoInventoryResponse {
  // Response structure varies - typically just HTTP status code matters
  status?: string;
  message?: string;
}

// ============================================
// Sync Result Types
// ============================================

/**
 * Result of syncing a single inventory item.
 */
export interface FruugoSyncItemResult {
  /** Listing ID */
  id: string;
  /** UKSS SKU */
  ukssSku: string;
  /** Fruugo SKU ID */
  fruugoSkuId: string;
  /** Whether sync was successful */
  success: boolean;
  /** Synced quantity (if successful) */
  syncedQuantity?: number;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Feed generation result.
 */
export interface FruugoFeedResult {
  /** Whether generation was successful */
  success: boolean;
  /** Path to generated file */
  filePath?: string;
  /** Number of products in feed */
  itemCount: number;
  /** Generation duration in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Inventory sync result.
 */
export interface FruugoInventorySyncResult {
  /** Whether sync was successful overall */
  success: boolean;
  /** Number of items successfully synced */
  itemsProcessed: number;
  /** Number of items that failed */
  itemsFailed: number;
  /** Number of new items (first sync) */
  newItems?: number;
  /** Sync duration in ms */
  duration: number;
  /** Error details for failed items */
  errors?: Array<{ sku: string; error: string }>;
}

/**
 * SKU sync result.
 */
export interface FruugoSkuSyncResult {
  /** Whether sync was successful */
  success: boolean;
  /** Total pages fetched */
  pagesFetched: number;
  /** Total SKU mappings found */
  totalMappings: number;
  /** Number of database records updated */
  recordsUpdated: number;
  /** Number of failed updates */
  recordsFailed: number;
  /** Sync duration in ms */
  duration: number;
}

// ============================================
// Options Types
// ============================================

/**
 * Options for inventory sync.
 */
export interface FruugoInventorySyncOptions {
  /** Sync all items, not just changes */
  full?: boolean;
  /** Override batch size */
  batchSize?: number;
  /** Dry run - don't actually sync */
  dryRun?: boolean;
}

/**
 * Options for SKU sync.
 */
export interface FruugoSkuSyncOptions {
  /** Starting page number */
  pageFrom?: number;
  /** Ending page number */
  pageTo?: number;
  /** Dry run - don't update database */
  dryRun?: boolean;
}

/**
 * Options for feed generation.
 */
export interface FruugoFeedOptions {
  /** Dry run - don't write file */
  dryRun?: boolean;
  /** Skip archiving old feed */
  skipArchive?: boolean;
  /** Limit number of products to include */
  limit?: number;
  /** Chunk size for streaming (default: FEED_CHUNK_SIZE from config) */
  chunkSize?: number;
}
