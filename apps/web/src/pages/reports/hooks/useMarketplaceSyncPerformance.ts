import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MarketplaceSyncPerformanceResponse } from '@admin/shared';

export const marketplaceSyncPerformanceQueryKey = ['marketplace-sync-performance'] as const;

/**
 * Marketplace Sync Performance — live per-marketplace sync health & daily-sync
 * activity read from `marketplace_listings`. No params: the BA refreshes
 * manually (the endpoint is uncached, so each fetch is fresh). `staleTime: 0`
 * + `refetchOnWindowFocus: false` keeps it a deliberate, manual-refresh screen.
 */
export function useMarketplaceSyncPerformance() {
  return useQuery({
    queryKey: marketplaceSyncPerformanceQueryKey,
    queryFn: async () =>
      (
        await api.get<{ data: MarketplaceSyncPerformanceResponse }>(
          '/reports/marketplace-sync-performance',
        )
      ).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useResetFailedMarketplaceListings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (storeId: number) => {
      const response = await api.post<{ data: { storeId: number; resetCount: number } }>(
        `/reports/marketplace-sync-performance/${storeId}/reset-failed`,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceSyncPerformanceQueryKey });
    },
  });
}
