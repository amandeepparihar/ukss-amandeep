/**
 * Deliveries write-path mutations.
 *
 * Backend endpoints (apps/api/src/modules/deliveries/deliveries.write.routes.ts):
 *   PATCH /api/deliveries/cells
 *   PATCH /api/deliveries/image-added/:productCode
 *   GET   /api/deliveries/image-urls/:productCode
 *   POST  /api/deliveries/link-quantity/:productCode
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface WriteOk<T> {
  ok: true;
  data: T;
}
interface WriteErr {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
}
export type WriteResult<T> = WriteOk<T> | WriteErr;

function unwrap<T>(res: WriteResult<T>): T {
  if (res.ok) return res.data;
  const err: Error & { code?: string } = new Error(res.error || 'request failed');
  err.code = res.code;
  throw err;
}

// ---------------------------------------------------------------------------
// Inline cell edit (season / price / option_<N>)
// ---------------------------------------------------------------------------

export interface InlineEditPayload {
  productQuantitiesId: number;
  column: string; // 'season' | 'price' | 'option_<N>'
  value: string;
}

export interface InlineEditResult {
  productQuantitiesId: number;
  column: string;
  value: string;
  previousQuantity?: number;
  newRowQuantity?: number;
}

export function useInlineCellEdit() {
  const qc = useQueryClient();
  return useMutation<InlineEditResult, Error, InlineEditPayload>({
    mutationFn: async (payload) => {
      const res = await api.patch<WriteResult<InlineEditResult>>('/deliveries/cells', payload);
      return unwrap(res.data);
    },
    onSuccess: () => {
      // Invalidate the listing so subsequent navigations / refreshes see the
      // new server-side row state. We do NOT optimistically patch local rows
      // because the row-sum `quantity` recompute on size edits is non-trivial.
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Image-added toggle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Image URLs viewer
// ---------------------------------------------------------------------------

export interface SmsImage {
  label: string;
  url: string;
  primary: boolean;
}

export interface ImageUrlsResult {
  productCode: string;
  // Built server-side from product_lists.product_code_image (primary) +
  // product_code_additional_img (CSV). Used by both the Add SMS Product
  // form's Image Preview popup and the Deliveries grid's Image URLs viewer.
  sms_image_urls: SmsImage[];
}

export function useImageUrls(productCode: string | null) {
  return useQuery<ImageUrlsResult>({
    queryKey: ['deliveries', 'image-urls', productCode],
    enabled: !!productCode,
    queryFn: async () => {
      const res = await api.get<WriteResult<ImageUrlsResult>>(
        `/deliveries/image-urls/${encodeURIComponent(productCode!)}`
      );
      return unwrap(res.data);
    },
  });
}

// ---------------------------------------------------------------------------
// Link / unlink quantity
// ---------------------------------------------------------------------------

export interface LinkQuantityResult {
  productCode: string;
  action: 'linked' | 'unlinked';
  productsAffected: number;
}

export function useLinkQuantityToggle() {
  const qc = useQueryClient();
  return useMutation<LinkQuantityResult, Error, { productCode: string; action?: 'link' | 'unlink' | 'toggle' }>({
    mutationFn: async ({ productCode, action = 'toggle' }) => {
      const res = await api.post<WriteResult<LinkQuantityResult>>(
        `/deliveries/link-quantity/${encodeURIComponent(productCode)}`,
        { action }
      );
      return unwrap(res.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Product form — GET pre-fill + POST submit Flow A
// ---------------------------------------------------------------------------

export interface PreSaveSnapshot {
  pscpd_id: number;
  pscpd_code: string;
  pscpd_cost_price: string | null;
  pscpd_title: string | null;
  pscpd_teamzo_product_title: string | null;
  pscpd_size_guide: number | null;
  pscpd_sleeve_length: number | null;
  pscpd_season_id: number | null;
  pscpd_colour: string | null;
  pscpd_type: number | null;
  pscpd_manufacturers_id: number | null;
  pscpd_category_id: number | null;
  pscpd_price: string | null;
  pscpd_teamzo_price: string | null;
  pscpd_rrp_price: string | null;
  pscpd_printing: string | null;
  pscpd_patch: string | null;
  pscpd_player1: string | null;
  pscpd_player2: string | null;
  pscpd_player3: string | null;
  pscpd_hero_shirt_queue: number | null;
  pscpd_products_options_id: number | null;
  pscpd_sms_size_groups_id: number | null;
}

export interface MappedProductSnapshot {
  products_id: number;
  products_model: string | null;
  products_name: string | null;
  products_description: string | null;
  products_price: string | null;
  products_rrp_price: string | null;
  manufacturers_id: number | null;
  master_categories_id: number | null;
  products_type: number | null;
  teamzo_name: string | null;
  selectedAttributes: Array<{
    options_id: number;
    options_values_id: number;
    options_values_price: string | null;
  }>;
  categoryIds: number[];
  extraInfo: Array<{ tId: number; oid: number }>;
  teamCustomKit: { groupname_id: number; size_id: number } | null;
}

export interface ReviewSnapshot {
  spr_id: number;
  product_name: string | null;
  teamzo_product_name: string | null;
  product_description: string | null;
  product_price: string | null;
  teamzo_price: string | null;
  rrp_price: string | null;
  product_manufacturer: number | null;
  master_category_id: number | null;
  products_type: number | null;
  product_season: number | null;
  season_sort_order: number | null;
  product_sizeguide: number | null;
  product_color: string | null;
  is_printing: string | null;
  players_name: string | null;
  product_image: string | null;
  product_additional_images: string | null;
  sleeve_patch: string | null;
  sleeve_length: string | null;
  glove_type: number | null;
  driver: number | null;
  product_size_option_id: number | null;
  product_size_option_value_ids: string | null;
  sms_size_groups_id: number | null;
  product_categories: string | null;
}

export interface FormDropdowns {
  leagues: Array<{ id: number; name: string }>;
  genericProductTypes: Array<{ id: number; name: string }>;
  productTypes: Array<{ id: number; name: string }>;
  manufacturers: Array<{ id: number; name: string }>;
  teamCategories: Array<{ id: number; name: string }>;
  trainingWearCategories: Array<{ id: number; name: string }>;
  teamGroups: Array<{ id: number; name: string }>;
  extraInfoTypes: Array<{
    id: number;
    name: string;
    options: Array<{ oid: number; option_name: string }>;
  }>;
  sleevePatches: Array<{
    products_options_values_to_products_options_id: number;
    products_options_values_name: string;
    options_values_price: string;
  }>;
  printingAttributes: Array<{
    products_options_values_to_products_options_id: number;
    products_options_values_name: string;
    default_price: string;
    options_id: number;
  }>;
  sizeAttributes: Array<{
    options_id: number;
    options_name: string;
    values: Array<{
      products_options_values_to_products_options_id: number;
      products_options_values_id: number;
      products_options_values_name: string;
      default_price: string;
    }>;
  }>;
  subCategoriesByParent: Array<{
    parent_id: number;
    categories_id: number;
    categories_name: string;
  }>;
}

export interface ProductFormPreFill {
  productCode: string;
  mappedProductId: number | null;
  preSave: PreSaveSnapshot | null;
  mapped: MappedProductSnapshot | null;
  /** Last sms_products_for_review row for this pcode, if any — lets the
   *  form re-hydrate the user's previously-submitted values on reopen. */
  reviewSnapshot: ReviewSnapshot | null;
  productList: {
    productName: string;
    season: string;
    seasonSort: number;
    barcode: string | null;
    manufacturersId: number | null;
    productType: number | null;
    teamsId: number | null;
    productAttributes: Record<string, string> | null;
  } | null;
  dropdowns: FormDropdowns;
  prefilledMandatoryFields: string[];
  heroShirtQueue: number;
  sizeAttributesForPcode: FormDropdowns['sizeAttributes'][number] | null;
  /** povtpo ids to pre-check (resolved via sms_size_groups +
   *  default_selected_size — see product-form.service.ts). */
  defaultSelectedSizeAttrs: number[];
  preSelectedNames: {
    manufacturer: string | null;
    teamCategory: string | null;
    season: string | null;
    sizeGuide: string | null;
    sleeveLength: string | null;
    gloveType: string | null;
    ageGroup: string | null;
    gender: string | null;
    productTypeAttribute: string | null;
    driver: string | null;
    nameNumberSetting: string | null;
    colors: string[];
  };
}

