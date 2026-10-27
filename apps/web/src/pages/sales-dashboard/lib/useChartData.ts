import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '@/lib/api';

interface UseChartDataOptions {
  endpoint: string;
  params: Record<string, string>;
  enabled?: boolean;
}

export function useChartData<T>({ endpoint, params, enabled = true }: UseChartDataOptions) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const queryKey = ['sales-dashboard', endpoint, params] as const;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const searchParams = new URLSearchParams(params);
      const response = await api.get<{ data: T }>(
        `/sales-dashboard/${endpoint}?${searchParams.toString()}`
      );
      return response.data.data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const refreshFromDb = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const noCacheParams = { ...params, noCache: 'true' };
      const searchParams = new URLSearchParams(noCacheParams);
      await queryClient.fetchQuery({
        queryKey: ['sales-dashboard', endpoint, noCacheParams],
        queryFn: async () => {
          const response = await api.get<{ data: T }>(
            `/sales-dashboard/${endpoint}?${searchParams.toString()}`
          );
          return response.data.data;
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['sales-dashboard', endpoint] });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, endpoint, params]);

  return {
    data,
    isLoading: isLoading || isRefreshing,
    isError,
    error,
    refetch,
    refreshFromDb,
  };
}
