/**
 * SPEC-13: Order Processing Engine — TanStack Query hooks.
 * Requirements: REQ-13-001 through REQ-13-009
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types (mirror backend response shapes)
// ---------------------------------------------------------------------------

export interface SimulationProductResult {
  ordersProductsId: number;
  productName: string;
  productsModel: string;
  size: string;
  quantity: number;
  smsStock: number;
  boxNumber: string;
  productType: string;
  hasPrinting: boolean;
  isOutOfStock: boolean;
  warnings: string[];
}

export interface SimulationResult {
  orderId: number;
  eligible: boolean;
  reason?: string;
  products: SimulationProductResult[];
  proposedStatus: number;
  proposedStatusName: string;
  hasRetroProducts: boolean;
  hasPrintingProducts: boolean;
  totalProducts: number;
  stockAvailableCount: number;
}

export interface InvoiceLogEntry {
  ordersProductsId: number;
  productName: string;
  size: string;
  remoteProcessingStatus: 'Added' | 'Not Added';
  invoiceType: string;
  invoicePrintedBy: string;
  invoiceTime: string;
}

export interface UnallocatedStockItem {
  orderId: number;
  ordersProductsId: number;
  productName: string;
  productsModel: string;
  size: string;
  smsStock: number;
  orderDate: string;
  customerName: string;
}

export interface BatchProcessResult {
  processed: number;
  failed: number;
  errors: Array<{ orderId: number; error: string }>;
}

export interface QueueProcessResult extends BatchProcessResult {
  archiveNumber: number;
  total: number;
  flaggedForManual: number[];
}

// ---------------------------------------------------------------------------
// REQ-13-001/002: Run Simulation
// ---------------------------------------------------------------------------

export function useSimulation(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation<SimulationResult>({
    mutationFn: async () => {
      const response = await api.post(`/orders/${orderId}/simulate`, {});
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-13-003: Disagree with Simulation
// ---------------------------------------------------------------------------

export function useDisagree(orderId: number) {
  return useMutation({
    mutationFn: async (comment: string) => {
      const response = await api.post(`/orders/${orderId}/simulate/disagree`, { comment });
      return response.data;
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-13-004: Execute Processing
// ---------------------------------------------------------------------------

export function useExecuteProcessing(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation<SimulationResult>({
    mutationFn: async () => {
      const response = await api.post(`/orders/${orderId}/simulate/execute`, {});
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderProducts', orderId] });
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-13-005: Invoice Log
// ---------------------------------------------------------------------------

export function useInvoiceLog(orderId: number, enabled = false) {
  return useQuery<InvoiceLogEntry[]>({
    queryKey: ['invoiceLog', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/invoice-log`);
      return response.data.data;
    },
    enabled,
  });
}

// ---------------------------------------------------------------------------
// REQ-13-008: Remote Processing
// ---------------------------------------------------------------------------

export function useRemoteProcess(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: 'complete' | 'multipart' | 'part' | 'invoice' | 'print';
      products: Array<{ ordersProductsId: number; boxNumber: string }>;
    }) => {
      const response = await api.post(`/orders/${orderId}/remote-process`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['invoiceLog', orderId] });
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-13-006: Batch Processing
// ---------------------------------------------------------------------------

export function useBatchProcess() {
  const queryClient = useQueryClient();
  return useMutation<BatchProcessResult, Error, number[]>({
    mutationFn: async (orderIds: number[]) => {
      const response = await api.post('/orders/batch-process', { orderIds });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
    },
  });
}

/**
 * #1061 P2: process the full eligible queue. The server selects, archives and
 * orders the queue (pre-orders first), so no order IDs are sent.
 */
export function useProcessQueue() {
  const queryClient = useQueryClient();
  return useMutation<QueueProcessResult, Error, void>({
    mutationFn: async () => {
      const response = await api.post('/orders/process-queue');
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderListing'] });
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-13-009: Unallocated Stock
// ---------------------------------------------------------------------------

export function useUnallocatedStock(enabled = false) {
  return useQuery<UnallocatedStockItem[]>({
    queryKey: ['unallocatedStock'],
    queryFn: async () => {
      const response = await api.get('/orders/unallocated-stock');
      return response.data.data;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