export function useProductFormLoad(pcode: string | null) {
  return useQuery<ProductFormPreFill>({
    queryKey: ['deliveries', 'product-form', pcode],
    enabled: !!pcode,
    queryFn: async () => {
      const res = await api.get<WriteResult<ProductFormPreFill>>('/deliveries/product-form', {
        params: { pcode },
      });
      return unwrap(res.data);
    },
    staleTime: 60_000,
  });
}

export interface SubmitForReviewPayload {
  mappedProductId?: string;
  called_from?: string;
  request_uri?: string;
  products_name: string;
  teamzo_products_name?: string;
  adults_products_model: string;
  products_description?: string;
  products_price?: number;
  products_teamzo_price?: number;
  products_rrp_price?: number;
  manufacturers_id?: number;
  master_category?: number;
  products_type_id?: number;
  product_type_id?: number;
  product_type_id_1?: number;
  product_type_id_2?: number;
  product_type_id_3?: number;
  product_type_id_4?: number;
  category_menu?: number[];
  attribute?: number[];
  extra_info_kids_1?: number[];
  extra_info_kids_2?: number[];
  extra_info_kids_3?: number[];
  extra_info_kids_4?: number[];
  extra_info_kids_5?: number[];
  extra_info_kids_6?: number[];
  extra_info_kids_7?: number[];
  extra_info_kids_8?: string[];
  extra_info_kids_sleeve_patch?: number[];
  player1?: string;
  player2?: string;
  player3?: string;
  products_options_id?: number;
  sms_size_group_id?: number;
  season_sort_order?: number;
  // Flow B fields (legacy form doesn't render these but Flow B writes them)
  hot_product?: number | boolean;
  products_copa?: number;
  products_toffs?: number;
  training_wear?: number[];
  training?: number[];
  grp_id?: number;
  kids_size_group_dropdown?: number;
  attributePrices?: Record<string, string>;
  attributePrefixes?: Record<string, string>;
  attributeSizes?: Record<string, number>;
  newExtraInfo?: Record<string, string>;
  sleevePatchPrices?: Record<string, string>;
  // Pre-own archive
  create_football?: string;
  football_kits_id?: number;
  league?: number;
  team_dropdown?: number;
}

