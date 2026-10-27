import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Form, TextField, TextareaField, SwitchField } from '@/components/forms';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import { useNotesList, useCreateNote } from './useNotes';

const noteFormSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 chars'),
  content: z.string().min(1, 'Content is required'),
  isPublic: z.boolean(),
});

type NoteFormValues = z.infer<typeof noteFormSchema>;

export function NotesPage() {
  const { success, error: errorNotify } = useNotifications();

  const { data: notes, isLoading, isError } = useNotesList();
  const createNoteMutation = useCreateNote();

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: {
      title: '',
      content: '',
      isPublic: false,
    },
  });

  const onSubmit = async (values: NoteFormValues) => {
    try {
      await createNoteMutation.mutateAsync(values);
      success('Note created successfully');
      form.reset();
    } catch (err) {
      errorNotify(getApiError(err).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Notes" description="Create a note and see it in the list" />

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">New Note</h2>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <TextField name="title" label="Title" placeholder="Enter title" required />

              <TextareaField
                name="content"
                label="Content"
                placeholder="Enter content"
                rows={4}
                required
              />

              <SwitchField name="isPublic" label="Public" />
            </CardContent>

            <CardFooter className="flex justify-end border-t pt-6">
              <Button type="submit" loading={createNoteMutation.isPending}>
                Create Note
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">All Notes</h2>
        </CardHeader>

        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

          {!isLoading && isError && (
            <div className='spacy-y-3 py-2'>
              <p className='text-sm'>
                Failed to load notes
              </p>
            </div>
          )}

          {!isLoading && !isError && !notes?.length && (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}

          {!isLoading && !isError && notes && notes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Visibility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell>{note.title}</TableCell>
                    <TableCell>{note.content}</TableCell>
                    <TableCell>
                      <Badge variant={note.isPublic ? 'success' : 'secondary'}>
                        {note.isPublic ? 'Public' : 'Private'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}