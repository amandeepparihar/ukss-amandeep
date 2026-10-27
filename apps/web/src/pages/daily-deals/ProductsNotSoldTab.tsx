import { useMemo, useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProductsNotSold, useProductDealInfo, useProductSizeGrid, useFilterOptions, useIgnoreProduct, useUnignoreProduct } from './hooks/useDailyDeals';
import { ScheduleGridDialog } from './ScheduleGridDialog';
import { SpecialPriceDialog } from './SpecialPriceDialog';
import { DailyDealsGrid } from './DailyDealsGrid';

type DealInfoMap = Record<number, { dealStatus: string | null; dealRevenue: number; dealUnitsSold: number }>;

interface Props {
  productType: 'all' | 'adults' | 'womens' | 'kids';
  onProductTypeChange: (type: 'all' | 'adults' | 'womens' | 'kids') => void;
}

export function ProductsNotSoldTab({ productType, onProductTypeChange }: Props) {
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [specialProduct, setSpecialProduct] = useState<any>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [visibility, setVisibility] = useState<string>('working');

  const ignoreProduct = useIgnoreProduct();
  const unignoreProduct = useUnignoreProduct();

  const [searchInput, setSearchInput] = useState('');
  const [minQtyInput, setMinQtyInput] = useState('');
  const [notSoldDaysInput, setNotSoldDaysInput] = useState('');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');

  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedMinQty, setAppliedMinQty] = useState(0);
  const [appliedNotSoldDays, setAppliedNotSoldDays] = useState(0);
  const [appliedLeague, setAppliedLeague] = useState(0);
  const [appliedTeam, setAppliedTeam] = useState(0);

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: filterOptionsData } = useFilterOptions();
  const leagues = filterOptionsData?.data?.leagues || [];
  const teams = filterOptionsData?.data?.teams || [];

  const handleApplyFilters = () => {
    setAppliedSearch(searchInput);
    setAppliedMinQty(Number(minQtyInput) || 0);
    setAppliedNotSoldDays(Number(notSoldDaysInput) || 0);
    setAppliedLeague(leagueFilter === 'all' ? 0 : Number(leagueFilter));
    setAppliedTeam(teamFilter === 'all' ? 0 : Number(teamFilter));
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchInput(''); setMinQtyInput(''); setNotSoldDaysInput('');
    setLeagueFilter('all'); setTeamFilter('all');
    setAppliedSearch(''); setAppliedMinQty(0); setAppliedNotSoldDays(0);
    setAppliedLeague(0); setAppliedTeam(0);
    setPage(1);
  };

  const hasFilters = appliedSearch || appliedMinQty > 0 || appliedNotSoldDays > 0 || appliedLeague > 0 || appliedTeam > 0;

  useEffect(() => { setPage(1); }, [productType]);

  const apiParams = useMemo(() => {
    const params: Record<string, any> = {
      page,
      pageSize,
      sortBy: 'last_order_date',
      sortOrder: 'asc',
      productType,
      visibility,
    };
    if (appliedSearch) params.search = appliedSearch;
    if (appliedMinQty > 0) params.minQty = appliedMinQty;
    if (appliedNotSoldDays > 0) params.notSoldSinceDays = appliedNotSoldDays;
    if (appliedLeague > 0) params.leagueId = appliedLeague;
    if (appliedTeam > 0) params.teamId = appliedTeam;
    return params;
  }, [page, appliedSearch, appliedMinQty, appliedNotSoldDays, appliedLeague, appliedTeam, productType, visibility]);

  const { data, isLoading } = useProductsNotSold(apiParams);
  const products = data?.data || [];
  const totalPages = data?.meta?.totalPages || 1;
  const total = data?.meta?.total || 0;

  // Lazy-load deal info + size grid
  const productIds = useMemo(() => products.map((p: any) => p.productsId), [products]);
  const { data: dealInfoData } = useProductDealInfo(productIds);
  const { data: sizeGridData } = useProductSizeGrid(productIds);
  const dealInfoRef = useRef<DealInfoMap>({});
  const sizeGridRef = useRef<Record<number, Record<string, number>>>({});
  useEffect(() => { if (dealInfoData?.data) dealInfoRef.current = dealInfoData.data; }, [dealInfoData]);
  useEffect(() => { if (sizeGridData?.data) sizeGridRef.current = sizeGridData.data; }, [sizeGridData]);
  const [, setLazyVersion] = useState(0);
  useEffect(() => { if (dealInfoData?.data) setLazyVersion((v) => v + 1); }, [dealInfoData]);
  useEffect(() => { if (sizeGridData?.data) setLazyVersion((v) => v + 1); }, [sizeGridData]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Search</Label>
              <Input placeholder="Product code or name..." value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min Quantity</Label>
              <Input type="number" placeholder="e.g. 10" value={minQtyInput}
                onChange={(e) => setMinQtyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not Sold Since (days)</Label>
              <Input type="number" placeholder="e.g. 30" value={notSoldDaysInput}
                onChange={(e) => setNotSoldDaysInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">League</Label>
              <Select value={leagueFilter} onValueChange={setLeagueFilter}>
                <SelectTrigger><SelectValue placeholder="All Leagues" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Leagues</SelectItem>
                  {leagues.map((l: any) => (<SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Team</Label>
              <Select value={teamFilter} onValueChange={setTeamFilter}>
                <SelectTrigger><SelectValue placeholder="All Teams" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  {teams.map((t: any) => (<SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleApplyFilters} size="sm">
                <Search className="h-4 w-4 mr-1" /> Search
              </Button>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visibility + Product Type Tabs + Pagination */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <Select value={visibility} onValueChange={(v) => { setVisibility(v); setPage(1); }}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="working">Working List</SelectItem>
              <SelectItem value="ignored">Ignored Products</SelectItem>
              <SelectItem value="with-deals">Products With Deals</SelectItem>
              <SelectItem value="all">All Products</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            {(['all', 'adults', 'womens', 'kids'] as const).map((type) => (
              <button
                key={type}
                onClick={() => onProductTypeChange(type)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  productType === type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {type === 'all' ? 'All' : type === 'adults' ? 'Adults' : type === 'womens' ? 'Womens' : 'Kids'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{total} products</span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* SlickGrid-style compact grid */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DailyDealsGrid
          data={products}
          sizeData={sizeGridRef.current}
          dealInfo={dealInfoRef.current}
          onAddDeal={(product) => { setSelectedProduct(product); setGridOpen(true); }}
          onSetSpecial={(product) => { setSpecialProduct(product); setSpecialOpen(true); }}
          onIgnoreToggle={(product) => {
            if (product.isIgnored) {
              unignoreProduct.mutate(product.productsId);
            } else {
              ignoreProduct.mutate(product.productsId);
            }
          }}
        />
      )}

      {selectedProduct && (
        <ScheduleGridDialog
          product={selectedProduct}
          open={gridOpen}
          onOpenChange={setGridOpen}
        />
      )}

      {specialProduct && (
        <SpecialPriceDialog
          product={specialProduct}
          open={specialOpen}
          onOpenChange={setSpecialOpen}
        />
      )}
    </div>
  );
}
