import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfQuarter,
  endOfQuarter,
} from 'date-fns';
import { CalendarIcon, RefreshCw, Store, Clock, X, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  CommandSeparator,
} from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { StoreInfo } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardFilterValues {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  stores: number[];  // empty = all stores
}

// ---------------------------------------------------------------------------
// Date Presets
// ---------------------------------------------------------------------------

type DatePresetKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'custom';

interface DatePreset {
  key: DatePresetKey;
  label: string;
  getRange: () => { start: string; end: string };
}

const formatDate = (d: Date): string => format(d, 'yyyy-MM-dd');

const DATE_PRESETS: DatePreset[] = [
  {
    key: 'today',
    label: 'Today',
    getRange: () => {
      const today = formatDate(new Date());
      return { start: today, end: today };
    },
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    getRange: () => {
      const yesterday = formatDate(subDays(new Date(), 1));
      return { start: yesterday, end: yesterday };
    },
  },
  {
    key: 'last7',
    label: 'Last 7 Days',
    getRange: () => ({
      start: formatDate(subDays(new Date(), 6)),
      end: formatDate(new Date()),
    }),
  },
  {
    key: 'last30',
    label: 'Last 30 Days',
    getRange: () => ({
      start: formatDate(subDays(new Date(), 29)),
      end: formatDate(new Date()),
    }),
  },
  {
    key: 'thisMonth',
    label: 'This Month',
    getRange: () => ({
      start: formatDate(startOfMonth(new Date())),
      end: formatDate(new Date()),
    }),
  },
  {
    key: 'lastMonth',
    label: 'Last Month',
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return {
        start: formatDate(startOfMonth(lastMonth)),
        end: formatDate(endOfMonth(lastMonth)),
      };
    },
  },
  {
    key: 'thisQuarter',
    label: 'This Quarter',
    getRange: () => ({
      start: formatDate(startOfQuarter(new Date())),
      end: formatDate(endOfQuarter(new Date())),
    }),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine which preset matches the current start/end dates */
function detectPreset(startDate: string, endDate: string): DatePresetKey {
  for (const preset of DATE_PRESETS) {
    const { start, end } = preset.getRange();
    if (start === startDate && end === endDate) return preset.key;
  }
  return 'custom';
}

/** Default range: Last 7 Days */
function getDefaultRange() {
  return DATE_PRESETS.find((p) => p.key === 'last7')!.getRange();
}

// ---------------------------------------------------------------------------
// Hook: useDashboardFilters
// ---------------------------------------------------------------------------

export function useDashboardFilters(): DashboardFilterValues & {
  isRefreshing: boolean;
  refreshData: () => void;
} {
  const [searchParams] = useSearchParams();

  const defaults = getDefaultRange();
  const startDate = searchParams.get('startDate') || defaults.start;
  const endDate = searchParams.get('endDate') || defaults.end;
  const storesParam = searchParams.get('stores') || '';
  const stores = storesParam
    ? storesParam.split(',').map(Number).filter((n) => !isNaN(n))
    : [];

  const queryClient = useQueryClient();
  const isRefreshing = queryClient.isFetching({ queryKey: ['sales-dashboard'] }) > 0;

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
  }, [queryClient]);

  return { startDate, endDate, stores, isRefreshing, refreshData };
}

// ---------------------------------------------------------------------------
// Component: DashboardFilters
// ---------------------------------------------------------------------------

