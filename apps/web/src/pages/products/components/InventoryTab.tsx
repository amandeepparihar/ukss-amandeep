/**
 * Inventory Tab — Orchestrates entry form and existing inventory table.
 * Requirements: REQ-3, REQ-4
 *
 * Form converts to summary block after save, similar to Product Details.
 */

import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, Package, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InventoryEntryForm } from './InventoryEntryForm';
import { ExistingInventoryTable } from './ExistingInventoryTable';

interface InventoryTabProps {
  productListsId: number;
  /** Called when user clicks "Save Inventory & Finish" — parent collapses step */
  onFinished?: () => void;
  /** Seed the first inventory row's barcode — forwarded from Step 0 when the
   *  user resolved a NEW barcode. Existing barcodes are not seeded. */
  initialBarcode?: string;
}

export function InventoryTab({
  productListsId,
  onFinished,
  initialBarcode,
}: InventoryTabProps) {
  const queryClient = useQueryClient();
  const [isEditingInventory, setIsEditingInventory] = useState(true);
  const [inventorySummary, setInventorySummary] = useState<{
    totalItems: number;
    totalBarcodes: number;
  } | null>(null);
  const [existingOpen, setExistingOpen] = useState(false);
  // Ref to track whether we should collapse after save
  const finishAfterSaveRef = useRef(false);

  const handleInventorySaved = (summary: { totalItems: number; totalBarcodes: number }) => {
    queryClient.invalidateQueries({ queryKey: ['products', 'inventory', productListsId] });
    setInventorySummary(summary);
    setExistingOpen(true); // auto-expand after save so user sees what they just added
    if (finishAfterSaveRef.current) {
      // "Save Inventory & Finish" — collapse and notify parent
      setIsEditingInventory(false);
      finishAfterSaveRef.current = false;
      onFinished?.();
    }
    // "Save Inventory" — stay on the form (don't collapse)
  };

  const handleCancelEdit = () => {
    setIsEditingInventory(false);
  };

  return (
    <div className="space-y-3">
      {/* Inventory Entry Form — always mounted for state preservation */}
      <div className={isEditingInventory ? '' : 'hidden'}>
        <InventoryEntryForm
          productListsId={productListsId}
          onSaved={handleInventorySaved}
          onCancel={inventorySummary ? handleCancelEdit : undefined}
          onFinish={() => { finishAfterSaveRef.current = true; }}
          initialBarcode={initialBarcode}
        />
      </div>

      {/* Collapsed summary shown after inventory is added */}
      {!isEditingInventory && inventorySummary && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-foreground">Inventory Added</span>
            </div>
            <Badge variant="secondary">{inventorySummary.totalItems} items</Badge>
            <Badge variant="outline">{inventorySummary.totalBarcodes} barcodes</Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setIsEditingInventory(true)}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          </div>
        </div>
      )}

      {/* Existing inventory — collapsible, always visible, default closed */}
      <div className="rounded-lg border">
        <Button
          type="button"
          variant="ghost"
          className="w-full flex items-center justify-between px-4 py-2.5 h-auto text-sm font-medium rounded-lg hover:bg-muted/40"
          onClick={() => setExistingOpen((o) => !o)}
        >
          <span>Existing Inventory</span>
          {existingOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </Button>
        {existingOpen && (
          <div className="border-t px-4 pb-4 pt-2">
            <ExistingInventoryTable productListsId={productListsId} />
          </div>
        )}
      </div>
    </div>
  );
}
