/**
 * Existing Inventory Table — Display with inline quantity/weight editing.
 * Requirements: REQ-4.1, REQ-4.2, REQ-4.3
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ExistingInventoryTableProps {
  productListsId: number;
}

interface InventoryRow {
  product_quantities_id: number;
  barcode: string;
  manufacturer_size_shortname: string;
  weight: number;
  box_code: string;
  quantity: number;
  date_added: string;
}

interface EditState {
  quantity: string;
  weight: string;
}

export function ExistingInventoryTable({ productListsId }: ExistingInventoryTableProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<EditState>({ quantity: '', weight: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['products', 'inventory', productListsId],
    queryFn: async () => {
      const res = await api.get(`/products/inventory/${productListsId}`);
      return res.data.data as {
        rows: InventoryRow[];
        summary: { totalItems: number; totalBarcodes: number };
      };
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, quantity, weight }: { id: number; quantity: number; weight: number }) => {
      await api.patch(`/products/inventory/${id}`, { quantity, weight });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', 'inventory', productListsId] });
      setEditingId(null);
      toast.success('Inventory updated');
    },
    onError: () => {
      toast.error('Failed to update inventory');
    },
  });

  function startEdit(row: InventoryRow) {
    setEditingId(row.product_quantities_id);
    setEditValues({
      quantity: String(row.quantity),
      weight: String(Number(row.weight) || 0),
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit(id: number) {
    const quantity = parseInt(editValues.quantity, 10);
    const weight = parseFloat(editValues.weight) || 0;
    if (isNaN(quantity)) {
      toast.error('Quantity must be a whole number');
      return;
    }
    updateMutation.mutate({ id, quantity, weight });
  }

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <div>
      {/* Summary badges */}
      {summary && (
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="secondary">{summary.totalItems} items</Badge>
          <Badge variant="outline">{summary.totalBarcodes} barcodes</Badge>
        </div>
      )}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No inventory entries yet.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Weight (g)</TableHead>
                  <TableHead>Box</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isEditing = editingId === row.product_quantities_id;
                  const isSaving = updateMutation.isPending && editingId === row.product_quantities_id;
                  return (
                    <TableRow key={row.product_quantities_id}>
                      <TableCell className="font-mono text-sm">{row.barcode}</TableCell>
                      <TableCell>{row.manufacturer_size_shortname || '—'}</TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            value={editValues.weight}
                            onChange={(e) => setEditValues((v) => ({ ...v, weight: e.target.value }))}
                            className="w-24 h-7 text-right text-sm ml-auto"
                          />
                        ) : (
                          Number(row.weight) || 0
                        )}
                      </TableCell>
                      <TableCell>{row.box_code || '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editValues.quantity}
                            onChange={(e) => setEditValues((v) => ({ ...v, quantity: e.target.value }))}
                            className="w-20 h-7 text-right text-sm ml-auto"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(row.product_quantities_id);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                          />
                        ) : (
                          row.quantity
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.date_added}</TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-2 text-xs"
                              disabled={isSaving}
                              onClick={() => saveEdit(row.product_quantities_id)}
                            >
                              {isSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={isSaving}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </div>
      )}
    </div>
  );
}
