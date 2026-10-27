/**
 * Shared product-code lookup used by both the product-code field in Step 1
 * (typed by hand) and the new Step 0 barcode flow (resolved from barcode).
 *
 * Wraps GET /api/products/check-code/:code and shapes the response into the
 * same `SavedProductInfo` bundle that NewProductPage's `handleProductSaved`
 * already consumes, so downstream wizard behavior is identical regardless of
 * which entry point triggered the lookup.
 */

import { api } from '@/lib/api';

export interface SavedProductInfo {
  productCode: string;
  productName: string;
  teamName: string;
  season: string;
  price: number;
  productTypeId: string;
  productTypeName?: string;
  manufacturerName?: string;
  frontImage: string;
  backImage: string;
  additionalImage: string;
  codeStatus: 'new' | 'existing';
  descriptionNotes?: string;
  productAttributes?: Record<string, string>;
  savedPrimaryImageUrl?: string | null;
  savedAdditionalImageUrls?: string[];
  savedBackImageUrl?: string | null;
  allowsPersonalisation?: boolean;
  countryOfOriginId?: number | null;
  countryOfOriginName?: string;
  /** product_lists.hs_code — the commodity code the goods are declared under
   *  (PMS #166509). Digits only. Null/undefined when the code has none. */
  hsCode?: string | null;
}

export type ProductLookupResult =
  | { codeStatus: 'new' }
  | {
      codeStatus: 'existing';
      productListsId: number;
      product: CheckCodeProduct;
      savedInfo: SavedProductInfo;
    };

/** Mirrors the `product` payload returned by /api/products/check-code. */
export interface CheckCodeProduct {
  product_lists_id: number;
  product_code: string;
  product_name: string;
  team_name: string | null;
  season: string | null;
  price: number;
  product_type: number | null;
  manufacturer_name: string | null;
  front_image_url: string | null;
  back_image_url: string | null;
  additional_image_url: string | null;
  description_notes: string | null;
  products_attributes: Record<string, string> | null;
  saved_primary_image_url: string | null;
  saved_additional_image_urls: string[];
  saved_back_image_url: string | null;
  allows_personalisation: boolean;
  country_of_origin_id: number | null;
  country_of_origin: string | null;
  hs_code: string | null;
}

type ProductTypeRow = { type_id: number; type_name: string };

/**
 * Build the SavedProductInfo bundle from a /check-code product payload.
 * Kept pure so callers can apply it however they like (form.setValue, parent
 * callback, etc.).
 */
export function buildSavedInfoFromCheckCode(
  code: string,
  p: CheckCodeProduct,
  productTypesData: ProductTypeRow[] | undefined,
): SavedProductInfo {
  const typeIdStr = p.product_type ? String(p.product_type) : '';
  const typeName = productTypesData?.find((pt) => String(pt.type_id) === typeIdStr)?.type_name;
  return {
    productCode: code.trim(),
    productName: p.product_name || '',
    teamName: p.team_name || '',
    season: p.season || '',
    price: Number(p.price) || 0,
    productTypeId: typeIdStr,
    productTypeName: typeName,
    manufacturerName: p.manufacturer_name || '',
    frontImage: p.front_image_url || '',
    backImage: p.back_image_url || '',
    additionalImage: p.additional_image_url || '',
    codeStatus: 'existing',
    descriptionNotes: p.description_notes ?? '',
    productAttributes: p.products_attributes ?? {},
    savedPrimaryImageUrl: p.saved_primary_image_url ?? null,
    savedAdditionalImageUrls: p.saved_additional_image_urls ?? [],
    savedBackImageUrl: p.saved_back_image_url ?? null,
    allowsPersonalisation: !!p.allows_personalisation,
    countryOfOriginId: p.country_of_origin_id ?? null,
    countryOfOriginName: p.country_of_origin ?? undefined,
    hsCode: p.hs_code ?? null,
  };
}

/**
 * Fetch product details by product code. Returns a discriminated union the
 * caller can switch on. Throws on network failure — callers decide how to
 * surface the error.
 */
export async function fetchProductLookupByCode(
  code: string,
  productTypesData: ProductTypeRow[] | undefined,
): Promise<ProductLookupResult> {
  const trimmed = code.trim();
  if (!trimmed) return { codeStatus: 'new' };

  const res = await api.get(`/products/check-code/${encodeURIComponent(trimmed)}`);
  const result = res.data.data as { exists: boolean; product?: CheckCodeProduct };

  if (!result.exists || !result.product) {
    return { codeStatus: 'new' };
  }

  const p = result.product;
  const savedInfo = buildSavedInfoFromCheckCode(trimmed, p, productTypesData);

  return {
    codeStatus: 'existing',
    productListsId: p.product_lists_id,
    product: p,
    savedInfo,
  };
}

export interface BarcodeLookupResult {
  exists: boolean;
  productListsId?: number;
  productCode?: string;
}

/** Wraps GET /api/products/check-barcode/:barcode. */
export async function checkBarcode(barcode: string): Promise<BarcodeLookupResult> {
  const trimmed = barcode.trim();
  if (!trimmed) return { exists: false };
  const res = await api.get(`/products/check-barcode/${encodeURIComponent(trimmed)}`);
  return res.data.data as BarcodeLookupResult;
}

/**
 * Fetch the full product bundle by barcode. Chains check-barcode → check-code
 * so callers (e.g. Step 0 BarcodeStep) get a single named entry point that
 * reflects intent ("by barcode") rather than leaking the two-step resolution.
 *
 * Returns:
 *   - { codeStatus: 'new' } when the barcode is unknown OR when the resolved
 *     product code no longer loads (defensive fallback; rare).
 *   - { codeStatus: 'existing', ... } with the same SavedProductInfo bundle
 *     that fetchProductLookupByCode produces, so downstream wizard behavior
 *     is identical regardless of which path resolved the product.
 */
export async function fetchProductLookupByBarcode(
  barcode: string,
  productTypesData: ProductTypeRow[] | undefined,
): Promise<ProductLookupResult> {
  const trimmed = barcode.trim();
  if (!trimmed) return { codeStatus: 'new' };

  const bc = await checkBarcode(trimmed);
  if (!bc.exists || !bc.productCode) {
    return { codeStatus: 'new' };
  }
  return fetchProductLookupByCode(bc.productCode, productTypesData);
}
