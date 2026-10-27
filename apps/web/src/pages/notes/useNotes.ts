import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Note {
  id: string;
  title: string;
  content: string;
  isPublic: boolean;
}

export type NotePayload = Omit<Note, 'id'>;

export function useNotesList() {
  return useQuery<Note[]>({
    queryKey: ['notes'],
    queryFn: async () => {
      const response = await api.get('/notes');
      return response.data.data;
    },
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: NotePayload) => {
      const response = await api.post('/notes', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}
