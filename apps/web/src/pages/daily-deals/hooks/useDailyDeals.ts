import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiError } from '@/lib/api';
import { toast } from 'sonner';

// ---------- Query Hooks ----------

export function useProductsNotSold(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ['daily-deals', 'products', params],
    queryFn: async () => {
      const response = await api.get('/daily-deals/products', { params });
      return response.data;
    },
  });
}

export function useSingleSizeProducts(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ['daily-deals', 'single-size', params],
    queryFn: async () => {
      const response = await api.get('/daily-deals/single-size-products', { params });
      return response.data;
    },
  });
}

export function useSchedule(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['daily-deals', 'schedule', startDate, endDate],
    queryFn: async () => {
      const response = await api.get('/daily-deals/schedule', {
        params: { startDate, endDate },
      });
      return response.data;
    },
    enabled: !!startDate && !!endDate,
  });
}

export function useSummary(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['daily-deals', 'summary', startDate, endDate],
    queryFn: async () => {
      const response = await api.get('/daily-deals/summary', {
        params: { startDate, endDate },
      });
      return response.data;
    },
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ['daily-deals', 'filter-options'],
    queryFn: async () => {
      const response = await api.get('/daily-deals/filter-options');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });
}

export function useProductSizeGrid(productIds: number[]) {
  const idsStr = productIds.join(',');
  return useQuery({
    queryKey: ['daily-deals', 'size-grid', idsStr],
    queryFn: async () => {
      const response = await api.get('/daily-deals/product-size-grid', {
        params: { productIds: idsStr },
      });
      return response.data;
    },
    enabled: productIds.length > 0,
  });
}

export function useProductSitePrice(productsId: number) {
  return useQuery({
    queryKey: ['daily-deals', 'site-price', productsId],
    queryFn: async () => {
      const response = await api.get('/daily-deals/product-site-price', {
        params: { productsId },
      });
      return response.data;
    },
    enabled: productsId > 0,
  });
}

export function useProductDealInfo(productIds: number[]) {
  const idsStr = productIds.join(',');
  return useQuery({
    queryKey: ['daily-deals', 'deal-info', idsStr],
    queryFn: async () => {
      const response = await api.get('/daily-deals/product-deal-info', {
        params: { productIds: idsStr },
      });
      return response.data;
    },
    enabled: productIds.length > 0,
  });
}

// ---------- Mutation Hooks ----------

export function useSaveDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      productsId: number;
      productCode: string;
      discountType: 'PERCENT' | 'FIXED';
      discountValue: number;
      dealDate: string;
    }) => {
      const response = await api.post('/daily-deals/deals', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'schedule'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'summary'] });
      toast.success('Deal scheduled successfully');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dealId: number) => {
      const response = await api.delete(`/daily-deals/deals/${dealId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'schedule'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'summary'] });
      toast.success('Deal removed');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

export function useBannerConfig() {
  return useQuery({
    queryKey: ['daily-deals', 'banner-config'],
    queryFn: async () => {
      const response = await api.get('/daily-deals/banner-config');
      return response.data;
    },
  });
}

export function useSaveBannerConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FormData | { title: string }) => {
      const response = await api.post('/daily-deals/banner-config', data, data instanceof FormData
        ? { headers: { 'Content-Type': 'multipart/form-data' } }
        : undefined,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'banner-config'] });
      toast.success('Banner config updated');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

export function useRunCron() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { dryRun?: boolean; date?: string }) => {
      const response = await api.post('/daily-deals/run-cron', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'deal-info'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'schedule'] });
      toast.success('Cron executed successfully');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

// ---------- Special Price Hooks ----------

export function useSpecialPriceInfo(productsId: number) {
  return useQuery({
    queryKey: ['daily-deals', 'special-price', productsId],
    queryFn: async () => {
      const response = await api.get('/daily-deals/special-price', {
        params: { productsId },
      });
      return response.data;
    },
    enabled: productsId > 0,
  });
}

export function useSetSpecialPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      productsId: number;
      specialPrice: number;
      startDate: string;
      endDate?: string;
    }) => {
      const response = await api.put('/daily-deals/special-price', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'special-price'] });
      toast.success('Special price set successfully');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

export function useRemoveSpecialPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productsId: number) => {
      const response = await api.delete(`/daily-deals/special-price/${productsId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'special-price'] });
      toast.success('Special price removed');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

// ---------- Ignore Product Hooks ----------

export function useIgnoreProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productsId: number) => {
      const response = await api.post('/daily-deals/ignored-products', { productsId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      toast.success('Product ignored');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}

export function useUnignoreProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productsId: number) => {
      const response = await api.delete(`/daily-deals/ignored-products/${productsId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['daily-deals', 'single-size'] });
      toast.success('Product restored');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });
}
