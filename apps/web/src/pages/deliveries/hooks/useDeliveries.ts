/**
 * Deliveries page query hooks — mirrors the daily-deals hook pattern.
 *
 * Backend endpoints: GET /api/deliveries, /api/deliveries/teams,
 * /api/deliveries/countries, /api/deliveries/permissions
 * (apps/api/src/modules/deliveries).
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DeliveryRow {
  id: number;
  product_quantities_id: number | null;
  product_lists_id: number | null;
  product_list_id: number | null;
  product_code: string;
  product_name: string;
  boxcode: string;
  team_id: number | null;
  product_code_type: number | null;
  season: string;
  price: string;
  special_price: string | number | null;
  map: string;
  quantity_map: string;
  amazon_low_price: string;
  ebay_product: string;
  percentage_sold: string;
  assign_font: string;
  one_size: string;
  attr: string;
  last_sale_day: string;
  // Size columns
  option_2701: string;
  option_1: string;
  option_2: string;
  option_3: string;
  option_4: string;
  option_5: string;
  option_623: string;
  option_1640: string;
  option_509: string;
  option_441: string;
  option_442: string;
  option_443: string;
  option_444: string;
  option_1641: string;
  // Per-row size descriptors keyed by option_<id> — populated from the legacy
  // `actual_size_options_comments` (manufacturers_sizes_to_default_size).
  // The grid formatter renders these into the hover tooltip.
  size_comments: Record<string, string>;
  // Computed flags
  special: '0' | '1';
  add_product_status: '' | 'partially_complete';
  upload_image: '0' | '1';
  image_added: string;
  image_added_bit: '0' | '1';
  submitted_for_review: '0' | '1';
  image_urls: '0' | '1';
}

export interface DeliveryListResponse {
  data: DeliveryRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
}

export interface DeliveryFeaturePermissions {
  EDIT_SEASON: boolean;
  EDIT_QUANTITIES: boolean;
  EDIT_PRICE: boolean;
  MAP_PRODUCTS: boolean;
  MYSTERY_LIST: boolean;
  SUPPLIER_BARCODE: boolean;
  SET_SPECIAL_PRICE_AND_DEAL: boolean;
  LINK_QUANTITY: boolean;
  ADD_SMS_PRODUCT: boolean;
  SET_EBAY_PRODUCTS: boolean;
  ASSIGN_FONTS: boolean;
  ADD_IMAGE: boolean;
  UPLOAD_IMAGE: boolean;
}

export interface DeliveryListParams {
  page?: number;
  pageSize?: number;
  sort?: '0' | '1' | '2' | '3';
  ukss_price_upload_status?: '0' | '1' | '2';
  remove_duplicate_product_code?: '0' | '1';
  team_id?: number;
  country_of_origin_id?: number;
  productcode?: string;
  special?: '0' | '1';
  archive?: '0' | '1';
  keyword?: string;
  order_mode?: 'recent' | 'season';
  letter?: string;
}

export function useDeliveries(params: DeliveryListParams) {
  return useQuery<DeliveryListResponse>({
    queryKey: ['deliveries', 'list', params],
    queryFn: async () => {
      const response = await api.get('/deliveries', { params });
      return response.data;
    },
    placeholderData: (prev) => prev, // smooth pagination, no flash on page change
  });
}

export function useDeliveriesTeams() {
  return useQuery<{ data: { id: number; name: string }[] }>({
    queryKey: ['deliveries', 'teams'],
    queryFn: async () => {
      const response = await api.get('/deliveries/teams');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useDeliveriesCountries() {
  return useQuery<{ data: { id: number; name: string }[] }>({
    queryKey: ['deliveries', 'countries'],
    queryFn: async () => {
      const response = await api.get('/deliveries/countries');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useTeamLetters() {
  return useQuery<{ letter: string }[]>({
    queryKey: ['deliveries', 'team-letters'],
    queryFn: async () => {
      const response = await api.get('/stock-grid/team-letters');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useDeliveriesPermissions() {
  return useQuery<{ data: DeliveryFeaturePermissions }>({
    queryKey: ['deliveries', 'permissions'],
    queryFn: async () => {
      const response = await api.get('/deliveries/permissions');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Season list for the inline season-dropdown editor in the grid.
 *
 * Same source as TypesenseCombobox(`facetKey="season"`) used by the New SMS
 * Product form — keeps options consistent between the grid editor and the
 * form. Cached for 10 minutes since the season list rarely changes mid-session.
 */
export function useSeasonsList() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ['products', 'typesense', 'season', ''],
    queryFn: async () => {
      const res = await api.get<{ data: { id: string; name: string }[] }>(
        '/products/typesense/season'
      );
      return res.data.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}
