import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ComboboxOption } from '@/components/forms';

export type IssueStatus = 'ISSUED' | 'RETURNED';

export interface Issue {
  id: string;
  bookId: string;
  studentId: string;
  issueDate: string;
  returnDate: string | null;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  book: { id: string; bookName: string; authorName: string; isbn: string; quantity: number };
  student: { id: string; name: string; rollNo: string };
}

export interface IssuesApiResponse {
  data: Issue[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface IssueListParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  status?: IssueStatus;
}

export interface IssuePayload {
  bookId: string;
  studentId: string;
}

export function useIssuesList(params: IssueListParams) {
  return useQuery<IssuesApiResponse>({
    queryKey: ['issues', params],
    queryFn: async () => {
      const response = await api.get('/issues', { params });
      return response.data;
    },
  });
}

export function useCreateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: IssuePayload) => {
      const response = await api.post('/issues', data);
      return response.data.data as Issue;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useReturnIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/issues/${id}/return`);
      return response.data.data as Issue;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

//dropdown
export async function fetchBookOptions(search: string): Promise<ComboboxOption[]> {
  const response = await api.get('/books', {
    params: { search: search || undefined, pageSize: 20, sortBy: 'bookName', sortOrder: 'asc' },
  });

  return response.data.data.map((book: { id: string; bookName: string; quantity: number }) => ({
    value: book.id,
    label: `${book.bookName} (${book.quantity} left)`,
    // no copies left: show it, but it can't be picked
    disabled: book.quantity <= 0,
  }));
}

//dropdown
export async function fetchStudentOptions(search: string): Promise<ComboboxOption[]> {
  const response = await api.get('/students', {
    params: { search: search || undefined, pageSize: 20, sortBy: 'name', sortOrder: 'asc' },
  });

  return response.data.data.map((student: { id: string; name: string; rollNo: string }) => ({
    value: student.id,
    label: `${student.name} (Roll ${student.rollNo})`,
  }));
}
