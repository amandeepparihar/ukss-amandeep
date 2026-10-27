import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  EbayReconActionName,
  EbayReconActionResponse,
  EbayReconItemsResponse,
  EbayReconSummaryResponse,
} from '@admin/shared';

export interface EbayReconItemsParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: string[];
  search?: string;
}

export function useEbayReconSummary() {
  return useQuery({
    queryKey: ['ebay-recon-summary'],
    queryFn: async () =>
      (await api.get<{ data: EbayReconSummaryResponse }>('/ebay-reconciliation/summary')).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Poll while a snapshot run is in flight so the header progress updates.
    refetchInterval: (query) => (query.state.data?.runningRun ? 30_000 : false),
  });
}

export function useEbayReconItems(params: EbayReconItemsParams) {
  return useQuery({
    queryKey: ['ebay-recon-items', params],
    queryFn: async () =>
      (
        await api.get<{ data: EbayReconItemsResponse }>('/ebay-reconciliation/items', {
          params: { ...params, category: params.category?.join(',') || undefined },
        })
      ).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // keep rows while paging
  });
}

export function useEbayReconRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { runId: number } }>('/ebay-reconciliation/refresh')).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ebay-recon-summary'] }),
  });
}

export interface EbayReconActionInput {
  action: EbayReconActionName;
  itemIds: string[];
  dryRun: boolean;
  runId?: number;
}

const ACTION_PATHS: Record<EbayReconActionName, string> = {
  reactivate: 'reactivate',
  relist: 'relist',
  mark_gone: 'mark-gone',
  verify_oversell: 'verify-oversell',
};

export function useEbayReconAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, ...body }: EbayReconActionInput) =>
      (
        await api.post<{ data: EbayReconActionResponse }>(
          `/ebay-reconciliation/actions/${ACTION_PATHS[action]}`,
          body,
        )
      ).data.data,
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        qc.invalidateQueries({ queryKey: ['ebay-recon-items'] });
        qc.invalidateQueries({ queryKey: ['ebay-recon-summary'] });
      }
    },
  });
}

export async function downloadEbayReconCsv(params: Omit<EbayReconItemsParams, 'page' | 'limit'>): Promise<void> {
  const res = await api.get('/ebay-reconciliation/items/export', {
    params: { ...params, category: params.category?.join(',') || undefined },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ebay-reconciliation.csv';
  a.click();
  URL.revokeObjectURL(url);
}
