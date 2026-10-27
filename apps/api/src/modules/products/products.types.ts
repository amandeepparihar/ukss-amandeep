/**
 * New Product Module — Type definitions.
 * Requirements: REQ-1 through REQ-7
 */

// Re-export TxClient from orders module (single source of truth per CLAUDE.md "no duplicate code" rule)
export type { TxClient } from '../orders/processing/processing.types';

// ---------------------------------------------------------------------------
// Lookup result types (REQ-6)
// ---------------------------------------------------------------------------

export interface Team {
  teams_id: number;
  team_name: string;
  team_type: string;
}

export interface Season {
  seasons_id: number;
  season: string;
}

export interface ProductTypeRecord {
  type_id: number;
  type_name: string;
}

export interface SizeOption {
  products_options_id: number;
  products_options_name: string;
}

export interface SizeGroup {
  sms_size_groups_id: number;
  size_group_name: string;
  products_options_id: number;
}

export interface Size {
  manufacturers_sizes_to_default_sizes_id: number;
  manufacturer_size_shortname: string;
  default_options_values_id: number;
}

export interface Box {
  box_lists_id: number;
  box_code: string;
}

export interface Color {
  attribute_id: number;
  attribute_name: string;
}

export interface SleeveLength {
  option_id: number;
  option_name: string;
}

export interface Manufacturer {
  manufacturers_id: number;
  manufacturers_name: string;
}

export interface Country {
  countries_id: number;
  countries_name: string;
}

export interface TeamCategory {
  team_categories_id: number;
  category_name: string;
}

// ---------------------------------------------------------------------------
// Product code types (REQ-1)
// ---------------------------------------------------------------------------

export interface ProductCodeInput {
  productCode: string;
  productName: string;
  teamName: string;
  season: string;
  price: number;
  productTypeId: number;
  manufacturerName?: string;
  frontImage?: string;
  backImage?: string;
  additionalImage?: string;
  /** Persisted on product_lists.allows_personalisation; later forwarded to the
   *  Dify description workflow as the add_legends gate. */
  allowsPersonalisation?: boolean;
  /** product_lists.country_of_origin_id — FK to countries. Optional. */
  countryOfOriginId?: number | null;
  /** product_lists.hs_code — the commodity code the goods are declared under
   *  (PMS #166509). Digits only, 6–10 of them, separators already stripped by
   *  the schema. Written across the whole product code family, like the country. */
  hsCode?: string | null;
}

export interface ProductCodeResult {
  productListsId: number;
  isNew: boolean;
  productCode: string;
  mapStatus: number;
}

// ---------------------------------------------------------------------------
// Product code data (for check-code lookup)
// ---------------------------------------------------------------------------

export interface ProductCodeData {
  product_lists_id: number;
  product_code: string;
  product_name: string;
  teams_id: number;
  team_name: string;
  seasons_id: number;
  season: string;
  price: number;
  product_type: number | null;
  manufacturers_id: number | null;
  manufacturer_name: string | null;
  front_image_url: string | null;
  back_image_url: string | null;
  additional_image_url: string | null;
  map_status: number;
  products_code_type: number;
  // Saved-detail fields surfaced for wizard pre-population on existing codes.
  // description_notes / products_attributes are written by save-details on
  // product_lists; the *_image columns are bare filenames that we resolve to
  // full CDN URLs server-side so the UI can render them directly.
  description_notes: string | null;
  products_attributes: Record<string, string>;
  saved_primary_image_url: string | null;
  saved_additional_image_urls: string[];
  /** product_lists.product_code_back_img — bare filename resolved to a CDN URL.
   *  Lets the wizard restore the "Back" button's active state on reload. */
  saved_back_image_url: string | null;
  /** product_lists.allows_personalisation — boolean. Wizard Step 1 surfaces this
   *  as the "Personalize Product?" checkbox; it later gates the AI description
   *  workflow's add_legends section. */
  allows_personalisation: boolean;
  /** product_lists.country_of_origin_id — FK to countries. Null when unset. */
  country_of_origin_id: number | null;
  /** product_lists.country_of_origin — denormalized country name (display). */
  country_of_origin: string | null;
  /** product_lists.hs_code — commodity code, digits only. Null when unset.
   *  Prefills the form's HS Code box on product-code blur (PMS #166509). */
  hs_code: string | null;
}

// ---------------------------------------------------------------------------
// Duplicate detection (Product Automation Improvement — Robert's Brazil-shirt case)
// ---------------------------------------------------------------------------

/** Input to the duplicate-detection endpoint. All fields optional except the
 *  structured key (team + season + productTypeId) which drives Tier-1 matching.
 *  When the key can't be resolved (brand-new team/season), only Tier-2 fuzzy
 *  matching runs. */
export interface CheckDuplicatesInput {
  teamName: string;
  season: string;
  productTypeId: number;
  /** Score boosters, sourced from the wizard's attribute selections. */
  ageGroup?: string;
  color?: string;
  gender?: string;
  manufacturerName?: string;
  productName?: string;
  /** The code currently being created/edited — excluded from candidates so a
   *  product never flags itself. */
  excludeProductCode?: string;
}

/** Live status of a candidate, derived from the products row it maps to via
 *  products.products_model = product_lists.product_code (the mapping gate). */
export type DuplicateStatus = 'active' | 'archived' | 'unmapped';

export interface DuplicateCandidate {
  productListsId: number;
  productCode: string;
  productName: string | null;
  teamName: string | null;
  season: string | null;
  productTypeName: string | null;
  ageGroup: string | null;
  color: string | null;
  status: DuplicateStatus;
  frontImageUrl: string | null;
  /** 0–100 relevance score used for ranking. Higher = more likely a duplicate. */
  matchScore: number;
  /** 'strong' candidates (shared colour or age group, or a close fuzzy title
   *  hit) require operator acknowledgement before Save. 'weak' are advisory. */
  strength: 'strong' | 'weak';
  matchSource: 'structured' | 'fuzzy' | 'both';
  /** Human-readable list of the attributes that matched, for the UI. */
  matchedFields: string[];
}

