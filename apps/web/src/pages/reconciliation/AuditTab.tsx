import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { Loader2, Play, Download, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, getApiError } from '@/lib/api';
import { AuditResultsTable, type AuditOrderRecord } from './AuditResultsTable';
import { SummaryCard } from './SummaryCard';
import { downloadBlobExport, formatDate, formatDateTime } from './utils';

// ─── Types ───────────────────────────────────────────────────

interface StoreInfo {
  storeId: number;
  storeName: string;
  shopDomain?: string;
}

interface MarketplaceStores {
  marketplace: string;
  stores: StoreInfo[];
}

interface AuditStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  error?: string;
  progress?: {
    phase: 'fetching' | 'processing';
    currentStore: string;
    fetchedOrders: number;
    totalStoresProcessed: number;
    totalStores: number;
  };
}

interface AuditResultsData {
  generatedAt: string;
  marketplace: string;
  fromDate: string;
  toDate: string;
  summary: {
    totalFromApi: number;
    foundInMo: number;
    convertedToUkss: number;
    missingFromMo: number;
    unconverted: number;
    productMismatches: number;
  };
  orders: AuditOrderRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  errors?: Array<{ storeId: number; storeName: string; error: string }>;
}

// ─── Schema ──────────────────────────────────────────────────

const auditFormSchema = z
  .object({
    marketplace: z.enum(['shopify', 'toffs', 'fruugo', 'debenhams']),
    storeIds: z.array(z.number()).optional(),
    fromDate: z.string().min(1, 'Start date is required'),
    toDate: z.string().min(1, 'End date is required'),
  })
  .refine((d) => new Date(d.fromDate) < new Date(d.toDate), {
    message: 'Start date must be before end date',
    path: ['toDate'],
  })
  .refine(
    (d) => {
      const diff =
        new Date(d.toDate).getTime() - new Date(d.fromDate).getTime();
      return diff <= 31 * 24 * 60 * 60 * 1000;
    },
    {
      message: 'Date range must not exceed 31 days',
      path: ['toDate'],
    }
  );

type AuditFormData = z.infer<typeof auditFormSchema>;

// ─── Helpers ─────────────────────────────────────────────────

function getDefaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function getDefaultToDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Main Component ──────────────────────────────────────────

