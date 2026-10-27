/**
 * Panel suppliers section — display assigned suppliers with multi-select dropdown.
 * Requirements: REQ-03-013 (supplier list & dropdown)
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateSuppliers } from '../../hooks/useOrderPanel';

interface PanelSuppliersProps {
  orderId: number;
  status: number;
  currentSuppliers: string | null;
  allSuppliers: Array<{ id: number; name: string }>;
}

function parseSupplierIds(suppliers: string | null): Set<number> {
  return new Set(
    (suppliers ?? '').split(';').filter(s => s.trim() !== '').map(Number)
  );
}

export function PanelSuppliers({
  orderId,
  status,
  currentSuppliers,
  allSuppliers,
}: PanelSuppliersProps) {
  const mutation = useUpdateSuppliers(orderId);
  const [showDropdown, setShowDropdown] = useState(false);

  // Parse current supplier IDs from semicolon-delimited string
  const currentIds = parseSupplierIds(currentSuppliers);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(currentIds);

  // Sync selectedIds when props change (after mutation + refetch)
  useEffect(() => {
    setSelectedIds(parseSupplierIds(currentSuppliers));
  }, [currentSuppliers]);

  // REQ-03-013: Current list visible when status == 23 and suppliers not null
  const showCurrentList = status === 23 && currentSuppliers;

  // Get supplier names for display
  const supplierNameMap = new Map(allSuppliers.map(s => [s.id, s.name]));
  const currentSupplierNames = Array.from(currentIds)
    .map(id => supplierNameMap.get(id))
    .filter(Boolean)
    .join(', ');

  const handleToggle = (id: number, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const handleUpdate = async () => {
    const value = Array.from(selectedIds).join(';');
    try {
      await mutation.mutateAsync(value);
      toast.success('Suppliers updated');
      setShowDropdown(false);
    } catch {
      toast.error('Failed to update suppliers');
    }
  };

  const handleCancel = () => {
    setSelectedIds(currentIds);
    setShowDropdown(false);
  };

  return (
    <div className="space-y-2">
      {/* Current suppliers display */}
      {showCurrentList && (
        <div className="text-sm">
          <span className="text-muted-foreground">Suppliers: </span>
          <span>{currentSupplierNames || 'None'}</span>
          <Button
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0 text-blue-600"
            onClick={() => setShowDropdown(true)}
          >
            Edit
          </Button>
        </div>
      )}

      {!showCurrentList && !showDropdown && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDropdown(true)}
        >
          Select Suppliers
        </Button>
      )}

      {/* REQ-03-013: Multi-select dropdown */}
      {showDropdown && (
        <div className="border rounded-md p-2 space-y-2 max-h-48 overflow-y-auto">
          {allSuppliers.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox
                id={`supplier-${s.id}`}
                checked={selectedIds.has(s.id)}
                onCheckedChange={(checked) => handleToggle(s.id, !!checked)}
              />
              <Label htmlFor={`supplier-${s.id}`} className="text-xs cursor-pointer">
                {s.name}
              </Label>
            </div>
          ))}
          <div className="flex gap-2 pt-2 border-t">
            <Button size="sm" onClick={handleUpdate} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Update
            </Button>
            {currentSuppliers && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
