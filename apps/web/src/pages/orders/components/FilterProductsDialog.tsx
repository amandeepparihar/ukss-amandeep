/**
 * Filter Products cascade dialog — category → product → size.
 * Matches legacy orders.php popup behaviour (3-mode apply logic):
 *   - product chosen  → filter by product (+ optional size)
 *   - category only   → filter by category (no size)
 *   - neither         → no-op (Apply is disabled)
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFilterCategories, useProductsByCategory, useSizesByProduct } from '../hooks/useOrders';
import type { FilterState } from './OrderFilters';

interface FilterProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

export function FilterProductsDialog({
  open,
  onOpenChange,
  filters,
  onFilterChange,
}: FilterProductsDialogProps) {
  // Local cascade state (uncommitted until Apply)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(undefined);
  const [selectedProductId, setSelectedProductId] = useState<number | undefined>(undefined);
  const [selectedSizeId, setSelectedSizeId] = useState<number | undefined>(undefined);

  // Initialise from active filters when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedCategoryId(filters.popupCategoryId);
      setSelectedProductId(filters.popupProductId);
      setSelectedSizeId(filters.sizeFilter);
    }
  }, [open, filters.popupCategoryId, filters.popupProductId, filters.sizeFilter]);

  const { data: categories, isLoading: categoriesLoading } = useFilterCategories();
  const { data: products, isLoading: productsLoading } = useProductsByCategory(selectedCategoryId);
  const { data: sizes, isLoading: sizesLoading } = useSizesByProduct(selectedProductId);

  const handleCategoryChange = (val: string) => {
    const id = val !== '__none__' ? Number(val) : undefined;
    setSelectedCategoryId(id);
    // Reset downstream
    setSelectedProductId(undefined);
    setSelectedSizeId(undefined);
  };

  const handleProductChange = (val: string) => {
    const id = val !== '__none__' ? Number(val) : undefined;
    setSelectedProductId(id);
    // Reset downstream
    setSelectedSizeId(undefined);
  };

  const handleSizeChange = (val: string) => {
    setSelectedSizeId(val !== '__none__' ? Number(val) : undefined);
  };

  const handleApply = () => {
    if (selectedProductId) {
      // Product chosen → filter by product + optional size
      onFilterChange({
        ...filters,
        popupProductId: selectedProductId,
        popupCategoryId: undefined,
        sizeFilter: selectedSizeId,
      });
    } else if (selectedCategoryId) {
      // Category only → filter by category, no size
      onFilterChange({
        ...filters,
        popupCategoryId: selectedCategoryId,
        popupProductId: undefined,
        sizeFilter: undefined,
      });
    }
    onOpenChange(false);
  };

  const handleClearFilter = () => {
    setSelectedCategoryId(undefined);
    setSelectedProductId(undefined);
    setSelectedSizeId(undefined);
    onFilterChange({
      ...filters,
      popupProductId: undefined,
      popupCategoryId: undefined,
      sizeFilter: undefined,
    });
    onOpenChange(false);
  };

  const canApply = Boolean(selectedProductId || selectedCategoryId);
  const filterIsActive = Boolean(filters.popupProductId || filters.popupCategoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Filter Products</DialogTitle>
          <DialogDescription>
            Select a category and optionally narrow by product and size.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category select */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Category</label>
            <Select
              value={selectedCategoryId?.toString() ?? '__none__'}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={categoriesLoading ? 'Loading...' : 'Select category'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— All Categories —</SelectItem>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product select — enabled only when category chosen */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground data-[active=true]:text-foreground" data-active={!!selectedCategoryId}>
              Product
            </label>
            <Select
              value={selectedProductId?.toString() ?? '__none__'}
              onValueChange={handleProductChange}
              disabled={!selectedCategoryId}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !selectedCategoryId
                      ? 'Select a category first'
                      : productsLoading
                      ? 'Loading...'
                      : 'Select product'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— All Products —</SelectItem>
                {products?.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Size select — enabled only when product chosen (optional) */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground data-[active=true]:text-foreground" data-active={!!selectedProductId}>
              Size <span className="font-normal">(optional)</span>
            </label>
            <Select
              value={selectedSizeId?.toString() ?? '__none__'}
              onValueChange={handleSizeChange}
              disabled={!selectedProductId}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !selectedProductId
                      ? 'Select a product first'
                      : sizesLoading
                      ? 'Loading...'
                      : 'All Sizes'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— All Sizes —</SelectItem>
                {sizes?.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {filterIsActive && (
              <Button variant="ghost" size="sm" onClick={handleClearFilter}>
                Clear Filter
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!canApply}>
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
