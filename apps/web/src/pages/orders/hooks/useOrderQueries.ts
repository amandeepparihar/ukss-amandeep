/**
 * Order queries TanStack Query hooks — inter-admin query system.
 * Requirements: REQ-08-011, REQ-08-013
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrderQuery {
  id: number;
  from: string;
  to: string;
  content: string;
  orderId: number;
  dateAdded: string;
}

export interface QueryTemplate {
  id: number;
  name: string;
  content: string;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
}

export interface CreateQueryInput {
  queryTo: number;
  queryContent: string;
  isTemplate?: boolean;
  templateName?: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * REQ-08-013: Fetch query history for an order.
 */
export function useOrderQueries(orderId: number | null) {
  return useQuery<OrderQuery[]>({
    queryKey: ['orderQueries', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/queries`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    staleTime: 30 * 1000,
  });
}

/**
 * REQ-08-011: Fetch query templates.
 */
export function useQueryTemplates() {
  return useQuery<QueryTemplate[]>({
    queryKey: ['queryTemplates'],
    queryFn: async () => {
      const response = await api.get('/orders/query-templates');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * REQ-08-013: Fetch admin users for query recipient dropdown.
 */
export function useQueryAdmins() {
  return useQuery<AdminUser[]>({
    queryKey: ['queryAdmins'],
    queryFn: async () => {
      const response = await api.get('/orders/query-admins');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * REQ-08-013: Submit an inter-admin query (mutation).
 */
export function useCreateQuery(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateQueryInput) => {
      const response = await api.post(`/orders/${orderId}/queries`, input);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderQueries', orderId] });
    },
  });
}
