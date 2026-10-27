/**
 * Product-level action mutation hooks.
 * Requirements: REQ-06-001 through REQ-06-026
 *
 * Each mutation invalidates the orderProducts query to refresh the table.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ActionResult {
  status: 'success' | 'refresh' | 'error';
  message: string;
}

function useProductMutation<TInput>(
  orderId: number,
  mutationFn: (input: TInput) => Promise<ActionResult>,
  successMessage?: string,
) {
  const queryClient = useQueryClient();

  return useMutation<ActionResult, Error, TInput>({
    mutationFn,
    onSuccess: (result) => {
      if (result.status === 'success' || result.status === 'refresh') {
        queryClient.invalidateQueries({ queryKey: ['orderProducts', orderId] });
        if (successMessage) toast.success(successMessage);
      }
    },
    onError: (error) => {
      toast.error(error.message || 'Operation failed');
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-06-001: Box Number Assignment
// ---------------------------------------------------------------------------

export function useUpdateBoxNumber(orderId: number) {
  return useProductMutation<{ productId: number; boxNumber: string }>(
    orderId,
    async ({ productId, boxNumber }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/box-number`, { boxNumber });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-008: JIT Toggle
// ---------------------------------------------------------------------------

export function useToggleJit(orderId: number) {
  return useProductMutation<{ productId: number; checkBit: 'yes' | 'no' }>(
    orderId,
    async ({ productId, checkBit }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/jit`, { checkBit });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-014: Backorder Toggle
// ---------------------------------------------------------------------------

export function useToggleBackorder(orderId: number) {
  return useProductMutation<{ orderProductId: string; backorder: 'Yes' | 'No' }>(
    orderId,
    async ({ orderProductId, backorder }) => {
      const res = await api.post(`/orders/${orderId}/products/backorder`, { orderProductId, backorder });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-021: Ship Check Toggle
// ---------------------------------------------------------------------------

export function useUpdateShipCheck(orderId: number) {
  return useProductMutation<{ productId: number; shipChk: 'yes' | 'no' }>(
    orderId,
    async ({ productId, shipChk }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/ship-check`, { shipChk });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-022: Printing Status Toggle
// ---------------------------------------------------------------------------

export function useUpdatePrintingStatus(orderId: number) {
  return useProductMutation<{ productId: number; printed: 'Printed' | 'Not Printed' }>(
    orderId,
    async ({ productId, printed }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/printing-status`, { printed });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-023: Arrived Status Toggle
// ---------------------------------------------------------------------------

export function useUpdateArrivedStatus(orderId: number) {
  return useProductMutation<{ productId: number; arrived: 'Arrived' | 'Not Arrived' }>(
    orderId,
    async ({ productId, arrived }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/arrived-status`, { arrived });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-025: Box1 Update
// ---------------------------------------------------------------------------

export function useUpdateBox1(orderId: number) {
  return useProductMutation<{ productId: number; value: string }>(
    orderId,
    async ({ productId, value }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/box1`, { value });
      return res.data;
    },
  );
}

// ---------------------------------------------------------------------------
// REQ-06-026: Box2 Update
// ---------------------------------------------------------------------------

export function useUpdateBox2(orderId: number) {
  return useProductMutation<{ productId: number; value: string }>(
    orderId,
    async ({ productId, value }) => {
      const res = await api.post(`/orders/${orderId}/products/${productId}/box2`, { value });
      return res.data;
    },
  );
}
