/**
 * Order panel TanStack Query hooks — data fetching for the details panel.
 * Requirements: REQ-03-001 (panel loading), REQ-03-009 (rejection),
 *   REQ-03-015 (refund review), REQ-03-013 (suppliers)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types (matching API response from panel.service.ts)
// ---------------------------------------------------------------------------

export interface PanelProductAttribute {
  optionName: string;
  optionValue: string;
  optionValueId: number | null;
  isSize: boolean;
}

export interface PanelProductSupplier {
  supplierOrderId: number | null;
  supplierId: number | null;
  supplierName: string | null;
  orderNumber: string | null;
  isAssigned: boolean;
  closeOrder: number | null;
}

export interface PanelProductLastOrdered {
  supplierName: string;
  orderedDate: string | null;
}

export interface PanelProduct {
  ordersProductsId: number;
  productsId: number;
  name: string;
  model: string | null;
  quantity: number;
  backorder: string;
  boxNumber: string | null;
  fcOrderId: string | null;
  isRefund: boolean;
  attributes: PanelProductAttribute[];
  smsQuantity: number | string;
  supplier: PanelProductSupplier | null;
  lastOrdered: PanelProductLastOrdered | null;
  bulkUploadSupplier: string | null;
  toffsCopaType: 'toffs' | 'copa' | null;
  manufacturersId: number | null;
  isSupplierSelectable: boolean;
  supplierType: 'airo' | 'toffs' | null;
}

export interface PanelMarketplaceInfo {
  ebayOrderId: string | null;
  ebayUnacknowledged: number | null;
  gosportOrderId: string | null;
  catchOrderId: string | null;
  fruugoOrderId: string | null;
  multisiteOrderId: string | null;
  amazonOrderId: string | null;
  mplazaOrderId: string | null;
  tescoOrderId: string | null;
  rakutenOrderId: string | null;
  lazadaOrderId: string | null;
  priceministerOrderId: string | null;
  decathlonOrderId: string | null;
}

export interface OrderPanelData {
  orderId: number;
  customersId: number;
  status: number;
  statusName: string;
  datePurchased: string | null;
  lastModified: string | null;
  orderTotal: number | null;
  currency: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  customerName: string | null;
  customerEmail: string | null;
  ipAddress: string | null;
  isPrime: boolean;
  siftScoreBit: boolean;
  fcOrderStatus: string | null;
  fraudStatus: number;
  refundStatusForReject: number;
  refundReviewStatus: number;
  refundReviewComment: string | null;
  orderSite: number | null;
  suppliers: string | null;
  marketplace: PanelMarketplaceInfo;
  products: PanelProduct[];
  productCount: number;
  allSuppliers: Array<{ id: number; name: string }>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * REQ-03-001: Fetch panel data for a specific order.
 */
export function useOrderPanel(orderId: number | null) {
  return useQuery<OrderPanelData>({
    queryKey: ['orderPanel', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/panel`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    staleTime: 30 * 1000,
    retry: false,
  });
}

/**
 * REQ-03-009: Reject an order (5 action types).
 */
export function useRejectOrder(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (actionType: 1 | 2 | 3 | 4 | 5) => {
      const response = await api.post(`/orders/${orderId}/reject`, { actionType });
      return response.data as { result: 'success' | 'error'; message: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
    },
  });
}

/**
 * REQ-03-015: Update refund review status.
 */
export function useUpdateRefundReview(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ status, comment }: { status: number; comment?: string }) => {
      const response = await api.post(`/orders/${orderId}/refund-review`, { status, comment });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
    },
  });
}

/**
 * REQ-03-013: Update order suppliers.
 */
export function useUpdateSuppliers(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (suppliers: string) => {
      const response = await api.put(`/orders/${orderId}/suppliers`, { suppliers });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
    },
  });
}

/**
 * REQ-03-005: Cancel a pending refund on a rejected order.
 */
export function useCancelRefund(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post(`/orders/${orderId}/cancel-refund`);
      return response.data as { status: 'success' | 'error'; message: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
    },
  });
}

/**
 * REQ-03-006: Delete an order with optional restock.
 */
export function useDeleteOrder(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (restock: boolean) => {
      const response = await api.post(`/orders/${orderId}/delete`, { restock });
      return response.data as { result: 'success' | 'error'; message: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
      queryClient.invalidateQueries({ queryKey: ['orderTabCounts'] });
    },
  });
}
