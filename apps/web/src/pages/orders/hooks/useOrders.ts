/**
 * Orders TanStack Query hooks — data fetching for orders module.
 * Requirements: REQ-01-021 (statuses), REQ-01-003 (permissions), REQ-01-010 (config),
 *   REQ-02-001 (listing), REQ-02-017 (tabs), REQ-02-002-005 (alerts), REQ-02-007 (stores)
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrderStatus {
  id: number;
  name: string;
  displayOrder: number;
}

export interface OrderFeaturePermissions {
  refundPermission: boolean;
  rejectPermission: boolean;
}

export interface OrderConfig {
  [key: string]: string;
}

export interface OrderListItem {
  orderId: number;
  customerId: number | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  customerName: string | null;
  companyName: string | null;
  shipByDate: string | null;
  shipByDateStatus: number | null;
  orderTotal: number | null;
  currency: string | null;
  currencyValue: number | null;
  datePurchased: string | null;
  status: number;
  statusName: string;
  refundInfo: { type: string; amount: number | null } | null;
  orderType: string | null;
  siftScore: number | null;
  riskScore: number | null;
  touchpoints: number | null;
  scanned: boolean;
  isExchange: boolean;
  originalOrderId: number | null;
  billingShippingMismatch: boolean;
  rowClass: string;
}

export interface OrderListResponse {
  data: OrderListItem[] | { redirect: string };
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface TabCounts {
  today: number;
  tomorrow: number;
  twoDays: number;
  afterTwoDays: number;
  toBeRefund: number;
}

export interface AlertOrder {
  orderId: number;
  shipByDate: string;
}

export interface OrderAlerts {
  amazon: {
    uk: {
      lateShipments: AlertOrder[];
      expectedLate: AlertOrder[];
    };
    us: {
      lateShipments: AlertOrder[];
      avoidableLate: AlertOrder[];
      expectedLate: AlertOrder[];
    };
  };
  fc: {
    errorOrders: number;
    manualPending: number;
  };
}

export interface Store {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Foundation hooks (SPEC-01)
// ---------------------------------------------------------------------------

/**
 * REQ-01-021: Fetch order statuses for dropdowns.
 */
export function useOrderStatuses() {
  return useQuery<OrderStatus[]>({
    queryKey: ['orderStatuses'],
    queryFn: async () => {
      const response = await api.get('/orders/statuses');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * REQ-01-003 + REQ-01-004: Fetch feature permissions for the current admin.
 */
export function useOrderPermissions() {
  return useQuery<OrderFeaturePermissions>({
    queryKey: ['orderPermissions'],
    queryFn: async () => {
      const response = await api.get('/orders/permissions');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * REQ-01-010: Fetch DB-defined configuration values for the orders module.
 */
export function useOrderConfig() {
  return useQuery<OrderConfig>({
    queryKey: ['orderConfig'],
    queryFn: async () => {
      const response = await api.get('/orders/config');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * REQ-01-013: Validate that an order exists (for edit mode).
 */
export function useOrderExists(orderId: number | null) {
  return useQuery({
    queryKey: ['orderExists', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Listing hooks (SPEC-02)
// ---------------------------------------------------------------------------

/**
 * REQ-02-021: Fetch paginated order listing with filters.
 */
export function useOrderListing(params: Record<string, unknown>) {
  return useQuery<OrderListResponse>({
    queryKey: ['orderListing', params],
    queryFn: async () => {
      const response = await api.get('/orders', { params });
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * REQ-02-017: Fetch tab counts for ship-by-date filtering.
 */
export function useOrderTabCounts(params: Record<string, unknown>) {
  return useQuery<TabCounts>({
    queryKey: ['orderTabCounts', params],
    queryFn: async () => {
      const response = await api.get('/orders/tabs', { params });
      return response.data.data;
    },
  });
}

/**
 * REQ-02-002-005: Fetch marketplace and FC alerts.
 * REQ-02-024: Independent from listing, doesn't block render.
 */
export function useOrderAlerts() {
  return useQuery<OrderAlerts>({
    queryKey: ['orderAlerts'],
    queryFn: async () => {
      const response = await api.get('/orders/alerts');
      return response.data.data;
    },
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * REQ-02-007: Fetch store/seller dropdown data.
 */
export function useOrderStores() {
  return useQuery<Store[]>({
    queryKey: ['orderStores'],
    queryFn: async () => {
      const response = await api.get('/orders/stores');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Filter Products cascade hooks (category → product → size)
// ---------------------------------------------------------------------------

export interface FilterCascadeItem {
  id: number;
  name: string;
}

/**
 * Fetch all categories for the Filter Products cascade.
 */
export function useFilterCategories() {
  return useQuery<FilterCascadeItem[]>({
    queryKey: ['filterCategories'],
    queryFn: async () => {
      const response = await api.get('/orders/filter/categories');
      return response.data.data as FilterCascadeItem[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch products in a category. Disabled until categoryId is set.
 */
export function useProductsByCategory(categoryId: number | undefined) {
  return useQuery<FilterCascadeItem[]>({
    queryKey: ['filterProducts', categoryId],
    queryFn: async () => {
      const response = await api.get('/orders/filter/products', { params: { categoryId } });
      return response.data.data as FilterCascadeItem[];
    },
    enabled: !!categoryId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch sizes for a specific product. Disabled until productId is set.
 */
export function useSizesByProduct(productId: number | undefined) {
  return useQuery<FilterCascadeItem[]>({
    queryKey: ['filterSizes', productId],
    queryFn: async () => {
      const response = await api.get('/orders/filter/sizes', { params: { productId } });
      return response.data.data as FilterCascadeItem[];
    },
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });
}
