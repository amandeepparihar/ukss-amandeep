/**
 * Order detail TanStack Query hooks — data fetching for the edit page.
 * Requirements: REQ-04-001 (details), REQ-04-002 (navigation),
 *   REQ-04-004 (viewers), REQ-04-007 (priority/approve), REQ-04-019 (lock)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddressInfo {
  name: string;
  company: string;
  street: string;
  suburb: string;
  city: string;
  postcode: string;
  state: string;
  country: string;
}

export interface MarketplaceIds {
  amazon: string | null;
  mplaza: string | null;
  tesco: string | null;
  tescoTracking: string | null;
  ebay: string | null;
  rakuten: string | null;
  lazada: string | null;
  priceminister: string | null;
  gosport: string | null;
  catch: string | null;
  fruugo: string | null;
  decathlon: string | null;
  laybuy: string | null;
  shopify: string | null;
  multisite: string | null;
  moOrders: Array<{ orderId: string; storeName: string }>;
  fcOrderId: string | null;
  fcStatus: string | null;
}

export interface TrackingInfo {
  orderTracking: string[];
  dhl: string[];
  royalMail: string[];
  dpd: string[];
  lastScanDate: string | null;
  courierReturnStatus: number | null;
}

export interface PreviousOrder {
  orderId: number;
  datePurchased: string | null;
  status: number;
  statusName: string | null;
  isBackorder: boolean;
  isReturned: boolean;
}

export interface OrderDetailData {
  orderId: number;
  status: number;
  statusName: string;
  datePurchased: string | null;
  shipByDate: string | null;
  orderTotal: number | null;
  currency: string | null;
  currencyValue: number | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  orderSite: number | null;
  orderType: string | null;
  customer: {
    id: number;
    name: string;
    company: string;
    phone: string;
    email: string;
    ipAddress: string;
    isPriority: boolean;
    isApproved: boolean;
  };
  deliveryAddress: AddressInfo;
  billingAddress: AddressInfo;
  marketplaceIds: MarketplaceIds;
  tracking: TrackingInfo;
  metadata: {
    isExchange: boolean;
    originalOrderId: number | null;
    exchangeOrderId: number | null;
    siftScore: number | null;
    riskScore: number | null;
    riskifiedStatus: string | null;
    matchedBy: string | null;
    lockStatus: {
      isLocked: boolean;
      extraOption: number | null;
    };
  };
  processing: {
    archiveDisplay: string;
  };
  referral: {
    keywords: string | null;
    url: string | null;
  };
  paymentInfo: {
    method: string | null;
    previousOrders: PreviousOrder[];
    commissionAmount: number | null;
    affiliateName: string | null;
  };
  store: {
    id: number;
    name: string;
    logo: string | null;
    platform: string | null;
  };
  flags: {
    fraudStatus: number;
    processOrder: boolean;
    isGreenFc: boolean;
    baselinkerSource: string | null;
    isPrime: boolean;
    isDhl: boolean;
    lockForReview: boolean;
    fcOrderId: string | null;
    fcAutoCreationBit: number | null;
    courierReturnStatus: number | null;
  };
}

export interface OrderViewer {
  name: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * REQ-04-001: Fetch full order details for the edit page.
 *
 * staleTime: 0 — order data must always be fresh; never serve cached data.
 * gcTime: 0    — discard cache on unmount; prevents stale data from a previous
 *                navigation being shown when the user returns to the same orderId.
 */
export function useOrderDetail(orderId: number | null) {
  return useQuery<OrderDetailData>({
    queryKey: ['orderDetail', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * REQ-04-004: Poll concurrent viewers every 3 seconds.
 */
export function useOrderViewers(orderId: number | null) {
  return useQuery<OrderViewer[]>({
    queryKey: ['orderViewers', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/viewers`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    refetchInterval: 3000,
  });
}

/**
 * REQ-04-002: Navigate to prev/next order within same status.
 * Uses useMutation instead of useQuery because this is an imperative action
 * (user clicks, gets result, navigates) rather than declarative data fetching.
 */
export function useOrderNavigation(orderId: number) {
  return useMutation({
    mutationFn: async ({ direction, status }: { direction: 'prev' | 'next'; status?: number }) => {
      const params: Record<string, string | number> = { direction };
      if (status !== undefined) params.status = status;
      const response = await api.get(`/orders/${orderId}/navigation`, { params });
      return response.data;
    },
  });
}

/**
 * REQ-04-007: Toggle priority customer status.
 */
export function useTogglePriority(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (customersId: number) => {
      const response = await api.post(`/orders/${orderId}/priority`, { customersId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
    },
  });
}

/**
 * REQ-04-007: Toggle approve customer status.
 */
export function useToggleApprove(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (customersId: number) => {
      const response = await api.post(`/orders/${orderId}/approve`, { customersId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
    },
  });
}

/**
 * REQ-04-019: Toggle lock for review.
 */
export function useToggleLockForReview(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post(`/orders/${orderId}/lock-for-review`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
    },
  });
}
