/**
 * SPEC-12a: Supplier Selection — TanStack Query hooks.
 * Covers: GET /orders/:id/supplier-options and POST /orders/:id/supplier-orders.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types (mirror backend response shapes from allocate.types.ts + free-quantity.logic.ts)
// ---------------------------------------------------------------------------

export interface SupplierOption {
  id: number;
  name: string;
  manufacturerId: number | null;
}

/** Computed summary for one free-quantity bucket (open or placed). */
export interface FreeQuantitySummary {
  totalQuantity: number;
  assignedQuantity: number;
  freeQuantity: number;
  restrictedQuantity: number;
  orderIds: number[];
  supplierOrderNumber: string | null;
}

export interface SupplierFreeQuantity {
  productId: number;
  openOrder: FreeQuantitySummary | null;
  placedOrder: FreeQuantitySummary | null;
  reusableSupplierOrderNumber: string | null;
}

/** All metadata needed to write a supplier order row, derived server-side. */
export interface SupplierLineMetadata {
  orderProductId: number;
  productId: number;
  masterProductId: number;
  productName: string;
  productModel: string;
  sizeName: string;
  shortname: string;
  orderId: number;
  orderDate: string;
  customerId: number;
  customerName: string;
  manufacturersId: number;
  productsOptionsValuesId: number;
  pvtId: string;
  defaultOptionValueId: number;
}

export interface SupplierOptionLine {
  metadata: SupplierLineMetadata;
  freeQuantity: SupplierFreeQuantity;
}

export interface SupplierOptionsResponse {
  lines: SupplierOptionLine[];
  suppliers: SupplierOption[];
}

export interface CreateSupplierOrderResult {
  createdLines: number;
  updatedLines: number;
  overflowRows: number;
  statusChangedTo128: boolean;
  statusChangedTo22: boolean;
}

// ---------------------------------------------------------------------------
// Hook: useSupplierOptions
// ---------------------------------------------------------------------------

/**
 * Fetches supplier options and per-line free-quantity data for the given
 * order products. Disabled when no product ids are provided.
 */
export function useSupplierOptions(orderId: number, orderProductIds: number[]) {
  return useQuery<SupplierOptionsResponse>({
    queryKey: ['supplierOptions', orderId, ...orderProductIds],
    queryFn: async () => {
      const idsParam = orderProductIds.join('_');
      const response = await api.get(
        `/orders/${orderId}/supplier-options?orderProductIds=${idsParam}`,
      );
      return response.data.data;
    },
    enabled: orderProductIds.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Hook: useCreateSupplierOrder
// ---------------------------------------------------------------------------

export interface CreateSupplierOrderInput {
  supplierId: number;
  orderProductIds: number[];
  quantity: number;
}

/**
 * Posts a supplier order creation request. This mutation is shared by the
 * Edit Order page's per-line "Select supplier" button (ProductRow.tsx,
 * driven by the ['orderProducts', orderId] query) and the panel's
 * "Buy From Retailer" batch button (PanelProducts.tsx, driven by
 * ['orderPanel', orderId]) — invalidate all three surfaces that display
 * supplier-assignment status so neither caller is left showing stale data.
 */
export function useCreateSupplierOrder(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation<CreateSupplierOrderResult, Error, CreateSupplierOrderInput>({
    mutationFn: async (input: CreateSupplierOrderInput) => {
      const response = await api.post(`/orders/${orderId}/supplier-orders`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderDetail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderProducts', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPanel', orderId] });
    },
  });
}
