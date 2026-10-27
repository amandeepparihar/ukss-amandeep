/**
 * Inventory Entry Form — Barcode, size selection, weight, and box/quantity grid.
 * Requirements: REQ-3.1 through REQ-3.11
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api, getApiError } from '@/lib/api';
import { SizeCascadeSelects, type SizeSelection } from './SizeCascadeSelects';
import { InventoryGrid, type GridRow } from './InventoryGrid';
import { FC_BOX_NUMBER } from '../../orders/constants';

interface InventoryEntryFormProps {
  productListsId: number;
  onSaved: (summary: { totalItems: number; totalBarcodes: number }) => void;
  onCancel?: () => void;
  /** Called right before submit when "Save & Finish" is clicked — lets parent set a flag */
  onFinish?: () => void;
  /** Seed the barcode field on first mount. Only used for the very first
   *  inventory entry — after a save the field clears as usual. Wired from
   *  Step 0 when the user entered a NEW barcode (existing barcodes are
   *  intentionally not seeded since the product already has its own). */
  initialBarcode?: string;
}

export function InventoryEntryForm({
  productListsId,
  onSaved,
  onCancel,
  onFinish,
  initialBarcode,
}: InventoryEntryFormProps) {
  // Barcode is an UNCONTROLLED input read via ref at submit time. Barcode
  // scanners emit the digits followed by a trailing Enter; with a controlled
  // useState input the Enter fired the form submit before React committed the
  // final keystroke, so the last digit was intermittently dropped (bug #166405).
  // Reading straight from the DOM makes the saved value immune to that race.
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [barcodeStatus, setBarcodeStatus] = useState<'same' | 'different' | 'new' | null>(null);
  const [barcodeError, setBarcodeError] = useState('');
  const [sizeSelection, setSizeSelection] = useState<SizeSelection>({});
  const [pendingGroupId, setPendingGroupId] = useState<number | undefined>(undefined);
  const [optionSeeded, setOptionSeeded] = useState(false);
  const [weight, setWeight] = useState<number>(0);
  const [gridRows, setGridRows] = useState<GridRow[]>([
    { boxCode: FC_BOX_NUMBER, quantity: 0, action: 'add' },
  ]);

  // For an existing product the size_option/size_group is fixed by the first
  // inventory row — read it from the existing inventory query (cache-shared
  // with ExistingInventoryTable) and pre-fill the cascade so the user only
  // has to pick the specific size for the new entry.
  const { data: existingInventory } = useQuery({
    queryKey: ['products', 'inventory', productListsId],
    queryFn: async () => {
      const res = await api.get(`/products/inventory/${productListsId}`);
      return res.data.data as {
        rows: Array<{
          products_options_id?: number | null;
          sms_size_groups_id?: number | null;
        }>;
      };
    },
    enabled: !!productListsId,
  });

  const { data: seededSizeGroups } = useQuery({
    queryKey: ['products', 'size-groups', sizeSelection.optionId],
    queryFn: async () => {
      const res = await api.get('/products/size-groups', { params: { optionId: sizeSelection.optionId } });
      return res.data.data as Array<{ sms_size_groups_id: number; size_group_name: string }>;
    },
    enabled: !!sizeSelection.optionId && pendingGroupId !== undefined,
  });

  // Phase 1: seed the option from existing inventory and remember the pending
  // group id. Runs once when existing inventory first arrives.
  useEffect(() => {
    if (optionSeeded) return;
    const first = existingInventory?.rows?.[0];
    if (!first) return;
    const optionId = Number(first.products_options_id) || undefined;
    const groupId = Number(first.sms_size_groups_id) || undefined;
    if (!optionId || !groupId) return;
    setSizeSelection({ optionId, sizeId: undefined });
    setPendingGroupId(groupId);
    setOptionSeeded(true);
  }, [existingInventory, optionSeeded]);

  // Phase 2: once size groups have loaded for the seeded option, apply the
  // pending group id (only if it actually exists in the list — falls through
  // silently if the legacy row points at a deactivated group).
  useEffect(() => {
    if (pendingGroupId === undefined) return;
    if (!seededSizeGroups) return;
    const exists = seededSizeGroups.some(
      (g) => Number(g.sms_size_groups_id) === pendingGroupId,
    );
    if (exists) {
      setSizeSelection((prev) => ({ ...prev, groupId: pendingGroupId }));
    }
    setPendingGroupId(undefined);
  }, [pendingGroupId, seededSizeGroups]);

  // --- Barcode check on blur (REQ-3.4) ---
  const checkBarcode = useCallback(async (value: string) => {
    if (!value.trim()) {
      setBarcodeStatus(null);
      setBarcodeError('');
      return;
    }
    try {
      const res = await api.get(`/products/check-barcode/${encodeURIComponent(value.trim())}`);
      const result = res.data.data;
      if (result.exists) {
        if (result.productListsId === productListsId) {
          setBarcodeStatus('same');
          setBarcodeError('');
        } else {
          setBarcodeStatus('different');
          setBarcodeError(`Barcode belongs to another product: ${result.productCode}`);
        }
      } else {
        setBarcodeStatus('new');
        setBarcodeError('');
      }
    } catch {
      setBarcodeStatus(null);
      setBarcodeError('');
    }
  }, [productListsId]);

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: async (barcodeValue: string) => {
      const payload = {
        productListsId,
        barcode: barcodeValue,
        // Send the full cascade so the backend can reject any
        // (option, group, size) triple that doesn't match the size mapping
        // tables — closes the "user submits a size from another group" gap.
        sizeOptionId: sizeSelection.optionId,
        sizeGroupId: sizeSelection.groupId,
        sizeId: sizeSelection.sizeId,
        weight,
        entries: gridRows.filter((r) => r.boxCode.trim()),
      };
      const res = await api.post('/products/inventory', payload);
      return res.data.data;
    },
    onSuccess: (result) => {
      const totalAdded = result.entries.reduce(
        (sum: number, e: { newQuantity: number; previousQuantity: number }) =>
          sum + (e.newQuantity - e.previousQuantity), 0,
      );
      toast.success(`Inventory saved: ${totalAdded} items across ${result.entries.length} box(es)`);

      // Calculate summary for the collapsed state
      const summary = {
        totalItems: result.entries.reduce((sum: number, e: { newQuantity: number }) => sum + e.newQuantity, 0),
        totalBarcodes: result.entries.length,
      };

      // Reset form but keep size selection for rapid entry
      if (barcodeInputRef.current) barcodeInputRef.current.value = '';
      setBarcodeStatus(null);
      setBarcodeError('');
      setWeight(0);
      setGridRows([{ boxCode: FC_BOX_NUMBER, quantity: 0, action: 'add' }]);
      onSaved(summary);
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const validateAndSubmit = (): boolean => {
    // Read from the DOM, not React state — see barcodeInputRef comment above.
    const trimmedBarcode = (barcodeInputRef.current?.value ?? '').trim();
    if (!trimmedBarcode) {
      toast.error('Barcode is required');
      return false;
    }
    // Match legacy SMS contract (product_quantities_controller.php line 477).
    if (trimmedBarcode.length > 13) {
      toast.error('Barcode must be 13 characters or less');
      return false;
    }
    if (barcodeStatus === 'different') {
      toast.error('Cannot use a barcode that belongs to another product');
      return false;
    }
    if (!sizeSelection.optionId || !sizeSelection.groupId || !sizeSelection.sizeId) {
      toast.error('Please select size option, group, and size');
      return false;
    }
    if (!weight || weight <= 0) {
      toast.error('Weight is required and must be greater than 0');
      return false;
    }
    const validRows = gridRows.filter((r) => r.boxCode.trim());
    if (validRows.length === 0) {
      toast.error('At least one box entry is required');
      return false;
    }
    const boxCodes = validRows.map((r) => r.boxCode.toLowerCase().trim());
    if (new Set(boxCodes).size !== boxCodes.length) {
      toast.error('Duplicate box codes detected');
      return false;
    }
    saveMutation.mutate(trimmedBarcode);
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateAndSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* All fields on one row: Barcode + Weight(small) + Size Option + Size Group + Size(big) */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_80px_1fr_1fr_2fr] gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2">
            Barcode
            {barcodeStatus === 'same' && (
              <Badge variant="secondary" className="text-xs">Assigned to this product</Badge>
            )}
            {barcodeStatus === 'new' && (
              <Badge variant="outline" className="text-xs">New barcode</Badge>
            )}
          </Label>
          <Input
            ref={barcodeInputRef}
            placeholder="Enter or scan barcode..."
            defaultValue={initialBarcode ?? ''}
            maxLength={13}
            onChange={() => { setBarcodeStatus(null); setBarcodeError(''); }}
            onBlur={(e) => checkBarcode(e.target.value)}
            className={barcodeError ? 'border-red-500' : ''}
          />
          {barcodeError && <p className="text-xs text-red-500">{barcodeError}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>
            Weight (g) <span className="text-red-500">*</span>
          </Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0"
            value={weight || ''}
            onChange={(e) => setWeight(Number(e.target.value) || 0)}
          />
        </div>

        {/* Size cascade selects — use "contents" so the 3 inner divs become grid items */}
        <SizeCascadeSelects
          value={sizeSelection}
          onChange={setSizeSelection}
          className="contents"
          productListsId={productListsId}
        />
      </div>

      {/* Inventory grid (REQ-3.5, REQ-3.10) */}
      <InventoryGrid
        value={gridRows}
        onChange={setGridRows}
      />

      {/* Submit — two buttons */}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saveMutation.isPending}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
        <Button type="submit" variant="outline" disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Inventory
        </Button>
        <Button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => {
            onFinish?.(); // Set the finish flag before submitting
            validateAndSubmit();
          }}
        >
          {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Inventory &amp; Finish
        </Button>
      </div>
    </form>
  );
}
