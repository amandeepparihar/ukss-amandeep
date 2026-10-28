import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface Student {
  id: string;
  name: string;
  rollNo: string;
  phoneNo: string;
  country: string;
  state: string;
  city: string;
  photoFile: string | null;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentsApiResponse {
  data: Student[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface StudentPayload {
  name: string;
  rollNo: string;
  phoneNo: string;
  country: string;
  state: string;
  city: string;
  photoFile?: string | null;
}

export interface StudentListParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
}

//for fileupload
const multipartHeaders = { headers: { 'Content-Type': 'multipart/form-data' } };

export function useStudentsList(params: StudentListParams) {
  return useQuery<StudentsApiResponse>({
    queryKey: ['students', params],
    queryFn: async () => {
      const response = await api.get('/students', { params });
      return response.data;
    },
  });
}

export function useStudent(id?: string) {
  return useQuery<Student>({
    queryKey: ['students', id],
    queryFn: async () => {
      const response = await api.get(`/students/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: StudentPayload) => {
      const response = await api.post('/students', data);
      return response.data.data as Student;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export function useUpdateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: StudentPayload }) => {
      const response = await api.put(`/students/${id}`, data);
      return response.data.data as Student;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export function useDeleteStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/students/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export async function uploadStudentPhoto(file: File): Promise<{ storageKey: string; previewUrl: string }> {
  const form = new FormData();
  form.append('folder', 'students');
  form.append('file', file);

  const response = await api.post('/files/upload', form, multipartHeaders);

  return {
    storageKey: response.data.data.storageKey,
    previewUrl: URL.createObjectURL(file),
  };
}
