/**
 * Inventory Grid — Dynamic rows of [Box Code, Quantity, Action, Remove].
 * Requirements: REQ-3.5, REQ-3.10, REQ-6.4
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { api } from '@/lib/api';

export interface GridRow {
  boxCode: string;
  quantity: number;
  action: 'add' | 'subtract';
}

interface InventoryGridProps {
  value: GridRow[];
  onChange: (rows: GridRow[]) => void;
}

export function InventoryGrid({ value, onChange }: InventoryGridProps) {
  const [boxSearches, setBoxSearches] = useState<Record<number, string>>({});
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});

  // Detect duplicate box codes
  const duplicateIndices = new Set<number>();
  const boxCodeMap = new Map<string, number>();
  value.forEach((row, i) => {
    const lower = row.boxCode.toLowerCase().trim();
    if (lower && boxCodeMap.has(lower)) {
      duplicateIndices.add(i);
      duplicateIndices.add(boxCodeMap.get(lower)!);
    } else if (lower) {
      boxCodeMap.set(lower, i);
    }
  });

  const updateRow = (index: number, updates: Partial<GridRow>) => {
    const newRows = [...value];
    newRows[index] = { ...newRows[index], ...updates };
    onChange(newRows);
  };

  const addRow = () => {
    onChange([...value, { boxCode: '', quantity: 0, action: 'add' }]);
  };

  const removeRow = (index: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <BoxEntryRow
          key={index}
          row={row}
          index={index}
          isDuplicate={duplicateIndices.has(index)}
          boxSearch={boxSearches[index] || ''}
          onBoxSearchChange={(s) => setBoxSearches({ ...boxSearches, [index]: s })}
          popoverOpen={openPopovers[index] || false}
          onPopoverOpenChange={(open) => setOpenPopovers({ ...openPopovers, [index]: open })}
          onUpdate={(updates) => updateRow(index, updates)}
          onRemove={() => removeRow(index)}
          showRemove={value.length > 1}
        />
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-1 h-4 w-4" /> Add Row
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single row component
// ---------------------------------------------------------------------------

function BoxEntryRow({
  row,
  index,
  isDuplicate,
  boxSearch,
  onBoxSearchChange,
  popoverOpen,
  onPopoverOpenChange,
  onUpdate,
  onRemove,
  showRemove,
}: {
  row: GridRow;
  index: number;
  isDuplicate: boolean;
  boxSearch: string;
  onBoxSearchChange: (s: string) => void;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  onUpdate: (updates: Partial<GridRow>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const { data: boxResults } = useQuery({
    queryKey: ['products', 'boxes', boxSearch],
    queryFn: async () => {
      const res = await api.get('/products/boxes', { params: { search: boxSearch } });
      return res.data.data as Array<{ box_lists_id: number; box_code: string }>;
    },
    enabled: popoverOpen,
  });

  return (
    <div className="flex items-end gap-2">
      {/* Box Code with autocomplete */}
      <div className="flex-1 min-w-0">
        {index === 0 && <Label className="mb-1.5 block">Box Code</Label>}
        <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={`w-full justify-start font-normal ${
                isDuplicate ? 'border-red-500 text-red-500' : ''
              } ${!row.boxCode ? 'text-muted-foreground' : ''}`}
            >
              {row.boxCode || 'Select box...'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search or type box code..."
                value={boxSearch}
                onValueChange={onBoxSearchChange}
              />
              <CommandList>
                <CommandEmpty>
                  {boxSearch.trim() ? (
                    <button
                      type="button"
                      className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded"
                      onClick={() => {
                        onUpdate({ boxCode: boxSearch.trim() });
                        onPopoverOpenChange(false);
                      }}
                    >
                      Use &quot;{boxSearch.trim()}&quot; (new box)
                    </button>
                  ) : (
                    'No boxes found.'
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {boxResults?.map((box) => (
                    <CommandItem
                      key={box.box_lists_id}
                      value={box.box_code}
                      onSelect={() => {
                        onUpdate({ boxCode: box.box_code });
                        onPopoverOpenChange(false);
                      }}
                    >
                      {box.box_code}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {isDuplicate && <p className="text-xs text-red-500 mt-1">Duplicate box code</p>}
      </div>

      {/* Quantity */}
      <div className="w-24">
        {index === 0 && <Label className="mb-1.5 block">Qty</Label>}
        <Input
          type="number"
          min="0"
          value={row.quantity}
          onChange={(e) => onUpdate({ quantity: Math.max(0, Number(e.target.value) || 0) })}
        />
      </div>

      {/* Action */}
      <div className="w-28">
        {index === 0 && <Label className="mb-1.5 block">Action</Label>}
        <Select value={row.action} onValueChange={(v) => onUpdate({ action: v as 'add' | 'subtract' })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add">Add</SelectItem>
            <SelectItem value="subtract">Subtract</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remove */}
      {showRemove && (
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="shrink-0">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
