import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ShopifySyncPerformanceResponse, ShopifySyncFailuresResponse,
} from '@admin/shared';

/** Manual-refresh screen: staleTime 0, no refetch on focus. */
export function useShopifySyncPerformance(windowHours: number) {
  return useQuery({
    queryKey: ['shopify-sync-performance', windowHours],
    queryFn: async () =>
      (await api.get<{ data: ShopifySyncPerformanceResponse }>(
        `/reports/shopify-sync-performance?windowHours=${windowHours}`,
      )).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Lazy drill-down — only fetches when a store row is expanded. */
export function useShopifySyncFailures(storeId: number | null, windowHours: number, enabled: boolean) {
  return useQuery({
    queryKey: ['shopify-sync-failures', storeId, windowHours],
    enabled: enabled && storeId !== null,
    queryFn: async () =>
      (await api.get<{ data: ShopifySyncFailuresResponse }>(
        `/reports/shopify-sync-performance/${storeId}/failures?windowHours=${windowHours}&pageSize=200`,
      )).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
