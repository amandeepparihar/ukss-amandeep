/**
 * Sportdeal Type Definitions
 *
 * TypeScript interfaces for Sportdeal-specific data structures.
 */

import type { Decimal } from '@prisma/client/runtime/library';

// ============================================
// Database Query Types
// ============================================

/**
 * Product row from SMS database query for product feed.
 * Maps to the JOIN result of new_products + new_products_variations + related tables.
 */
export interface SportdealProductRow {
  // From new_products_variations
  npv_products_sku: string;
  npv_products_barcodes: string | null;
  npv_products_name: string;
  npv_quantities: number;
  sportdeal_quantity: number;

  // From new_products
  products_id: number;
  manufacturers_name: string | null;
  products_image: string | null;
  products_description: string | null;
  np_color: string | null;
  np_gender: string | null;
  np_season: string | null;
  products_price: number | Decimal;
  specials_price: number | Decimal | null;

  // From products_options_values
  products_options_values_name: string;
  shortname: string | null;

  // From categories (optional - may not be set)
  categories_name?: string | null;
}

/**
 * Inventory item from database for delta inventory feed.
 */
export interface SportdealInventoryItem {
  /** UKSS SKU (npv_products_sku) */
  sku: string;
  /** EAN Barcode */
  barcode: string;
  /** Current quantity */
  quantity: number;
  /** Last synced quantity (for change detection) */
  lastSyncedQuantity: number;
  /** Regular price */
  price: number;
  /** Special/sale price */
  specialPrice: number | null;
}

// ============================================
// XML Feed Types
// ============================================

/**
 * XML product element for Sportdeal product feed.
 */
export interface SportdealXmlProduct {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  brand: string;
  price: string;
  special_price: string;
  quantity: number;
  size: string;
  color: string;
  gender: string;
  season: string;
  image: string;
  category: string;
}

/**
 * XML inventory element for Sportdeal inventory feed.
 */
export interface SportdealXmlInventoryItem {
  sku: string;
  barcode: string;
  quantity: number;
  price: string;
  special_price: string;
}

// ============================================
// Result Types
// ============================================

/**
 * Feed generation result.
 */
export interface SportdealFeedResult {
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
 * Inventory feed generation result.
 */
export interface SportdealInventoryFeedResult {
  /** Whether generation was successful */
  success: boolean;
  /** Path to generated file */
  filePath?: string;
  /** Number of items in feed */
  itemCount: number;
  /** Number of items with quantity changes */
  changedItems: number;
  /** Generation duration in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
}

// ============================================
// Options Types
// ============================================

/**
 * Options for product feed generation.
 */
export interface SportdealFeedOptions {
  /** Dry run - don't write file */
  dryRun?: boolean;
  /** Skip archiving old feed */
  skipArchive?: boolean;
  /** Limit number of products to include */
  limit?: number;
  /** Chunk size for streaming (default: FEED_CHUNK_SIZE from config) */
  chunkSize?: number;
}

/**
 * Options for inventory feed generation.
 */
export interface SportdealInventoryFeedOptions {
  /** Dry run - don't write file */
  dryRun?: boolean;
  /** Skip archiving old feed */
  skipArchive?: boolean;
  /** Generate full feed instead of delta */
  full?: boolean;
  /** Chunk size for streaming (default: FEED_CHUNK_SIZE from config) */
  chunkSize?: number;
}
