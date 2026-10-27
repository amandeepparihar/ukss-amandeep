/**
 * Deliveries page — read-only port of the legacy SMS /index/new_stock screen
 * (phase 1 of new_stock_grid.spec.md).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm';
import { ChevronLeft, ChevronRight, ChevronsUpDown, Search, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useDeliveries,
  useDeliveriesTeams,
  useDeliveriesCountries,
  useDeliveriesPermissions,
  useSeasonsList,
  type DeliveryListParams,
} from './hooks/useDeliveries';
import {
  useInlineCellEdit,
  useLinkQuantityToggle,
  useAddToMysteryList,
} from './hooks/useDeliveriesMutations';
import { api } from '@/lib/api';
import { DeliveriesGrid, type SizeActionContext } from './DeliveriesGrid';
import {
  MapDialog,
  SpecialDialog,
  AssignFontDialog,
  RemapSizeDialog,
  SupplierBarcodeDialog,
} from './GridActionDialogs';
import './delivery-row-colors.css';

type Sort = '0' | '1' | '2' | '3';
type UkssStatus = '0' | '1' | '2';
type Dup = '0' | '1';
type StockView = 'none' | 'special' | 'archive';
// Combined "Filter By" + "Stock View" dropdown. Only one of the two legacy
// filters can be active at a time now — sort and stockView are derived from
// this single value below.
type FilterMode = 'none' | 'unmapped' | 'with_images' | 'special' | 'archive';

const FILTER_MODE_MAP: Record<FilterMode, { sort: Sort; stockView: StockView }> = {
  none: { sort: '0', stockView: 'none' },
  unmapped: { sort: '1', stockView: 'none' },
  with_images: { sort: '2', stockView: 'none' },
  special: { sort: '0', stockView: 'special' },
  archive: { sort: '0', stockView: 'archive' },
};

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

export function DeliveriesPage() {
  const [productCodeInput, setProductCodeInput] = useState('');
  const [appliedProductCode, setAppliedProductCode] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('none');
  const [ukssStatus, setUkssStatus] = useState<UkssStatus>('0');
  const [removeDuplicate, setRemoveDuplicate] = useState<Dup>('1');
  const [teamId, setTeamId] = useState<number>(0);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [countryId, setCountryId] = useState<number>(0);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [keywordInput, setKeywordInput] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [orderMode, setOrderMode] = useState<'recent' | 'season'>('recent');

  const { sort, stockView } = FILTER_MODE_MAP[filterMode];

  // Reset to page 1 on filter change.
  useEffect(() => {
    setPage(1);
  }, [filterMode, ukssStatus, removeDuplicate, teamId, countryId, appliedProductCode, pageSize, appliedKeyword, orderMode]);

  const { data: teamsResp } = useDeliveriesTeams();
  const { data: countriesResp } = useDeliveriesCountries();
  const { data: permsResp, isLoading: permsLoading } = useDeliveriesPermissions();
  const { data: seasonsList } = useSeasonsList();
  const teams = teamsResp?.data ?? [];
  const countries = countriesResp?.data ?? [];
  const seasons = useMemo(
    () => (seasonsList ?? []).map((s) => s.name).filter((n) => n && n.trim() !== ''),
    [seasonsList]
  );

  const selectedTeam = useMemo(
    () => (teamId > 0 ? teams.find((t) => t.id === teamId) : undefined),
    [teamId, teams]
  );

  const selectedCountry = useMemo(
    () => (countryId > 0 ? countries.find((c) => c.id === countryId) : undefined),
    [countryId, countries]
  );

  const apiParams = useMemo<DeliveryListParams>(() => {
    const p: DeliveryListParams = {
      page,
      pageSize,
      sort,
      remove_duplicate_product_code: removeDuplicate,
    };
    if (sort !== '0' && ukssStatus !== '0') p.ukss_price_upload_status = ukssStatus;
    if (teamId > 0) p.team_id = teamId;
    if (countryId > 0) p.country_of_origin_id = countryId;
    if (appliedProductCode) p.productcode = appliedProductCode;
    if (stockView === 'special') p.special = '1';
    if (stockView === 'archive') p.archive = '1';
    if (appliedKeyword) p.keyword = appliedKeyword;
    if (orderMode !== 'recent') p.order_mode = orderMode;
    return p;
  }, [page, pageSize, filterMode, sort, ukssStatus, removeDuplicate, teamId, countryId, appliedProductCode, stockView, appliedKeyword, orderMode]);

  const { data, isLoading, isFetching, isError, error } = useDeliveries(apiParams);
  const rows = useMemo(() => data?.data ?? [], [data]);
  const totalRows = data?.pagination.totalRows ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  const applyProductCode = () => setAppliedProductCode(productCodeInput.trim());
  const applyKeyword = () => setAppliedKeyword(keywordInput.trim());
  const clearFilters = () => {
    setProductCodeInput('');
    setAppliedProductCode('');
    setFilterMode('none');
    setUkssStatus('0');
    setRemoveDuplicate('1');
    setTeamId(0);
    setCountryId(0);
    setKeywordInput('');
    setAppliedKeyword('');
    setOrderMode('recent');
    setPage(1);
  };

  const showUkssFilter = sort !== '0';

  // -------------------------------------------------------------------------
  // Write-path callbacks (phase 2). See documentation/deliveries-write-path-plan.md
  // -------------------------------------------------------------------------

  const inlineEdit = useInlineCellEdit();
  const linkQuantityToggle = useLinkQuantityToggle();
  // Grid action dialogs (Map, Special, AssignFont).
  const [mapProductCode, setMapProductCode] = useState<string | null>(null);
  const [specialProductCode, setSpecialProductCode] = useState<string | null>(null);
  const [assignFontProductCode, setAssignFontProductCode] = useState<string | null>(null);
  // Imperative themed confirm (replaces native window.confirm).
  const confirm = useConfirm();

  // -------------------------------------------------------------------------
  // Context-menu actions (Print Label / Mystery Product / Supplier Barcode /
  // Remap Size). All 4 require per-size context — see SizeActionContext.
  // -------------------------------------------------------------------------
  const mysteryListMutation = useAddToMysteryList();
  const [remapContext, setRemapContext] = useState<SizeActionContext | null>(null);
  const [supplierBarcodeContext, setSupplierBarcodeContext] = useState<SizeActionContext | null>(null);

  const handlePrintLabel = (ctx: SizeActionContext) => {
    // Legacy parity: invoice_<product_lists_id>_<size_option_id>.pdf
    // (products_barcode_controller.php:805). Auth is the ambient
    // shared_admin_session cookie (see print-label.routes.ts) — a plain
    // window.open() navigation can't carry the in-memory JWT bearer token,
    // so no separate token-minting step is needed; being logged into the
    // browser once is enough, matching the legacy app's behavior.
    const filename = `invoice_${ctx.productListsId}_${ctx.sizeId}.pdf`;
    const url = `${api.defaults.baseURL}/deliveries/print-label/${filename}?boxCode=${encodeURIComponent(ctx.boxCode)}&sizeId=${ctx.sizeId}`;
    window.open(url, '_blank');
  };

  const handleMysteryProduct = (ctx: SizeActionContext) => {
    mysteryListMutation.mutate(
      { size_id: ctx.sizeId, product_lists_id: ctx.productListsId, box_code: ctx.boxCode },
      {
        onSuccess: () => toast.success('Added to Mystery Product List'),
        onError: (err) => toast.error(err.message || 'Failed to add to Mystery Product List'),
      }
    );
  };

  const handleSupplierBarcodeClick = (ctx: SizeActionContext) => {
    setSupplierBarcodeContext(ctx);
  };

  const handleCellEdit = useCallback(
    async (payload: { productQuantitiesId: number; column: string; value: string }) => {
      try {
        await inlineEdit.mutateAsync(payload);
        toast.success(`Saved: ${payload.column} = ${payload.value}`);
      } catch (err) {
        toast.error((err as Error).message || 'Save failed');
      }
    },
    [inlineEdit]
  );

  const handleLinkQuantityClick = useCallback(
    async (productCode: string, currentlyLinked: boolean) => {
      // The `run` callback keeps the confirm dialog open with a spinner +
      // disabled buttons until the mutation settles. Errors thrown by
      // `mutateAsync` propagate out of `confirm` as a rejected promise — we
      // catch them here to toast the server-provided message.
      try {
        await confirm({
          title: currentlyLinked ? 'Unlink quantity?' : 'Link quantity?',
          description: currentlyLinked ? (
            <>
              This will set <code>quantity_map = 0</code> on <code>{productCode}</code>{' '}
              and stop syncing SMS quantity to the storefront. Mapped storefront products
              keep their last known quantity until you re-link.
            </>
          ) : (
            <>
              This will set <code>quantity_map = 1</code> on <code>{productCode}</code>{' '}
              and copy the SMS total quantity into the mapped storefront products. Existing
              eBay / Shopify feeds will pick up the new quantity on their next sync.
            </>
          ),
          confirmLabel: currentlyLinked ? 'Unlink' : 'Link',
          variant: currentlyLinked ? 'destructive' : 'default',
          run: async () => {
            const res = await linkQuantityToggle.mutateAsync({
              productCode,
              action: currentlyLinked ? 'unlink' : 'link',
            });
            toast.success(`${res.action} (${res.productsAffected} products)`);
          },
        });
      } catch (err) {
        // `confirm` rejects when `run` throws. Anything thrown by axios after
        // the interceptor already has a clean human-readable `.message`.
        toast.error((err as Error).message || 'Link toggle failed');
      }
    },
    [confirm, linkQuantityToggle]
  );

  const navigate = useNavigate();
  // "+" button on Add SMS Product → the Submit-for-Review form
  // (CreateEditProductFormPage). This is the form operators fill in AFTER the
  // product itself was created via the New Product wizard — its job is to
  // submit the product for admin review.
  const handleAddSmsProductClick = useCallback(
    (productCode: string) => {
      navigate(`/deliveries/new-product?pcode=${encodeURIComponent(productCode)}`);
    },
    [navigate]
  );
  // "E" badge on Description → New Product wizard (edit-in-place flow). The
  // wizard's Step 0 resolves the barcode and pre-fills downstream steps.
  const handleEditProductClick = useCallback(
    (productCode: string) => {
      navigate(`/products/new?pcode=${encodeURIComponent(productCode)}`);
    },
    [navigate]
  );
  // Upload Image cell → jump to Step 3 (Images) of the wizard.
  const handleUploadImageClick = useCallback(
    (productCode: string) => {
      navigate(`/products/new?pcode=${encodeURIComponent(productCode)}&step=images`);
    },
    [navigate]
  );

  return (
    // Tighter outer gap (was `space-y-6` = 24px) so the filter card +
    // pagination row sit closer together and the grid below has more
    // vertical room.
    <div className="space-y-3">
      <PageHeader
        title="Deliveries"
        description="New stock deliveries — view per-size quantities, mapping status and image readiness."
      />

      <Card>
        {/* Compact filter card — tight padding and spacing. */}
        <CardContent className="pt-3 pb-3 space-y-2">
          {/* Filter bar — fields wrap and grow to fill the row. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Filter By</Label>
              <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="unmapped">Recently Arrived &amp; Unmapped</SelectItem>
                  <SelectItem value="with_images">Unmapped Product with Images</SelectItem>
                  <SelectItem value="special">Latest Specials (this week)</SelectItem>
                  <SelectItem value="archive">Archive (sold-out)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showUkssFilter && (
              <div className="flex-1 min-w-[150px] space-y-1">
                <Label className="text-xs">UKSS Price</Label>
                <Select value={ukssStatus} onValueChange={(v) => setUkssStatus(v as UkssStatus)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None</SelectItem>
                    <SelectItem value="1">With UKSS Price</SelectItem>
                    <SelectItem value="2">Without UKSS Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Remove Duplicates</Label>
              <Select value={removeDuplicate} onValueChange={(v) => setRemoveDuplicate(v as Dup)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Yes (1 row per product code)</SelectItem>
                  <SelectItem value="0">No (1 row per box)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Team</Label>
              <Popover open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-8 font-normal"
                  >
                    <span className="truncate">
                      {selectedTeam ? selectedTeam.name : 'All teams'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search team…" className="h-9" />
                    <CommandList>
                      <CommandEmpty>No team found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all-teams"
                          onSelect={() => {
                            setTeamId(0);
                            setTeamPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn('mr-2 h-4 w-4', teamId === 0 ? 'opacity-100' : 'opacity-0')}
                          />
                          All teams
                        </CommandItem>
                        {teams.map((t) => (
                          <CommandItem
                            key={t.id}
                            value={t.name}
                            onSelect={() => {
                              setTeamId(t.id);
                              setTeamPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                teamId === t.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {t.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Country of Origin</Label>
              <Popover open={countryPickerOpen} onOpenChange={setCountryPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-8 font-normal"
                  >
                    <span className="truncate">
                      {selectedCountry ? selectedCountry.name : 'All countries'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search country…" className="h-9" />
                    <CommandList>
                      <CommandEmpty>No country found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all-countries"
                          onSelect={() => {
                            setCountryId(0);
                            setCountryPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn('mr-2 h-4 w-4', countryId === 0 ? 'opacity-100' : 'opacity-0')}
                          />
                          All countries
                        </CommandItem>
                        {countries.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setCountryId(c.id);
                              setCountryPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                countryId === c.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Product Code</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="exact match"
                  value={productCodeInput}
                  className="h-8"
                  onChange={(e) => setProductCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyProductCode()}
                />
                <Button size="sm" variant="default" className="h-8 w-8 p-0" onClick={applyProductCode}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 min-w-[150px] space-y-1">
              <Label className="text-xs">Keyword</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="name contains"
                  value={keywordInput}
                  className="h-8"
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyKeyword()}
                />
                <Button size="sm" variant="default" className="h-8 w-8 p-0" onClick={applyKeyword}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-none gap-1.5"
              onClick={clearFilters}
              title="Clear all filters"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>

          {/* Legend — colours match the row background classes (spec §7). */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-red" />Submitted for review</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-lightblue" />Image in Dropbox</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-green" />Mixed size</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-orange" />Has product images</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-pink" />Unmapped</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-blue" />Special</span>
            <span className="inline-flex items-center"><i className="delivery-legend-swatch delivery-legend-yellow" />ZC Linked</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="text-xs text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : `Showing ${rows.length ? (page - 1) * pageSize + 1 : 0}–${(page - 1) * pageSize + rows.length} of ${totalRows.toLocaleString()}`}
          {isFetching && !isLoading ? ' · refreshing…' : ''}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground">Order</Label>
          <Select value={orderMode} onValueChange={(v) => setOrderMode(v as 'recent' | 'season')}>
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest First</SelectItem>
              <SelectItem value="season">Season Order</SelectItem>
            </SelectContent>
          </Select>
          <Label className="text-xs text-muted-foreground">Rows per page</Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v))}
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="outline"
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs">
            Page {page} / {totalPages}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isError ? (
        <div className="text-sm text-destructive py-4">
          Failed to load deliveries: {(error as Error)?.message ?? 'unknown error'}
        </div>
      ) : isLoading || permsLoading || !permsResp ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DeliveriesGrid
          rows={rows}
          permissions={permsResp.data}
          seasons={seasons}
          onCellEdit={handleCellEdit}
          onLinkQuantityClick={handleLinkQuantityClick}
          onAddSmsProductClick={handleAddSmsProductClick}
          onEditProductClick={handleEditProductClick}
          onUploadImageClick={handleUploadImageClick}
          onMapClick={(c) => setMapProductCode(c)}
          onSpecialClick={(c) => setSpecialProductCode(c)}
          onAssignFontClick={(c) => setAssignFontProductCode(c)}
          onPrintLabelClick={handlePrintLabel}
          onSupplierBarcodeClick={handleSupplierBarcodeClick}
          onMysteryProductClick={handleMysteryProduct}
          onRemapSizeClick={(ctx) => setRemapContext(ctx)}
        />
      )}

      <MapDialog
        productCode={mapProductCode}
        onClose={() => setMapProductCode(null)}
      />
      <SpecialDialog
        productCode={specialProductCode}
        onClose={() => setSpecialProductCode(null)}
      />
      <AssignFontDialog
        productCode={assignFontProductCode}
        onClose={() => setAssignFontProductCode(null)}
      />
      <RemapSizeDialog
        context={remapContext}
        onClose={() => setRemapContext(null)}
      />
      <SupplierBarcodeDialog
        context={supplierBarcodeContext}
        onClose={() => setSupplierBarcodeContext(null)}
      />
    </div>
  );
}

export default DeliveriesPage;
