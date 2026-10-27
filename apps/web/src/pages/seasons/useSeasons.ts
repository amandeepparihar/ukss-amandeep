import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { downloadBlobExport } from '@/lib/download';

export interface Season {
  seasonsId: number;
  season: string;
  sort: number;
  created: string | null;
}

export interface SeasonsApiResponse {
  data: Season[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface CreateSeasonPayload {
  season: string;
  sort: number;
}

export interface UpdateSeasonPayload {
  season: string;
  sort: number;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useSeasonsList(params: Record<string, unknown>) {
  return useQuery<SeasonsApiResponse>({
    queryKey: ['seasons', params],
    queryFn: async () => {
      const response = await api.get('/seasons', { params });
      return response.data;
    },
  });
}

export type SeasonExportFormat = 'csv' | 'xlsx';

export interface SeasonExportParams {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

// exports the full filtered set, so pagination params are deliberately not sent
export async function exportSeasons(params: SeasonExportParams, format: SeasonExportFormat) {
  const query = new URLSearchParams({ format });

  if (params.search) query.set('search', params.search);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  await downloadBlobExport(`/seasons/export?${query.toString()}`, `seasons.${format}`);
}

export function useSeason(id?: string | number) {
  return useQuery<Season>({
    queryKey: ['seasons', id],
    queryFn: async () => {
      const response = await api.get(`/seasons/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useNextSort(enabled = true) {
  return useQuery<{ nextSort: number }>({
    queryKey: ['seasons', 'next-sort'],
    queryFn: async () => {
      const response = await api.get('/seasons/next-sort');
      return response.data.data;
    },
    enabled,
  });
}

export function useNameAvailable(name: string, excludeId?: string | number) {
  const debouncedName = useDebounce(name.trim(), 400);

  const query = useQuery<{ available: boolean }>({
    queryKey: ['seasons', 'name-check', debouncedName, excludeId],
    queryFn: async () => {
      const response = await api.get('/seasons/name-check', {
        params: { season: debouncedName, excludeId },
      });
      return response.data.data;
    },
    enabled: debouncedName.length > 0,
  });

  // debouncedName lets the caller ignore results for a name that has since changed
  return { ...query, debouncedName };
}

export function useCreateSeason() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSeasonPayload) => {
      const response = await api.post('/seasons', data);
      return response.data.data as Season;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
    },
  });
}

export function useUpdateSeason() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string | number; data: UpdateSeasonPayload }) => {
      const response = await api.put(`/seasons/${id}`, data);
      return response.data.data as Season;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
      queryClient.invalidateQueries({ queryKey: ['seasons', variables.id] });
    },
  });
}

export function useDeleteSeason() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string | number) => {
      const response = await api.delete(`/seasons/${id}`);
      return response.data.data as { status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
    },
  });
}
