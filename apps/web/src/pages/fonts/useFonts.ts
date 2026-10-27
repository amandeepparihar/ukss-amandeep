import {
  useQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';

import { api } from '@/lib/api';

import { useNotifications } from '@/hooks/useNotifications';

import { useNavigate } from 'react-router-dom';

import { FontApiResponse } from './Fonts';

export interface FontPayload {
  fontName: string;
  fontDescription?: string;
  textCase: string;
  fontStyle: string;
  fontZipFile?: File | null;
}

export function useFonts(params: Record<string, unknown>) {
  return useQuery<FontApiResponse>({
    queryKey: ['fonts', params],
    queryFn: async () => {
      const response = await api.get('/fonts', { params });
      return response.data;
    },
  });
}

export function useFontById(id: string | number) {

  return useQuery({
    queryKey: ['fonts', id],
    queryFn: async () => {
      const response =
        await api.get(`/fonts/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateFont() {
  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const { success, error: errorNotify } = useNotifications();

  return useMutation({
    mutationFn: async (data: FormData) => {
      // 1. ADD 'return' here so errors propagate
      return api.post('/fonts', data, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
      success('Font created successfully');
      navigate('/fonts');
    },

    onError: (error: any) => {
      const errorData = error?.response?.data?.error;

      let message = errorData?.message || 'Something went wrong';

      if (message == "Validation failed") {
        message = errorData?.details[0].message;
      }
      errorNotify(message);
      console.error(error);
    },
  });
}

export function useUpdateFont() {

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { success, error: errorNotify } = useNotifications();

  return useMutation({

    mutationFn: async ({ id, data }: { id: number; data: FormData; }) => {

      const response = await api.put(`/fonts/${id}`, data, {
        headers: {
          'Content-Type':
            'multipart/form-data',
        },
      }
      );
      return response.data;
    },

    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
      queryClient.invalidateQueries({ queryKey: ['fonts', variables.id] });
      success('Font updated successfully');
      setTimeout(() => {
        navigate('/fonts');
      }, 500);

    },

    onError: (error: any) => {
      const errorData = error?.response?.data?.error;

      let message = errorData?.message || 'Something went wrong';

      if (message == "Validation failed") {
        message = errorData?.details[0].message;
      }

      errorNotify(message);
      console.error(error);
    },
  });
}

export function useDeleteFont() {

  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const { success, error: errorNotify } = useNotifications();

  return useMutation({
    mutationFn: async (id: number) => {
      return await api.delete(`/fonts/${id}`);
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
      success('Font deleted successfully');
      navigate('/fonts');
    },

    onError: (error) => {
      errorNotify('Failed to delete font');
      console.error(error);
    },
  });
}