/**
 * Product Feeds Module - Type Definitions
 *
 * All TypeScript interfaces for the product feed generation system.
 * Source of truth for the `product_variation_view` columns and processed
 * product shapes used across the data / processors / generators layers.
 */

// ---------------------------------------------------------------------------
// Raw database row shape - matches columns from product_variation_view
// ---------------------------------------------------------------------------

export interface ProductVariationRow {
  ovid: number;
  pfv_product_variation_size: string | null;
  agegroup: string | null;
  pfv_product_id: number;
  sku: string | null;
  pfv_product_variation_name: string | null;
  mpn: string | null;
  gtin: string | null;
  main_image: string | null;
  color: string | null;
  hero_shirts: number | null;
  your_name: number | null;
  manufacturer_name: string | null;
  description: string | null;
  virtual_product_type_id: number | null;
  products_type: number | null;
  href_link: string | null;
  products_rrp_price: string | number | null;
  available_from: Date | string | null;
  t_modified: Date | string | null;
  base_date: Date | string | null;
  league: string | null;
  team: string | null;
  np_team_id: number | null;
  team_type: string | null;
  sleevelength: string | null;
  season: string | null;
  bestseller_update_date: Date | string | null;
  bestsellers_count: number | null;
  qty: number | null;
  canvas_product: number | null;
  modifiedDate: Date | string | null;
  gender: string | null;
  products_price: string | number;
  products_model: string | null;
  product_is_free: number | null;
  products_priced_by_attribute: number | null;
  products_sort_order: number | null;
  specials_status: string | null;
  specials_price: string | number | null;
  non_vat: string | null;
  products_to_categories: string | null;
  additional_img: string | null;
  products_quantity: number | null;
  products_weight: string | number | null;
  continent: string | null;
  player_name: string | null;
  material: string | null;
  products_name: string | null;
  master_categories_id: number | null;
  print: number;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ActiveSale {
  sale_deduction_value: number;
  sale_deduction_type: number;
  sale_categories_all: string;
  sortorder_to_exclude: string;
  sale_pricerange_from: number;
  sale_pricerange_to: number;
}

export interface WeekendOffer {
  id: number;
  exclude_categories: string;
}

export interface DealRow {
  deal_type: 'DAILY' | 'WEEKLY' | 'PERMANENT';
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: number;
}

export interface PricingResult {
  productOrgPrice: number;
  productSalePrice: number | null;
}

export type CheckDealsFn = (
  productId: number,
  teamId: number | null,
  productPrice: number,
) => Promise<number | null>;

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export interface ShippingMethod {
  id: 'flat' | 'zones' | 'courier' | 'supersaver';
  module: string;
  text: string;
  title: string;
  cost: string;
  time: string;
}

export type ShippingMethodMap = Map<string, ShippingMethod[]>;

// ---------------------------------------------------------------------------
// Processed Product (built by product-builder from raw rows)
// ---------------------------------------------------------------------------

export interface ProductVariant {
  item_id: string;
  item_item_group_id: string;
  item_varID: number;
  item_size?: string;
  item_gtin?: string;
  item_custom_label_1?: string;
}

export interface CustomLabel3 {
  all: string;
  facebook: string;
  shoptimized: string;
}

export interface ProcessedProduct {
  item_item_group_id: string;
  item_variants: ProductVariant[];
  item_title: string;
  item_description: string;
  item_link: string;
  item_canonical_link: string;
  item_condition: string;
  item_price: number;
  item_google_product_category: number;
  item_product_type: string[];
  item_image_link?: string;
  item_sale_price?: number;
  item_brand?: string;
  item_age_group?: string;
  item_gender?: string;
  item_material?: string;
  item_color?: string;
  item_mpn?: string;
  item_shipping: string;
  item_custom_label_0?: string;
  item_custom_label_2: string;
  item_custom_label_3: CustomLabel3;
  item_custom_label_4: string;
}

export interface ProductTeamInfo {
  team: string;
  continent: string;
}

// ---------------------------------------------------------------------------
// Feed types and country codes
// ---------------------------------------------------------------------------

export type FeedType = 'all' | 'facebook' | 'shoptimized' | 'marketplace' | 'fifa-world-cup';

export type CountryCode =
  | 'UK'
  | 'EU'
  | 'US'
  | 'AU'
  | 'CA'
  | 'NZ'
  | 'AE'
  | 'SG'
  | 'CH';

export interface CountryInfo {
  currency: string;
  file: string;
}

export interface CurrencyRate {
  code: string;
  value: number;
}

// ---------------------------------------------------------------------------
// CLI / Orchestrator options and results
// ---------------------------------------------------------------------------

export interface FeedGenerationOptions {
  dryRun?: boolean;
  skipUpload?: boolean;
  skipCompress?: boolean;
  skipImageColor?: boolean;
  country?: CountryCode;
  type?: FeedType;
  limit?: number;
  chunkSize?: number;
}

export interface FeedFileResult {
  file: string;
  path: string;
  bytes: number;
  itemCount: number;
  compressed: boolean;
}

export interface UploadResult {
  target: 'google' | 'microsoft';
  filesUploaded: number;
  filesFailed: number;
  errors: string[];
}

export interface FeedRunReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  productsProcessed: number;
  feedsGenerated: FeedFileResult[];
  uploads: UploadResult[];
  dryRun: boolean;
  errors: string[];
}
