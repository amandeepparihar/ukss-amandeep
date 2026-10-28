import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { downloadBlobExport } from '@/lib/download';

export interface Book {
  id: string;
  bookName: string;
  authorName: string;
  isbn: string;
  quantity: number;
  bookCover: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BooksApiResponse {
  data: Book[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface BookPayload {
  bookName: string;
  authorName: string;
  isbn: string;
  quantity: number;
  bookCover?: string | null;
}

export interface BookListParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
}

export interface BulkUploadResult {
  created: number;
  failed: { row: number; errors: string[] }[];
}

export type BookExportFormat = 'csv' | 'xlsx' | 'pdf';

const multipartHeaders = { headers: { 'Content-Type': 'multipart/form-data' } };

export function useBooksList(params: BookListParams) {
  return useQuery<BooksApiResponse>({
    queryKey: ['books', params],
    queryFn: async () => {
      const response = await api.get('/books', { params });
      return response.data;
    },
  });
}

export function useBook(id?: string) {
  return useQuery<Book>({
    queryKey: ['books', id],
    queryFn: async () => {
      const response = await api.get(`/books/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BookPayload) => {
      const response = await api.post('/books', data);
      return response.data.data as Book;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
}

export function useUpdateBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: BookPayload }) => {
      const response = await api.put(`/books/${id}`, data);
      return response.data.data as Book;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
}

export function useDeleteBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/books/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
}

export function useBulkUploadBooks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);

      const response = await api.post('/books/bulk', form, multipartHeaders);
      return response.data.data as BulkUploadResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
}

export async function uploadBookCover(
  file: File
): Promise<{ storageKey: string; previewUrl: string }> {
  const form = new FormData();
  form.append('folder', 'books');
  form.append('file', file);

  const response = await api.post('/files/upload', form, multipartHeaders);

  return {
    storageKey: response.data.data.storageKey,
    previewUrl: URL.createObjectURL(file),
  };
}

export async function exportBooks(params: { search?: string }, format: BookExportFormat) {
  const query = new URLSearchParams({ format });

  if (params.search) query.set('search', params.search);

  await downloadBlobExport(`/books/export?${query.toString()}`, `books.${format}`);
}

export function downloadBulkTemplate() {
  const csv = 'bookName,authorName,isbn,quantity\nThe Alchemist,Paulo Coelho,9780062315007,5\n';
  const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = 'books-template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