interface DashboardFiltersProps {
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function DashboardFilters({ isRefreshing = false, onRefresh }: DashboardFiltersProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Derive current filter state from URL ----
  const defaults = getDefaultRange();
  const startDate = searchParams.get('startDate') || defaults.start;
  const endDate = searchParams.get('endDate') || defaults.end;
  const storesParam = searchParams.get('stores') || '';
  const selectedStores = useMemo(
    () => (storesParam ? storesParam.split(',').map(Number).filter((n) => !isNaN(n)) : []),
    [storesParam]
  );

  const activePreset = detectPreset(startDate, endDate);

  // ---- Fetch stores from API ----
  const { data: storesData, isLoading: storesLoading } = useQuery({
    queryKey: ['dashboard-stores'],
    queryFn: async () => {
      const response = await api.get('/sales-dashboard/stores');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const storeOptions: StoreInfo[] = storesData?.data || [];

  // ---- URL update helpers ----
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === '') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const handlePresetClick = useCallback(
    (preset: DatePreset) => {
      const { start, end } = preset.getRange();
      updateParams({ startDate: start, endDate: end });
    },
    [updateParams]
  );

  const handleStartDateChange = useCallback(
    (value: string) => {
      updateParams({ startDate: value });
    },
    [updateParams]
  );

  const handleEndDateChange = useCallback(
    (value: string) => {
      updateParams({ endDate: value });
    },
    [updateParams]
  );

  const handleStoreToggle = useCallback(
    (storeId: number) => {
      const current = new Set(selectedStores);
      if (current.has(storeId)) {
        current.delete(storeId);
      } else {
        current.add(storeId);
      }
      const arr = Array.from(current);
      updateParams({ stores: arr.length > 0 ? arr.join(',') : null });
    },
    [selectedStores, updateParams]
  );

  const handleClearStores = useCallback(() => {
    updateParams({ stores: null });
  }, [updateParams]);

  const handleSelectAllStores = useCallback(() => {
    const allIds = storeOptions.map((s) => s.storeId);
    updateParams({ stores: allIds.join(',') });
  }, [storeOptions, updateParams]);

  // ---- Render ----
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Left section: Date range & Store filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            {/* Date Range Picker */}
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              activePreset={activePreset}
              onPresetClick={handlePresetClick}
              onStartDateChange={handleStartDateChange}
              onEndDateChange={handleEndDateChange}
            />

            {/* Store Multi-Select */}
            <StoreMultiSelect
              storeOptions={storeOptions}
              selectedStores={selectedStores}
              isLoading={storesLoading}
              onToggle={handleStoreToggle}
              onClear={handleClearStores}
              onSelectAll={handleSelectAllStores}
            />
          </div>

          {/* Right section: Timezone indicator & Refresh button */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
              <Clock className="h-3.5 w-3.5" />
              UK/London Time
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')}
              />
              {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: DateRangePicker
// ---------------------------------------------------------------------------

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  activePreset: DatePresetKey;
  onPresetClick: (preset: DatePreset) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

function DateRangePicker({
  startDate,
  endDate,
  activePreset,
  onPresetClick,
  onStartDateChange,
  onEndDateChange,
}: DateRangePickerProps) {
  // Controlled popover state to prevent re-render closing it
  const [open, setOpen] = useState(false);
  const [localStart, setLocalStart] = useState(startDate);
  const [localEnd, setLocalEnd] = useState(endDate);

  // Sync local state when props change externally (e.g., preset clicks)
  useEffect(() => {
    setLocalStart(startDate);
    setLocalEnd(endDate);
  }, [startDate, endDate]);

  // Flush local values to URL params only when popover closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) {
        if (localStart !== startDate) onStartDateChange(localStart);
        if (localEnd !== endDate) onEndDateChange(localEnd);
      }
    },
    [localStart, localEnd, startDate, endDate, onStartDateChange, onEndDateChange]
  );

  const presetLabel =
    activePreset === 'custom'
      ? `${startDate} - ${endDate}`
      : DATE_PRESETS.find((p) => p.key === activePreset)?.label ?? 'Custom Range';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start text-left font-normal">
          <CalendarIcon className="mr-2 h-4 w-4" />
          <span>{presetLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex flex-col sm:flex-row">
          {/* Presets sidebar */}
          <div className="border-b p-2 sm:border-b-0 sm:border-r sm:w-40">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Quick Select
            </p>
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onPresetClick(preset)}
                className={cn(
                  'w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                  activePreset === preset.key &&
                    'bg-accent text-accent-foreground font-medium'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          <div className="p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Custom Range
            </p>
            <div className="space-y-2">
              <div>
                <label
                  htmlFor="filter-start-date"
                  className="text-xs text-muted-foreground"
                >
                  Start Date
                </label>
                <Input
                  id="filter-start-date"
                  type="date"
                  value={localStart}
                  max={localEnd}
                  onChange={(e) => setLocalStart(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="filter-end-date"
                  className="text-xs text-muted-foreground"
                >
                  End Date
                </label>
                <Input
                  id="filter-end-date"
                  type="date"
                  value={localEnd}
                  min={localStart}
                  max={formatDate(new Date())}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: StoreMultiSelect
// ---------------------------------------------------------------------------

interface StoreMultiSelectProps {
  storeOptions: StoreInfo[];
  selectedStores: number[];
  isLoading: boolean;
  onToggle: (storeId: number) => void;
  onClear: () => void;
  onSelectAll: () => void;
}

function StoreMultiSelect({
  storeOptions,
  selectedStores,
  isLoading,
  onToggle,
  onClear,
  onSelectAll,
}: StoreMultiSelectProps) {
  const selectedSet = useMemo(() => new Set(selectedStores), [selectedStores]);
  const allSelected = storeOptions.length > 0 && selectedStores.length === storeOptions.length;

  const triggerLabel = useMemo(() => {
    if (selectedStores.length === 0) return 'All Stores';
    if (selectedStores.length === 1) {
      const store = storeOptions.find((s) => s.storeId === selectedStores[0]);
      return store?.storeName ?? '1 store';
    }
    return `${selectedStores.length} stores`;
  }, [selectedStores, storeOptions]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="justify-start text-left font-normal"
          disabled={isLoading}
        >
          <Store className="mr-2 h-4 w-4" />
          <span>{isLoading ? 'Loading stores...' : triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search stores..." />
          <CommandList>
            <CommandEmpty>No stores found.</CommandEmpty>
            <CommandGroup>
              {/* All Stores option */}
              <CommandItem
                onSelect={() => {
                  if (selectedStores.length === 0) return;
                  onClear();
                }}
              >
                <div
                  className={cn(
                    'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                    selectedStores.length === 0
                      ? 'bg-primary text-primary-foreground'
                      : 'opacity-50 [&_svg]:invisible'
                  )}
                >
                  <Check className="h-4 w-4" />
                </div>
                <span>All Stores</span>
              </CommandItem>
              <CommandSeparator />
              {/* Select All / Clear All */}
              <div className="flex items-center justify-between px-2 py-1.5">
                <button
                  type="button"
                  onClick={allSelected ? onClear : onSelectAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allSelected ? 'Clear All' : 'Select All'}
                </button>
                {selectedStores.length > 0 && (
                  <button
                    type="button"
                    onClick={onClear}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <CommandSeparator />
              {/* Individual stores */}
              {storeOptions.map((store) => {
                const isSelected = selectedSet.has(store.storeId);
                return (
                  <CommandItem
                    key={store.storeId}
                    value={store.storeName}
                    onSelect={() => onToggle(store.storeId)}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="mr-2"
                      // Prevent double-toggle - the CommandItem onSelect handles it
                      onCheckedChange={() => {}}
                    />
                    <span>{store.storeName}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Selected store badges (optional usage by parent)
// ---------------------------------------------------------------------------

interface SelectedStoreBadgesProps {
  storeOptions: StoreInfo[];
  selectedStores: number[];
  onRemove: (storeId: number) => void;
}

export function SelectedStoreBadges({
  storeOptions,
  selectedStores,
  onRemove,
}: SelectedStoreBadgesProps) {
  if (selectedStores.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {selectedStores.map((id) => {
        const store = storeOptions.find((s) => s.storeId === id);
        if (!store) return null;
        return (
          <Badge key={id} variant="secondary" className="gap-1">
            {store.storeName}
            <button
              type="button"
              onClick={() => onRemove(id)}
              className="ml-0.5 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Remove {store.storeName}</span>
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