export interface CheckDuplicatesResult {
  candidates: DuplicateCandidate[];
  /** Total structured matches on the team+season+type key (may exceed the
   *  returned candidate count, which is capped). Lets the UI say "N possible". */
  total: number;
  /** True when at least one strong candidate exists — the wizard requires a
   *  tick-to-proceed before saving in that case (warn + acknowledge). */
  requiresAcknowledgement: boolean;
}

// ---------------------------------------------------------------------------
// Inventory types (REQ-3, REQ-4)
// ---------------------------------------------------------------------------

export interface InventoryEntry {
  boxCode: string;
  quantity: number;
  action: 'add' | 'subtract';
}

export interface InventoryInput {
  productListsId: number;
  barcode: string;
  sizeOptionId: number;
  sizeGroupId: number;
  sizeId: number;
  weight: number;
  entries: InventoryEntry[];
}

export interface InventoryEntryResult {
  boxCode: string;
  previousQuantity: number;
  newQuantity: number;
  action: 'add' | 'subtract';
  isNewRow: boolean;
}

export interface InventoryRow {
  product_quantities_id: number;
  barcode: string;
  manufacturer_size_shortname: string;
  weight: number;
  box_code: string;
  quantity: number;
  added_by: string;
  date_added: string;
  /** Brand option (e.g. Adidas Adult). Used by InventoryEntryForm to pre-fill
   *  the size cascade — the product is locked to one option/group, so all rows
   *  share the same value. Nullable in case of legacy rows with broken joins. */
  products_options_id: number | null;
  /** Size group (e.g. UK Adult Sizes). Same locking rule as products_options_id. */
  sms_size_groups_id: number | null;
}

// ---------------------------------------------------------------------------
// Dify AI workflow types (Step 3 Images, Step 4 Description)
// ---------------------------------------------------------------------------

export interface GenerateImagesInput {
  productName: string;
  productCode: string;
  team?: string;
  season?: string;
  manufacturerName?: string;
  numberOfKeywords?: number;
  numberOfResults?: number;
  enhancementPrompt?: string;
  excludeUrls?: string[];
}

export interface GenerateDescriptionInput {
  productName: string;
  productCode: string;
  brand?: string;
  teamName?: string;
  season?: string;
  category?: string;
  sport?: string;
  gender?: string;
  color?: string;
  material?: string;
  league?: string;
  targetMarket?: string;
  tone?: string;
  language?: string;
  seoKeywords?: string;
  price?: number;
  /** Optional reference images for the vision-enabled description LLM —
   *  used when the user wants the model to read attributes (sleeve length,
   *  neckline, badges) directly off a product photo. Each ref is either a
   *  remote URL (gallery pick or pasted URL) or a Dify upload-file-id
   *  (returned by POST /products/dify/upload-image after a local file upload). */
  images?: DescriptionImageRef[];
  enhancementPrompt?: string;
  /** When true, the Dify workflow weaves a personalisation paragraph into the
   *  description that mentions name/number customisation and references current
   *  first-team players + legends for `teamName`. Forced off Dify-side when
   *  `teamName` is empty. Backed by `product_lists.allows_personalisation`. */
  addLegends?: boolean;
}

export type DescriptionImageRef = { url: string } | { uploadFileId: string };

export interface DifyImagesResult {
  workflowRunId: string;
  status: string;
  outputs: Record<string, unknown>;
  elapsedTime?: number;
}

export interface DifyDescriptionResult {
  workflowRunId: string;
  status: string;
  outputs: Record<string, unknown>;
  elapsedTime?: number;
}

// ---------------------------------------------------------------------------
// Save Details types (Images + Description save)
// ---------------------------------------------------------------------------

export interface SaveDetailsInput {
  productListsId: number;
  productCode: string;
  primaryImageUrl: string | null;
  backImageUrl: string | null;
  additionalImageUrls: string[];
  descriptionNotes: string;
  productAttributes: Record<string, string>;
  // Background removal flags
  removeBackgroundForPrimary: boolean;
  removeBackgroundForBack: boolean;
  removeBackgroundImageUrls: string[];
  /** Manual crop flags — cropped images arrive as `data:` URIs whose framing
   *  is final, so they skip auto-trim (and Dify upscale) at save time. */
  manualCropForPrimary?: boolean;
  manualCropForBack?: boolean;
  manualCropImageUrls?: string[];
  /** Maps each cropped data URI → its pre-crop source URL, so the backend can
   *  persist the un-cropped original for full-resolution re-crops. */
  manualCropOriginals?: Record<string, string>;
  /** URLs of every image the user uploaded via POST /api/products/upload-image
   *  during this wizard session. After save, any upload that wasn't selected
   *  (not primary, back, or additional) is deleted from disk. */
  uploadedImageUrls?: string[];
}

export interface SaveDetailsResult {
  success: boolean;
  primaryImage: string | null;
  backImage: string | null;
  additionalImages: string[];
  descriptionSaved: boolean;
  attributesSaved: boolean;
  // Background removal results
  backgroundRemovalResults?: {
    primaryRemoved: boolean;
    backRemoved: boolean;
    additionalRemoved: string[];
    errors: string[];
  };
  /** Final on-disk filenames that were saved from a manual crop. Used by the
   *  save-details route to write one audit-log entry per crop-including save. */
  manualCropFilenames?: string[];
}