export interface SubmitForReviewResult {
  spr_id: number;
  action: 'inserted' | 'updated';
  productCode: string;
  redirectTo: string;
}

export function useSubmitForReview() {
  const qc = useQueryClient();
  return useMutation<SubmitForReviewResult, Error, SubmitForReviewPayload>({
    mutationFn: async (body) => {
      const res = await api.post<WriteResult<SubmitForReviewResult>>(
        '/deliveries/product-form/submit',
        body
      );
      return unwrap(res.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Grid per-row actions — Map / Special / Assign Font / eBay
// ---------------------------------------------------------------------------

export interface MapCandidate {
  products_id: number;
  products_model: string | null;
  products_name: string | null;
  products_price: string | null;
  already_mapped: boolean;
}

export function useMapCandidates(
  productCode: string | null,
  categoryId: number | null = null
) {
  return useQuery<MapCandidate[]>({
    queryKey: ['deliveries', 'map-candidates', productCode, categoryId],
    enabled: !!productCode,
    queryFn: async () => {
      const params: Record<string, string | number> = { productCode: productCode! };
      if (categoryId) params.categoryId = categoryId;
      const res = await api.get<WriteResult<MapCandidate[]>>(
        '/deliveries/grid/map-candidates',
        { params }
      );
      return unwrap(res.data);
    },
    staleTime: 30_000,
  });
}

/**
 * Team / master category dropdown for the Map dialog. Cached aggressively —
 * categories rarely change.
 */
export function useTeamCategoriesForMap(enabled: boolean) {
  return useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['deliveries', 'team-categories'],
    enabled,
    queryFn: async () => {
      const res = await api.get<WriteResult<Array<{ id: number; name: string }>>>(
        '/deliveries/grid/team-categories'
      );
      return unwrap(res.data);
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Map dialog pre-fill data for a given SMS product_code.
 *
 *   - `defaultCategoryId`: derived from `product_lists.teams_id` →
 *     `teams.team_name` → category name match. The Map dialog auto-selects
 *     this on open so the operator doesn't have to navigate to their team's
 *     category every time.
 *   - `alreadyMappedCategoryIds`: legacy parity — categories the pcode's
 *     exact-match products are already linked to. Used to badge "mapped"
 *     entries in the dropdown so operators can quickly see prior mappings.
 *
 * Always fetched fresh on dialog open (no `staleTime`) — pre-fill must reflect
 * the latest mapping state.
 */
export interface MapPrefill {
  defaultCategoryId: number | null;
  alreadyMappedCategoryIds: number[];
}

export function useMapPrefill(productCode: string | null) {
  return useQuery<MapPrefill>({
    queryKey: ['deliveries', 'map-prefill', productCode],
    enabled: !!productCode,
    queryFn: async () => {
      const res = await api.get<WriteResult<MapPrefill>>(
        `/deliveries/grid/map-prefill/${encodeURIComponent(productCode!)}`
      );
      return unwrap(res.data);
    },
  });
}

/**
 * Special-dialog state. Mirrors legacy `set_specials.ctp` — top-level shared
 * date range + per-mapped-product rows with their own price, deal flags, and
 * nested size attributes.
 */
export interface SpecialStateSize {
  optionValueId: number;
  name: string;
  price: string;
  prefix: '+' | '-';
  startDate: string | null;
  endDate: string | null;
}
export interface SpecialStateProduct {
  productsId: number;
  productsName: string;
  productsModel: string;
  specialPrice: string;
  thursdayDeal: boolean;
  blackFridayDeal: boolean;
  cyberMondayDeal: boolean;
  megaFridayDeal: boolean;
  sizes: SpecialStateSize[];
}
export interface SpecialState {
  productCode: string;
  mappedProducts: number;
  /** True when the matched product is virtual_product_type_id = 4 (t-shirt
   *  virtual type). Legacy SMS shows a dedicated "You cannot set special price
   *  for Tshirt Virtual type product." message in this case (PMS 53126). */
  tshirtBlocked: boolean;
  startDate: string | null;
  endDate: string | null;
  products: SpecialStateProduct[];
}

export function useSpecialState(productCode: string | null) {
  return useQuery<SpecialState>({
    queryKey: ['deliveries', 'special-state', productCode],
    enabled: !!productCode,
    queryFn: async () => {
      const res = await api.get<WriteResult<SpecialState>>(
        `/deliveries/grid/special-state/${encodeURIComponent(productCode!)}`
      );
      return unwrap(res.data);
    },
  });
}

export interface MapToZcPayload {
  productCode: string;
  productIds: number[];
  linkQuantity: boolean;
}

export function useMapToZc() {
  const qc = useQueryClient();
  return useMutation<
    { productCode: string; productsAffected: number; linkQuantity: boolean },
    Error,
    MapToZcPayload
  >({
    mutationFn: async (body) => {
      const res = await api.post<
        WriteResult<{ productCode: string; productsAffected: number; linkQuantity: boolean }>
      >('/deliveries/grid/map', body);
      return unwrap(res.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

export interface SetSpecialSizePayload {
  optionValueId: number;
  price: number | null;
  prefix: '+' | '-';
  startDate: string;
  endDate: string;
}
export interface SetSpecialProductPayload {
  productsId: number;
  price: number | null;
  thursdayDeal: boolean;
  blackFridayDeal: boolean;
  cyberMondayDeal: boolean;
  megaFridayDeal: boolean;
  sizes: SetSpecialSizePayload[];
}
export interface SetSpecialPayload {
  productCode: string;
  startDate: string;
  endDate: string;
  products: SetSpecialProductPayload[];
}

export function useSetSpecial() {
  const qc = useQueryClient();
  return useMutation<{ productCode: string; productsAffected: number }, Error, SetSpecialPayload>({
    mutationFn: async (body) => {
      const res = await api.post<WriteResult<{ productCode: string; productsAffected: number }>>(
        '/deliveries/grid/special',
        body
      );
      return unwrap(res.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
      // Refetch special-state on next open instead of serving stale cached prices.
      qc.invalidateQueries({ queryKey: ['deliveries', 'special-state', data.productCode] });
    },
  });
}

export function useClearSpecial() {
  const qc = useQueryClient();
  return useMutation<{ productCode: string }, Error, { productCode: string }>({
    mutationFn: async ({ productCode }) => {
      const res = await api.delete<WriteResult<{ productCode: string }>>(
        `/deliveries/grid/special/${encodeURIComponent(productCode)}`
      );
      return unwrap(res.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
      qc.invalidateQueries({ queryKey: ['deliveries', 'special-state', data.productCode] });
    },
  });
}

export interface AssignFontState {
  productCode: string;
  rows: Array<{ size_id: number; size_name: string; font_name: string | null }>;
}

export function useAssignFontState(productCode: string | null) {
  return useQuery<AssignFontState>({
    queryKey: ['deliveries', 'assign-font', productCode],
    enabled: !!productCode,
    queryFn: async () => {
      const res = await api.get<WriteResult<AssignFontState>>(
        `/deliveries/grid/assign-font/${encodeURIComponent(productCode!)}`
      );
      return unwrap(res.data);
    },
  });
}

export interface AssignFontPayload {
  productCode: string;
  assignments: Array<{ fontName: string; sizeIds: number[] }>;
}

export function useAssignFont() {
  const qc = useQueryClient();
  return useMutation<
    { productCode: string; fontAssigned: 'yes' | 'no'; rowsTouched: number },
    Error,
    AssignFontPayload
  >({
    mutationFn: async (body) => {
      const res = await api.post<
        WriteResult<{ productCode: string; fontAssigned: 'yes' | 'no'; rowsTouched: number }>
      >('/deliveries/grid/assign-font', body);
      return unwrap(res.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Stock Home Grid & Print Label actions — Remap size / Print label / Mystery list / Supplier barcode
// ---------------------------------------------------------------------------

// These 4 endpoints return `{ status: 'error', message, code?, details?, failures? }`
// on failure instead of the `{ ok: false, error, code }` envelope `unwrap()` handles.
interface StockGridErrorBody {
  status: 'error';
  message: string;
  code?: string;
  details?: unknown;
  failures?: Array<{ item: unknown; message: string }>;
}

interface ErrorWithResponse {
  response?: {
    data?: unknown;
  };
}

function throwStockGridError(err: unknown): never {
  const data = (err as ErrorWithResponse)?.response?.data as StockGridErrorBody | undefined;
  if (data?.message) {
    const error: Error & { code?: string; failures?: unknown } = new Error(data.message);
    if (data.code) error.code = data.code;
    if (data.failures) error.failures = data.failures;
    throw error;
  }
  throw err instanceof Error ? err : new Error('request failed');
}

export interface RemapSizePayload {
  productListsId: number;
  barcode: string;
  targetSizeId: number;
  targetSizeGroupId?: number;
}

export interface RemapSizeResult {
  ok: true;
  productListsId: number;
  barcode: string;
  targetSizeId: number;
  oldSizeId: number;
}

export function useRemapSize() {
  const qc = useQueryClient();
  return useMutation<RemapSizeResult, Error, RemapSizePayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.post<RemapSizeResult>('/stock-grid/remap-size', payload);
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
    onSuccess: () => {
      // The grid row's `modified` timestamp changes server-side on remap.
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

export interface PrintLabelPayload {
  items: Array<{ productListsId: number; boxCode: string; sizeOptionId: number }>;
}

// Sent with responseType: 'blob', so axios delivers error bodies as a Blob
// too — decode it back to JSON before extracting message/code/failures.
async function parseBlobError(err: unknown): Promise<Error & { code?: string; failures?: unknown }> {
  const data = (err as ErrorWithResponse)?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as StockGridErrorBody;
      const error: Error & { code?: string; failures?: unknown } = new Error(parsed.message);
      if (parsed.code) error.code = parsed.code;
      if (parsed.failures) error.failures = parsed.failures;
      return error;
    } catch {
      // Body wasn't JSON — fall back to the raw axios error below.
    }
  }
  return err instanceof Error ? err : new Error('request failed');
}

export function usePrintLabel() {
  const qc = useQueryClient();
  return useMutation<Blob, Error, PrintLabelPayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.post<Blob>('/deliveries/print-label', payload, {
          responseType: 'blob',
        });
        return res.data;
      } catch (err) {
        throw await parseBlobError(err);
      }
    },
    onSuccess: () => {
      // Caller opens/prints the returned blob itself — the backend sends no
      // Content-Disposition since the PDF is meant to open inline.
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

export interface AddToMysteryListPayload {
  size_id: number;
  product_lists_id: number;
  box_code: string;
}

export interface AddToMysteryListResult {
  success: true;
  message: string;
}

export function useAddToMysteryList() {
  const qc = useQueryClient();
  return useMutation<AddToMysteryListResult, Error, AddToMysteryListPayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.post<AddToMysteryListResult>('/stock-grid/mystery_product', payload);
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

export interface SaveSupplierBarcodePayload {
  barcode: string;
  size_id: number;
  product_lists_id: number;
  supplier_barcode_1?: string;
}

export interface SaveSupplierBarcodeResult {
  success: boolean;
  message: string;
}

export function useSaveSupplierBarcode() {
  const qc = useQueryClient();
  return useMutation<SaveSupplierBarcodeResult, Error, SaveSupplierBarcodePayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.post<SaveSupplierBarcodeResult>('/stock-grid/supplier-barcode', payload);
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
    onSuccess: () => {
      // success:false (duplicate/collision) is a normal 200 response, not an
      // error — the caller inspects result.success itself.
      qc.invalidateQueries({ queryKey: ['deliveries', 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Remap Size — right-click "Remap Size" context menu command
// ---------------------------------------------------------------------------

export interface RemapCheckPayload {
  productListsId: number;
  sizeId: number;
  boxCode: string;
}

export interface RemapCheckResult {
  blocked: boolean;
  reason?: string;
  barcode?: string;
  fc_product_id?: number | null;
  productCode?: string;
  productName?: string;
  current?: { sizeOptionId: number | null; sizeGroupId: number | null; currentDefaultSizeId: number | null; currentSizeId: number | null };
}

export function useRemapCheck() {
  return useMutation<RemapCheckResult, Error, RemapCheckPayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.get<RemapCheckResult>('/stock-grid/remap-check', {
          params: payload,
        });
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Size cascade dropdowns (products module) + remap validation
// ---------------------------------------------------------------------------

export interface SizeOptionRow { products_options_id: number; products_options_name: string; }
export interface SizeGroupRow { sms_size_groups_id: number; size_group_name: string; products_options_id: number; }
export interface SizeRow {
  manufacturers_sizes_to_default_sizes_id: number; // actually a manufacturers_options_values_id (legacy alias) <-- the value used as targetSizeId
  manufacturer_size_shortname: string;
  default_options_values_id: number;
}

export function useSizeOptions() {
  return useQuery<SizeOptionRow[], Error>({
    queryKey: ['products', 'size-options'],
    queryFn: async () => {
      const res = await api.get<{ data: SizeOptionRow[] }>('/products/size-options');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSizeGroups(optionId: number | null) {
  return useQuery<SizeGroupRow[], Error>({
    queryKey: ['products', 'size-groups', optionId],
    enabled: optionId != null,
    queryFn: async () => {
      const res = await api.get<{ data: SizeGroupRow[] }>('/products/size-groups', { params: { optionId } });
      return res.data.data;
    },
  });
}

export function useSizes(groupId: number | null) {
  return useQuery<SizeRow[], Error>({
    queryKey: ['products', 'sizes', groupId],
    enabled: groupId != null,
    queryFn: async () => {
      const res = await api.get<{ data: SizeRow[] }>('/products/sizes', { params: { groupId } });
      return res.data.data;
    },
  });
}

export type RemapValidateResultKind = 'ok' | 'source_not_found' | 'not_in_chart' | 'fc_blocked' | 'existing';
export interface RemapValidateSizePayload { productListsId: number; barcode: string; targetSizeId: number; }
export interface RemapValidateSizeResult { result: RemapValidateResultKind; message: string; existingBarcode?: string; }

export function useValidateRemapSize() {
  return useMutation<RemapValidateSizeResult, Error, RemapValidateSizePayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.get<RemapValidateSizeResult>('/stock-grid/remap-validate-size', { params: payload });
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Supplier Barcode fetch — right-click "Add Alternate/Supplier Barcode"
// ---------------------------------------------------------------------------

export interface SupplierBarcodeFetchPayload {
  product_lists_id: number;
  size: number;
}

export interface SupplierBarcodeFetchData {
  product_code: string;
  product_name: string;
  size_name: string;
  season: string;
  barcode: string;
  supplier_barcode_1: string | null;
  boxes: string;
  product_lists_id: number;
  // product_quantities.size_id — the SAVE endpoint's WHERE key. Distinct
  // from the `size` request param above (grid default size id).
  size_id: number;
  sizeId: number;
}

export type SupplierBarcodeFetchResult =
  | { success: true; data: SupplierBarcodeFetchData }
  | { success: false; message: string };

export function useSupplierBarcodeData() {
  return useMutation<SupplierBarcodeFetchResult, Error, SupplierBarcodeFetchPayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.get<SupplierBarcodeFetchResult>('/stock-grid/supplier-barcode', {
          params: payload,
        });
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Supplier Barcode uniqueness check — used by the per-field validation in
// SupplierBarcodeDialog before accepting a new/changed barcode value.
// ---------------------------------------------------------------------------

export interface CheckSupplierBarcodeUniquePayload {
  barcode: string;
}

export interface CheckSupplierBarcodeUniqueResult {
  success: boolean;
  isNew: boolean;
  foundField: string | null;
  message: string | null;
}

export function useCheckSupplierBarcodeUnique() {
  return useMutation<CheckSupplierBarcodeUniqueResult, Error, CheckSupplierBarcodeUniquePayload>({
    mutationFn: async (payload) => {
      try {
        const res = await api.get<CheckSupplierBarcodeUniqueResult>(
          '/stock-grid/supplier-barcode/check-unique',
          { params: payload }
        );
        return res.data;
      } catch (err) {
        throwStockGridError(err);
      }
    },
  });
}
