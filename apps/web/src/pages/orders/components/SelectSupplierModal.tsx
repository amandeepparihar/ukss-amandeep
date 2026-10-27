/**
 * SPEC-12a: SelectSupplierModal — create a supplier order for one or more
 * order-product lines.
 *
 * Props:
 *   orderId         — the parent order id
 *   orderProductIds — the op ids to include (per-line launch passes a single id)
 *   open / onOpenChange — controlled open state (caller owns)
 *
 * Flow:
 *   1. On open, fetch supplier options + per-line free-quantity data via
 *      useSupplierOptions (GET /orders/:id/supplier-options?orderProductIds=…).
 *   2. Render per-line: product name + size, open-bucket counts, placed-bucket
 *      counts (if present).
 *   3. A single supplier Select (list comes pre-filtered by the backend —
 *      do NOT re-filter client-side) and a quantity number input (default 1).
 *   4. "Create supplier order" disabled until a supplier is chosen.
 *   5. On submit call useCreateSupplierOrder; toast result + close on success.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useSupplierOptions,
  useCreateSupplierOrder,
} from '../hooks/useSupplierSelection';
import type { SupplierOptionLine } from '../hooks/useSupplierSelection';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SelectSupplierModalProps {
  orderId: number;
  orderProductIds: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Sub-component: per-line free-quantity summary
// ---------------------------------------------------------------------------

function FreeQuantityHints({ line }: { line: SupplierOptionLine }) {
  const { openOrder, placedOrder } = line.freeQuantity;
  const { productName, sizeName } = line.metadata;

  return (
    <div className="rounded border bg-muted/40 p-2 text-xs">
      <div className="font-medium">
        {productName}
        {sizeName ? <span className="ml-1 text-muted-foreground">({sizeName})</span> : null}
      </div>

      {openOrder ? (
        <div className="mt-1 text-muted-foreground">
          Open stock — total: {openOrder.totalQuantity}, assigned:{' '}
          {openOrder.assignedQuantity}, free: {openOrder.freeQuantity}
          {openOrder.restrictedQuantity > 0
            ? `, restricted: ${openOrder.restrictedQuantity}`
            : null}
        </div>
      ) : (
        <div className="mt-1 text-muted-foreground">No open stock</div>
      )}

      {placedOrder ? (
        <div className="mt-0.5 text-muted-foreground">
          Placed order{' '}
          {placedOrder.supplierOrderNumber
            ? `#${placedOrder.supplierOrderNumber}`
            : null}{' '}
          — total: {placedOrder.totalQuantity}, assigned:{' '}
          {placedOrder.assignedQuantity}, free: {placedOrder.freeQuantity}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function SelectSupplierModal({
  orderId,
  orderProductIds,
  open,
  onOpenChange,
}: SelectSupplierModalProps) {
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);

  const { data, isLoading, isError } = useSupplierOptions(orderId, orderProductIds);
  const createOrder = useCreateSupplierOrder(orderId);

  // Reset local state when dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setSupplierId(null);
      setQuantity(1);
    }
    onOpenChange(nextOpen);
  };

  const handleCreate = () => {
    if (supplierId === null) return;
    createOrder.mutate(
      { supplierId, orderProductIds, quantity },
      {
        onSuccess: (result) => {
          const parts: string[] = [];
          if (result.createdLines > 0) parts.push(`${result.createdLines} created`);
          if (result.updatedLines > 0) parts.push(`${result.updatedLines} updated`);
          if (result.overflowRows > 0) parts.push(`${result.overflowRows} overflow`);

          const transitSuffix = result.statusChangedTo128
            ? 'order moved to In Transit'
            : result.statusChangedTo22
              ? 'order moved to Retro Shirts'
              : '';
          const description =
            parts.length > 0 && transitSuffix
              ? `${parts.join(', ')} — ${transitSuffix}`
              : parts.length > 0
                ? parts.join(', ')
                : transitSuffix;
          toast.success('Supplier order created', { description });
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error('Failed to create supplier order', {
            description: err.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Supplier</DialogTitle>
          <DialogDescription>
            Create a supplier order for the selected product line
            {orderProductIds.length > 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="space-y-4 py-2">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading supplier options…
              </span>
            </div>
          )}

          {isError && (
            <div className="py-4 text-center text-sm text-red-600">
              Failed to load supplier options. Please close and try again.
            </div>
          )}

          {data && (
            <>
              {/* Per-line free-quantity hints */}
              <div className="space-y-2">
                {data.lines.map((line) => (
                  <FreeQuantityHints
                    key={line.metadata.orderProductId}
                    line={line}
                  />
                ))}
              </div>

              {/* Supplier select */}
              <div className="space-y-1.5">
                <label htmlFor="supplier-select" className="text-sm font-medium">Supplier</label>
                {data.suppliers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No suppliers available for this product.
                  </p>
                ) : (
                  <Select
                    value={supplierId !== null ? String(supplierId) : ''}
                    onValueChange={(val) => setSupplierId(Number(val))}
                  >
                    <SelectTrigger id="supplier-select">
                      <SelectValue placeholder="Select a supplier…" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.suppliers.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Quantity input */}
              <div className="space-y-1.5">
                <label htmlFor="supplier-quantity" className="text-sm font-medium">Quantity</label>
                <Input
                  id="supplier-quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1) setQuantity(v);
                  }}
                  className="w-24"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createOrder.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              supplierId === null ||
              createOrder.isPending ||
              isLoading ||
              !data
            }
          >
            {createOrder.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create supplier order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
