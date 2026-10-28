import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BookReportRow {
  id: string;
  bookName: string;
  quantity: number;
  issuedCount: number;
  lateCount: number;
}

export interface BookReportResponse {
  data: BookReportRow[];
  meta: PaginationMeta;
}

export interface BookReportParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
}

export interface BookIssueStudent {
  id: string;
  issueDate: string;
  studentId: string;
  name: string;
  rollNo: string;
}

export type BookStudentsKind = 'issued' | 'late';

export interface BookDateReportRow {
  bookId: string;
  bookName: string;
  totalIssuedCount: number;
  totalReturnedCount: number;
}

export interface BookDateReportResponse {
  data: BookDateReportRow[];
  meta: PaginationMeta;
}

export interface BookDateReportParams {
  dateOne: string;
  dateTwo: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function useBookReport(params: BookReportParams) {
  return useQuery<BookReportResponse>({
    queryKey: ['reports', 'books', params],
    queryFn: async () => {
      const response = await api.get('/books/report', { params });
      return response.data;
    },
  });
}

export function useBookStudents(bookId: string | undefined, kind: BookStudentsKind) {
  return useQuery<BookIssueStudent[]>({
    queryKey: ['reports', 'book-students', bookId, kind],
    queryFn: async () => {
      const path = kind === 'issued' ? 'issued-students' : 'late-students';
      const response = await api.get(`/books/${bookId}/${path}`);
      return response.data.data;
    },
    enabled: !!bookId,
  });
}

export function useBookDateReport(params: BookDateReportParams) {
  return useQuery<BookDateReportResponse>({
    queryKey: ['reports', 'date', params],
    queryFn: async () => {
      const response = await api.get('/books/date-report', { params });
      return response.data;
    },
  });
}
