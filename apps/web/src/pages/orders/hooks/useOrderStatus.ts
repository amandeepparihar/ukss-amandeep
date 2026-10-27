/**
 * Order status management TanStack Query hooks.
 * Requirements: REQ-07-001 (status update), REQ-07-018 (history),
 *   REQ-07-023 (templates), REQ-07-025 (touchpoint)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusHistoryItem {
  id: number;
  orderId: number;
  statusId: number;
  statusName: string;
  dateAdded: string;
  customerNotified: boolean;
  comments: string;
  commentBy: string | null;
  commentPrivate: string | null;
  statusChangeFrom: string | null;
}

export interface StatusTemplate {
  id: number;
  title: string | null;
  content: string;
}

export interface StatusUpdateInput {
  status: number;
  previousOrderStatus: number;
  comments: string;
  notify: boolean;
  notifyComments: boolean;
  privateComment: boolean;
  useOriginalEmail: boolean;
  sendMessageAutomatically: boolean;
  pageForLog?: string;
}

export interface StatusUpdateResult {
  status: 'success' | 'error';
  message: string;
  data?: {
    statusChanged: boolean;
    historyInserted: boolean;
    marketplaceErrors: string[];
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * REQ-07-001: Submit a status update (mutation).
 * Invalidates all relevant queries on success.
 */
export function useStatusUpdate(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation<StatusUpdateResult, Error, StatusUpdateInput>({
    mutationFn: async (input) => {
      const response = await api.post(`/orders/${orderId}/status`, input);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
      queryClient.invalidateQueries({ queryKey: ['orderTabCounts'] });
      queryClient.invalidateQueries({ queryKey: ['statusHistory', orderId] });
    },
  });
}

/**
 * REQ-07-018: Fetch status history for an order.
 */
export function useStatusHistory(orderId: number | null) {
  return useQuery<StatusHistoryItem[]>({
    queryKey: ['statusHistory', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/status-history`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    staleTime: 30 * 1000,
  });
}

/**
 * REQ-07-023: Fetch predefined templates by type.
 * PHP has two dropdowns: outgoing (type '0') and reply (type '1').
 */
function useTemplates(type: '0' | '1') {
  return useQuery<StatusTemplate[]>({
    queryKey: ['statusTemplates', type],
    queryFn: async () => {
      const response = await api.get(`/orders/templates?type=${type}`);
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000, // 5-min cache
  });
}

export const useStatusTemplates = () => useTemplates('0');
export const useReplyTemplates = () => useTemplates('1');

/**
 * REQ-07-025: Set touchpoint counter to an absolute value.
 * PHP orders.php sets touchpoints = $_POST['touchpoints'] (absolute, not incremented).
 */
export function useTouchpoint(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (touchpoints: number) => {
      const response = await api.post(`/orders/${orderId}/touchpoint`, { touchpoints });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
    },
  });
}