export function AuditTab() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize page + filter from URL
  const [page, setPage] = useState<number>(() => {
    const p = parseInt(searchParams.get('auditPage') ?? '1', 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [filter, setFilter] = useState<'all' | 'missing' | 'unconverted' | 'mismatch'>(() => {
    const f = searchParams.get('auditFilter');
    if (f === 'missing' || f === 'unconverted' || f === 'mismatch') return f;
    return 'all';
  });

  // Fetch stores for marketplace selection
  const { data: storesData } = useQuery<MarketplaceStores[]>({
    queryKey: ['reconciliation-stores'],
    queryFn: () => api.get('/reconciliation/stores').then((r) => r.data.data),
  });

  // Poll audit status
  const { data: auditStatus } = useQuery<AuditStatus>({
    queryKey: ['audit-status'],
    queryFn: () =>
      api.get('/reconciliation/audit/status').then((r) => r.data.data),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : 30000,
  });

  // Fetch results when completed or idle (previous results available)
  const {
    data: resultsData,
    isLoading: isLoadingResults,
  } = useQuery<AuditResultsData>({
    queryKey: ['audit-results', page, filter],
    queryFn: () =>
      api
        .get(
          `/reconciliation/audit/results?page=${page}&pageSize=50&filter=${filter}`
        )
        .then((r) => r.data.data),
    enabled:
      auditStatus?.status === 'completed' ||
      (!auditStatus || auditStatus.status === 'idle'),
  });

  // Form setup — initialize defaults from URL params
  const form = useForm<AuditFormData>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      marketplace: (() => {
        const mp = searchParams.get('auditMp');
        if (mp === 'toffs' || mp === 'fruugo' || mp === 'debenhams') return mp;
        return 'shopify';
      })(),
      storeIds: (() => {
        const s = searchParams.get('stores');
        if (!s) return [];
        return s.split(',').map(Number).filter((n) => !isNaN(n));
      })(),
      fromDate: searchParams.get('from') ?? getDefaultFromDate(),
      toDate: searchParams.get('to') ?? getDefaultToDate(),
    },
  });

  // Sync form values + filter + page → URL
  const watchedMarketplace = form.watch('marketplace');
  const watchedFromDate = form.watch('fromDate');
  const watchedToDate = form.watch('toDate');
  const watchedStoreIds = form.watch('storeIds');

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('auditMp', watchedMarketplace);
      if (watchedFromDate) next.set('from', watchedFromDate);
      if (watchedToDate) next.set('to', watchedToDate);
      if (watchedStoreIds && watchedStoreIds.length > 0) {
        next.set('stores', watchedStoreIds.join(','));
      } else {
        next.delete('stores');
      }
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedMarketplace, watchedFromDate, watchedToDate, watchedStoreIds]);

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (filter === 'all') {
        next.delete('auditFilter');
      } else {
        next.set('auditFilter', filter);
      }
      if (page === 1) {
        next.delete('auditPage');
      } else {
        next.set('auditPage', String(page));
      }
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page]);

  const selectedMarketplace = form.watch('marketplace');

  const shopifyStores =
    storesData?.find((m) => m.marketplace === 'shopify')?.stores ?? [];

  const selectedStoreIds = form.watch('storeIds') ?? [];
  const allStoresSelected =
    shopifyStores.length > 0 &&
    selectedStoreIds.length === shopifyStores.length;

  // Run audit mutation
  const runAuditMutation = useMutation({
    mutationFn: (data: AuditFormData) => {
      const payload: Record<string, unknown> = {
        marketplace: data.marketplace,
        fromDate: new Date(data.fromDate).toISOString(),
        toDate: new Date(data.toDate + 'T23:59:59').toISOString(),
      };

      if (
        data.marketplace === 'shopify' &&
        data.storeIds &&
        data.storeIds.length > 0
      ) {
        payload.storeIds = data.storeIds;
      }

      return api.post('/reconciliation/audit/run', payload);
    },
    onSuccess: () => {
      toast.success('Audit report generation started');
      // Optimistic update prevents race: disables results query before next poll
      queryClient.setQueryData(['audit-status'], { status: 'running' });
      queryClient.invalidateQueries({ queryKey: ['audit-status'], refetchType: 'none' });
      queryClient.removeQueries({ queryKey: ['audit-results'] });
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  const onSubmit = (data: AuditFormData) => {
    runAuditMutation.mutate(data);
  };

  // Store toggle handlers
  const handleStoreToggle = (storeId: number, checked: boolean) => {
    const current = form.getValues('storeIds') ?? [];
    if (checked) {
      form.setValue('storeIds', [...current, storeId]);
    } else {
      form.setValue(
        'storeIds',
        current.filter((id) => id !== storeId)
      );
    }
  };

  const handleToggleAllStores = (checked: boolean) => {
    if (checked) {
      form.setValue(
        'storeIds',
        shopifyStores.map((s) => s.storeId)
      );
    } else {
      form.setValue('storeIds', []);
    }
  };

  // Export handler
  async function handleAuditExport(format: 'csv' | 'xlsx') {
    try {
      await downloadBlobExport(`/reconciliation/audit/export?format=${format}`, `audit-report.${format}`);
    } catch {
      toast.error('Failed to download export');
    }
  }

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Order Audit Report</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <div className="flex flex-wrap items-end gap-4">
                {/* Marketplace select */}
                <FormField
                  control={form.control}
                  name="marketplace"
                  render={({ field }) => (
                    <FormItem className="min-w-[180px]">
                      <FormLabel>Marketplace</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          form.setValue('storeIds', []);
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select marketplace" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="shopify">Shopify</SelectItem>
                          <SelectItem value="toffs">Toffs</SelectItem>
                          <SelectItem value="fruugo">Fruugo</SelectItem>
                          <SelectItem value="debenhams">Debenhams</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* From date */}
                <FormField
                  control={form.control}
                  name="fromDate"
                  render={({ field }) => (
                    <FormItem className="min-w-[160px]">
                      <FormLabel>From Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* To date */}
                <FormField
                  control={form.control}
                  name="toDate"
                  render={({ field }) => (
                    <FormItem className="min-w-[160px]">
                      <FormLabel>To Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Submit button */}
                <Button
                  type="submit"
                  disabled={
                    auditStatus?.status === 'running' ||
                    runAuditMutation.isPending
                  }
                >
                  {runAuditMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Generate Report
                    </>
                  )}
                </Button>
              </div>

              {/* Shopify store selection */}
              {selectedMarketplace === 'shopify' && (
                <div className="space-y-2">
                  <Label>Shopify Stores</Label>
                  <div className="rounded-md border">
                    <div className="flex items-center space-x-2 border-b p-3">
                      <Checkbox
                        id="audit-all-stores"
                        checked={allStoresSelected}
                        onCheckedChange={(checked) =>
                          handleToggleAllStores(checked === true)
                        }
                      />
                      <label
                        htmlFor="audit-all-stores"
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        All Shopify Stores
                      </label>
                    </div>
                    <ScrollArea className="h-[160px]">
                      <div className="p-3 space-y-3">
                        {shopifyStores.map((store) => (
                          <div
                            key={store.storeId}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`audit-store-${store.storeId}`}
                              checked={selectedStoreIds.includes(store.storeId)}
                              onCheckedChange={(checked) =>
                                handleStoreToggle(
                                  store.storeId,
                                  checked === true
                                )
                              }
                            />
                            <label
                              htmlFor={`audit-store-${store.storeId}`}
                              className="text-sm leading-none cursor-pointer"
                            >
                              {store.storeName}
                            </label>
                          </div>
                        ))}
                        {shopifyStores.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            No active Shopify stores found.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave empty to check all Shopify stores.
                  </p>
                </div>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Running status */}
      {auditStatus?.status === 'running' && (
        <Alert className="border-blue-200 bg-blue-50 text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Generating audit report...</AlertTitle>
          <AlertDescription>
            {auditStatus.progress
              ? `${auditStatus.progress.phase === 'fetching' ? 'Fetching from' : 'Processing'} ${auditStatus.progress.currentStore}... ${auditStatus.progress.fetchedOrders} orders fetched (${auditStatus.progress.totalStoresProcessed}/${auditStatus.progress.totalStores} stores)`
              : 'Starting...'}
          </AlertDescription>
        </Alert>
      )}

      {/* Failed status */}
      {auditStatus?.status === 'failed' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audit report generation failed</AlertTitle>
          <AlertDescription>
            {auditStatus.error ?? 'An unexpected error occurred.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Results section */}
      {resultsData && auditStatus?.status !== 'running' && (
        <>
          {/* Report metadata and export */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Report generated {formatDateTime(resultsData.generatedAt)}{' '}
              &middot; {resultsData.marketplace} &middot;{' '}
              {formatDate(resultsData.fromDate)} to{' '}
              {formatDate(resultsData.toDate)}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleAuditExport('csv')}>
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAuditExport('xlsx')}>
                  Export Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <SummaryCard
              title="Total from API"
              count={resultsData.summary.totalFromApi}
              variant="neutral"
              active={filter === 'all'}
              onClick={() => { setFilter('all'); setPage(1); }}
            />
            <SummaryCard
              title="Found in MO"
              count={resultsData.summary.foundInMo}
              variant="success"
              active={filter === 'all'}
              onClick={() => { setFilter('all'); setPage(1); }}
            />
            <SummaryCard
              title="Converted to UKSS"
              count={resultsData.summary.convertedToUkss}
              variant="success"
              active={filter === 'all'}
              onClick={() => { setFilter('all'); setPage(1); }}
            />
            <SummaryCard
              title="Missing"
              count={resultsData.summary.missingFromMo}
              variant="error"
              active={filter === 'missing'}
              onClick={() => { setFilter('missing'); setPage(1); }}
            />
            <SummaryCard
              title="Unconverted"
              count={resultsData.summary.unconverted}
              variant="warning"
              active={filter === 'unconverted'}
              onClick={() => { setFilter('unconverted'); setPage(1); }}
            />
            <SummaryCard
              title="Mismatches"
              count={resultsData.summary.productMismatches}
              variant="error"
              active={filter === 'mismatch'}
              onClick={() => { setFilter('mismatch'); setPage(1); }}
            />
          </div>

          {/* Results table */}
          <AuditResultsTable
            results={resultsData}
            page={page}
            filter={filter}
            onPageChange={setPage}
            onFilterChange={(f) => {
              setFilter(f as typeof filter);
              setPage(1);
            }}
            isLoading={isLoadingResults}
          />
        </>
      )}

      {/* Store errors from report */}
      {resultsData?.errors && resultsData.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some stores had errors</AlertTitle>
          <AlertDescription>
            {resultsData.errors
              .map((e) => `${e.storeName}: ${e.error}`)
              .join('; ')}
          </AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {!resultsData &&
        auditStatus?.status !== 'running' &&
        auditStatus?.status !== 'failed' && (
          <Alert>
            <AlertTitle>No audit report available</AlertTitle>
            <AlertDescription>
              Select a marketplace and date range above to generate an audit
              report.
            </AlertDescription>
          </Alert>
        )}
    </div>
  );
}
