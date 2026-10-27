/**
 * Order listing filters — dropdowns and search inputs.
 * Requirements: REQ-02-006 through REQ-02-015
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, Filter } from 'lucide-react';
import type { OrderStatus, Store } from '../hooks/useOrders';
import { FilterProductsDialog } from './FilterProductsDialog';

// REQ-02-006: Special status entries
const SPECIAL_STATUSES = [
  { id: 200, name: 'Orders Being Picked Before 3PM Today' },
  { id: 1223, name: 'Unallocated Stock' },
  { id: 1224, name: 'Refund Review' },
  { id: 1225, name: 'Delivery Updates' },
  { id: 101, name: 'FC orders need to be shipped' },
  { id: 102, name: 'FC orders (Undespatched)' },
];

// REQ-02-008: Marketplace options
const MARKETPLACE_OPTIONS = [
  'amazon', 'tesco', 'mplaza', 'fruugo', 'rakuten', 'lazada',
  'priceminister', 'gosport', 'catch', 'ebay', 'terracegear', 'racecrate', 'decathlon',
];

// REQ-02-010: Sort options
const SORT_OPTIONS = [
  { value: 'default', label: 'Default (Order ID)' },
  { value: 'statusChanged', label: 'Order Status Changed' },
  { value: 'orderValue', label: 'Order Value' },
];

// REQ-02-011: Scanning status options
const SCANNING_OPTIONS = [
  { value: 'scanned', label: 'Scanned' },
  { value: 'non-scanned', label: 'Non-scanned' },
  { value: 'amazon-premium', label: 'Amazon Premium' },
];

// REQ-02-011B: Interval options
const INTERVAL_OPTIONS = [
  { value: '3', label: '3 Months' },
  { value: '6', label: '6 Months' },
  { value: '12', label: '12 Months' },
];

interface OrderFiltersProps {
  statuses: OrderStatus[] | undefined;
  stores: Store[] | undefined;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

export interface FilterState {
  status?: number;
  seller?: string;
  marketplace?: string;
  marketplaceSearchValue?: string;
  orderType?: string;
  sortBy?: string;
  scanningStatus?: string;
  interval?: number;
  search?: string;
  orderId?: string;
  toffsCode?: string;
  fsBarcode?: string;
  productSearch?: string;
  sizeFilter?: number;
  popupProductId?: number;
  popupCategoryId?: number;
}

export function OrderFilters({ statuses, stores, filters, onFilterChange }: OrderFiltersProps) {
  const [localSearch, setLocalSearch] = useState(filters.search ?? '');
  const [localOrderId, setLocalOrderId] = useState(filters.orderId ?? '');
  const [localMarketplaceSearch, setLocalMarketplaceSearch] = useState(filters.marketplaceSearchValue ?? '');
  const [localToffs, setLocalToffs] = useState(filters.toffsCode ?? '');
  const [localFsb, setLocalFsb] = useState(filters.fsBarcode ?? '');
  const [localProduct, setLocalProduct] = useState(filters.productSearch ?? '');
  const [filterProductsOpen, setFilterProductsOpen] = useState(false);

  const update = (partial: Partial<FilterState>) => {
    onFilterChange({ ...filters, ...partial });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update({ search: localSearch || undefined });
  };

  const handleOrderIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (localOrderId) {
      update({ orderId: localOrderId });
    }
  };

  const handleMarketplaceSearch = (e: React.FormEvent) => {
    e.preventDefault();
    update({ marketplaceSearchValue: localMarketplaceSearch || undefined });
  };

  const handleToffsSearch = (e: React.FormEvent) => {
    e.preventDefault();
    update({ toffsCode: localToffs || undefined });
  };

  const handleFsbSearch = (e: React.FormEvent) => {
    e.preventDefault();
    update({ fsBarcode: localFsb || undefined });
  };

  const handleProductSearch = (e: React.FormEvent) => {
    e.preventDefault();
    update({ productSearch: localProduct || undefined });
  };

  const clearAllFilters = () => {
    setLocalSearch('');
    setLocalOrderId('');
    setLocalMarketplaceSearch('');
    setLocalToffs('');
    setLocalFsb('');
    setLocalProduct('');
    onFilterChange({});
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined && v !== '');
  const filterProductsActive = Boolean(filters.popupProductId || filters.popupCategoryId);

  return (
    <div className="space-y-3">
      {/* Row 1: Primary dropdowns */}
      <div className="flex flex-wrap gap-2">
        {/* REQ-02-006: Status filter */}
        <Select
          value={filters.status?.toString() ?? '__all__'}
          onValueChange={(val) => update({ status: val !== '__all__' ? Number(val) : undefined })}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            {statuses?.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.name}
              </SelectItem>
            ))}
            <SelectItem disabled value="---">--- Special ---</SelectItem>
            {SPECIAL_STATUSES.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* REQ-02-007: Seller/store filter */}
        <Select
          value={filters.seller ?? '__all__'}
          onValueChange={(val) => update({ seller: val !== '__all__' ? val : undefined })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Sellers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" data-value="__all__">All Sellers</SelectItem>
            {stores?.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()} data-value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* REQ-02-009: Order type filter */}
        <Select
          value={filters.orderType ?? '__all__'}
          onValueChange={(val) => update({ orderType: val !== '__all__' ? val : undefined })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            <SelectItem value="wholesale">Wholesale</SelectItem>
            <SelectItem value="online">Online</SelectItem>
          </SelectContent>
        </Select>

        {/* REQ-02-010: Sort by */}
        <Select
          value={filters.sortBy ?? 'default'}
          onValueChange={(val) => update({ sortBy: val })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort By" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* REQ-02-011: Scanning status (only when status=14) */}
        {filters.status === 14 && (
          <Select
            value={filters.scanningStatus ?? '__all__'}
            onValueChange={(val) => update({ scanningStatus: val !== '__all__' ? val : undefined })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Scanning" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Scanning</SelectItem>
              {SCANNING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* REQ-02-011B: Interval */}
        <Select
          value={filters.interval?.toString() ?? '__all__'}
          onValueChange={(val) => update({ interval: val !== '__all__' ? Number(val) : undefined })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Dates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Dates</SelectItem>
            {INTERVAL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Filter Products dialog trigger */}
        <Button
          variant={filterProductsActive ? 'default' : 'outline'}
          size="sm"
          className="h-10"
          onClick={() => setFilterProductsOpen(true)}
        >
          <Filter className="h-4 w-4 mr-1" />
          {filterProductsActive ? 'Product Filter Active' : 'Filter Products'}
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-10">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Row 2: Search inputs */}
      <div className="flex flex-wrap gap-2">
        {/* REQ-02-014: Order ID search */}
        <form onSubmit={handleOrderIdSubmit} className="flex gap-1">
          <Input
            type="number"
            placeholder="Order ID"
            value={localOrderId}
            onChange={(e) => setLocalOrderId(e.target.value)}
            className="w-[120px]"
          />
          <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
            <Search className="h-4 w-4" />
          </Button>
        </form>

        {/* REQ-02-014: General search */}
        <form onSubmit={handleSearchSubmit} className="flex gap-1">
          <Input
            placeholder="Search name, email, address..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-[260px]"
          />
          <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
            <Search className="h-4 w-4" />
          </Button>
        </form>

        {/* REQ-02-008: Marketplace dropdown + search */}
        <Select
          value={filters.marketplace ?? '__all__'}
          onValueChange={(val) => update({
            marketplace: val !== '__all__' ? val : undefined,
            marketplaceSearchValue: undefined,
          })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Marketplace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">None</SelectItem>
            {MARKETPLACE_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* REQ-02-013: Marketplace search input (visible when marketplace selected) */}
        {filters.marketplace && (
          <form onSubmit={handleMarketplaceSearch} className="flex gap-1">
            <Input
              placeholder={`${filters.marketplace} order ID`}
              value={localMarketplaceSearch}
              onChange={(e) => setLocalMarketplaceSearch(e.target.value)}
              className="w-[180px]"
            />
            <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        )}

        {/* REQ-02-014: Toffs code search */}
        <form onSubmit={handleToffsSearch} className="flex gap-1">
          <Input
            placeholder="Toffs code"
            value={localToffs}
            onChange={(e) => setLocalToffs(e.target.value)}
            className="w-[140px]"
          />
          <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
            <Search className="h-4 w-4" />
          </Button>
        </form>

        {/* REQ-02-014: Football Souvenir barcode search */}
        <form onSubmit={handleFsbSearch} className="flex gap-1">
          <Input
            placeholder="FS barcode"
            value={localFsb}
            onChange={(e) => setLocalFsb(e.target.value)}
            className="w-[140px]"
          />
          <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
            <Search className="h-4 w-4" />
          </Button>
        </form>

        {/* REQ-02-014: Product name/model search (supports ID:<id> prefix) */}
        <form onSubmit={handleProductSearch} className="flex gap-1">
          <Input
            placeholder="Product name/model or ID:123"
            value={localProduct}
            onChange={(e) => setLocalProduct(e.target.value)}
            className="w-[220px]"
          />
          <Button type="submit" size="icon" variant="outline" className="h-10 w-10">
            <Search className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* Filter Products cascade dialog */}
      <FilterProductsDialog
        open={filterProductsOpen}
        onOpenChange={setFilterProductsOpen}
        filters={filters}
        onFilterChange={onFilterChange}
      />
    </div>
  );
}
