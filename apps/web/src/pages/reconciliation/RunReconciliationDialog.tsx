import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { api, getApiError } from '@/lib/api';

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

// ─── Schema ──────────────────────────────────────────────────

const runReconciliationSchema = z.object({
  marketplace: z.enum(['all', 'shopify', 'toffs', 'fruugo', 'debenhams']),
  storeIds: z.array(z.number().int()).optional(),
  hours: z.coerce.number().int().min(1).max(720),
  stuckThreshold: z.coerce.number().int().min(1).max(168),
  unconvertedThreshold: z.coerce.number().int().min(1).max(168),
});

type RunReconciliationFormData = z.infer<typeof runReconciliationSchema>;

// ─── Props ───────────────────────────────────────────────────

interface RunReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRunning: boolean;
}

// ─── Component ───────────────────────────────────────────────

export function RunReconciliationDialog({
  open,
  onOpenChange,
  isRunning,
}: RunReconciliationDialogProps) {
  const queryClient = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const form = useForm<RunReconciliationFormData>({
    resolver: zodResolver(runReconciliationSchema),
    defaultValues: {
      marketplace: 'all',
      storeIds: [],
      hours: 24,
      stuckThreshold: 6,
      unconvertedThreshold: 2,
    },
  });

  const selectedMarketplace = form.watch('marketplace');

  // Fetch active stores for the store selection list
  const { data: storesData } = useQuery<MarketplaceStores[]>({
    queryKey: ['reconciliation-stores'],
    queryFn: () => api.get('/reconciliation/stores').then((r) => r.data.data),
    enabled: open,
  });

  const shopifyStores =
    storesData?.find((m) => m.marketplace === 'shopify')?.stores ?? [];

  // Run reconciliation mutation
  const runMutation = useMutation({
    mutationFn: async (data: RunReconciliationFormData) => {
      const payload: Record<string, unknown> = {
        marketplace: data.marketplace,
        hours: data.hours,
        stuckThreshold: data.stuckThreshold,
        unconvertedThreshold: data.unconvertedThreshold,
      };

      // Only include storeIds for Shopify when specific stores are selected
      if (
        data.marketplace === 'shopify' &&
        data.storeIds &&
        data.storeIds.length > 0
      ) {
        payload.storeIds = data.storeIds;
      }

      const response = await api.post('/reconciliation/run', payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Reconciliation started');
      queryClient.invalidateQueries({ queryKey: ['reconciliation-status'] });
      onOpenChange(false);
      form.reset();
      setShowAdvanced(false);
    },
    onError: (error) => {
      const apiError = getApiError(error);
      if (apiError.code === 'ALREADY_RUNNING') {
        toast.error('A reconciliation is already in progress');
      } else {
        toast.error(apiError.message);
      }
    },
  });

  const onSubmit = (data: RunReconciliationFormData) => {
    runMutation.mutate(data);
  };

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

  const selectedStoreIds = form.watch('storeIds') ?? [];
  const allStoresSelected =
    shopifyStores.length > 0 &&
    selectedStoreIds.length === shopifyStores.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Run Reconciliation</DialogTitle>
          <DialogDescription>
            Configure and start a new reconciliation check.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Marketplace selection */}
            <FormField
              control={form.control}
              name="marketplace"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marketplace</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      // Reset storeIds when marketplace changes
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
                      <SelectItem value="all">All</SelectItem>
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

            {/* Store selection - only shown for Shopify */}
            {selectedMarketplace === 'shopify' && (
              <div className="space-y-2">
                <Label>Shopify Stores</Label>
                <div className="rounded-md border">
                  {/* All Shopify Stores toggle */}
                  <div className="flex items-center space-x-2 border-b p-3">
                    <Checkbox
                      id="all-stores"
                      checked={allStoresSelected}
                      onCheckedChange={(checked) =>
                        handleToggleAllStores(checked === true)
                      }
                    />
                    <label
                      htmlFor="all-stores"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      All Shopify Stores
                    </label>
                  </div>

                  {/* Individual store checkboxes */}
                  <ScrollArea className="h-[160px]">
                    <div className="p-3 space-y-3">
                      {shopifyStores.map((store) => (
                        <div
                          key={store.storeId}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={`store-${store.storeId}`}
                            checked={selectedStoreIds.includes(store.storeId)}
                            onCheckedChange={(checked) =>
                              handleStoreToggle(store.storeId, checked === true)
                            }
                          />
                          <label
                            htmlFor={`store-${store.storeId}`}
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

            {/* Advanced settings toggle */}
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
              Advanced Settings
            </button>

            {/* Advanced settings content */}
            {showAdvanced && (
              <div className="space-y-4 rounded-md border p-4">
                <FormField
                  control={form.control}
                  name="hours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lookback Window (hours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={720}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stuckThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stuck Threshold (hours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="unconvertedThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unconverted Threshold (hours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={runMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isRunning || runMutation.isPending}
              >
                {runMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  'Run Reconciliation'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
