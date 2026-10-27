import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { downloadBlobExport } from '@/lib/download';

export interface Team {
  teamsId: number;
  teamName: string;
  sort: number;
  created: string | null;
}

export interface TeamsApiResponse {
  data: Team[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface TeamPayload {
  teamName: string;
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

export function useTeamsList(params: Record<string, unknown>) {
  return useQuery<TeamsApiResponse>({
    queryKey: ['teams', params],
    queryFn: async () => {
      const response = await api.get('/teams', { params });
      return response.data;
    },
  });
}

export type TeamExportFormat = 'csv' | 'xlsx';

export interface TeamExportParams {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

// exports the full filtered set, so pagination params are deliberately not sent
export async function exportTeams(params: TeamExportParams, format: TeamExportFormat) {
  const query = new URLSearchParams({ format });

  if (params.search) query.set('search', params.search);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  await downloadBlobExport(`/teams/export?${query.toString()}`, `teams.${format}`);
}

export function useTeam(id?: string | number) {
  return useQuery<Team>({
    queryKey: ['teams', id],
    queryFn: async () => {
      const response = await api.get(`/teams/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useNextSort(enabled = true) {
  return useQuery<{ nextSort: number }>({
    queryKey: ['teams', 'next-sort'],
    queryFn: async () => {
      const response = await api.get('/teams/next-sort');
      return response.data.data;
    },
    enabled,
  });
}

export function useNameAvailable(name: string, excludeId?: string | number) {
  const debouncedName = useDebounce(name.trim(), 400);

  const query = useQuery<{ available: boolean }>({
    queryKey: ['teams', 'name-available', debouncedName, excludeId],
    queryFn: async () => {
      const response = await api.get('/teams/name-available', {
        params: { name: debouncedName, excludeId },
      });
      return response.data.data;
    },
    enabled: debouncedName.length > 0,
  });

  // debouncedName lets the caller ignore results for a name that has since ch
  // anged
  return { ...query, debouncedName };
}

export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TeamPayload) => {
      const response = await api.post('/teams', data);
      return response.data.data as Team;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string | number; data: TeamPayload }) => {
      const response = await api.put(`/teams/${id}`, data);
      return response.data.data as Team;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['teams', variables.id] });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string | number) => {
      const response = await api.delete(`/teams/${id}`);
      return response.data.data as { status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}
