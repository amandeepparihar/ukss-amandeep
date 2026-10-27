import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MsFilters {
  dateFrom: string; dateTo: string;
  channel: 'both' | 'ukss' | 'marketplace'; statuses: string[];
}

export interface MsBreakdownRow {
  orderSite: string; channel: string; orders: number; revenue: number; aov: number;
  sharePercent: number; vsPrevPercent: number | null;
}

export interface MsDailyRow { day: string; orderSite: string; orders: number }

export interface MsHourlyRow { orderSite: string; hour: number; ordersAvg: number }

export interface MsData {
  breakdown: MsBreakdownRow[];
  dailyTrend: MsDailyRow[];
  hourly: MsHourlyRow[];
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMarketplaceSales(filters: MsFilters) {
  return useQuery({
    queryKey: ['marketplace-sales', filters],
    queryFn: async () =>
      (await api.post<{ data: MsData }>('/reports/marketplace-sales', { params: filters })).data.data,
  });
}

export function useDownloadMarketplaceCsv() {
  return useMutation({
    mutationFn: async (filters: MsFilters) => {
      const res = await api.post(
        '/reports/marketplace-sales/export',
        { params: filters },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `marketplace-sales_${filters.dateFrom}_${filters.dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
