import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HourlyRow {
  day: string;
  total: number;
  [hour: string]: string | number; // h00..h23
}

export interface DropdownRow {
  id: number | string;
  name: string;
}

export interface HourlyFilters {
  dateFrom: string; dateTo: string;
  orderStatuses: string[]; channel: 'both' | 'ukss' | 'marketplace'; marketplace?: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useOrderStatuses() {
  return useQuery<DropdownRow[]>({
    queryKey: ['report-order-statuses'],
    queryFn: async () => {
      const response = await api.get('/reports/order-statuses');
      return response.data.data;
    },
  });
}

export function useMarketplaces(enabled: boolean) {
  return useQuery<DropdownRow[]>({
    queryKey: ['report-marketplaces'],
    enabled,
    queryFn: async () => {
      const response = await api.get('/reports/marketplaces');
      return response.data.data;
    },
  });
}

export function useHourlyReport(filters: HourlyFilters) {
  return useQuery<HourlyRow[]>({
    queryKey: ['hourly-orders', filters],
    queryFn: async () => {
      const response = await api.post('/reports/hourly-orders/preview', {
        params: filters,
      });
      return response.data.data.preview;
    },
  });
}

export function useDownloadHourlyCsv() {
  return useMutation({
    mutationFn: async (filters: HourlyFilters) => {
      const response = await api.post(
        '/reports/hourly-orders/generate',
        { format: 'csv', params: filters },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hourly-sales_${filters.dateFrom}_${filters.dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
