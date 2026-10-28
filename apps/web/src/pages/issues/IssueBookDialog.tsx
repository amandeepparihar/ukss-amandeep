import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, ComboboxField } from '@/components/forms';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import { useCreateIssue, fetchBookOptions, fetchStudentOptions } from './useIssues';

const issueFormSchema = z.object({
  bookId: z.string().min(1, 'Select a book'),
  studentId: z.string().min(1, 'Select a student'),
});

type IssueFormValues = z.infer<typeof issueFormSchema>;

interface IssueBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueBookDialog({ open, onOpenChange }: IssueBookDialogProps) {
  const { success, error: errorNotify } = useNotifications();
  const createIssueMutation = useCreateIssue();

  const form = useForm<IssueFormValues>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: { bookId: '', studentId: '' },
  });

  // clear the form when the dialog closes, so it opens fresh next time
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset({ bookId: '', studentId: '' });
    }
    onOpenChange(isOpen);
  };

  const onSubmit = async (values: IssueFormValues) => {
    try {
      await createIssueMutation.mutateAsync(values);
      success('Book issued successfully');
      handleOpenChange(false);
    } catch (err) {
      const apiError = getApiError(err);

      if (apiError.code === 'CONFLICT') {
        form.setError('bookId', { message: apiError.message });
        return;
      }

      errorNotify(apiError.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Book</DialogTitle>
          <DialogDescription>
            Pick a book and a student. The issue date is set to today.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ComboboxField
              name="bookId"
              label="Book"
              placeholder="Select a book"
              searchPlaceholder="Search by book name..."
              emptyMessage="No books found."
              required
              fetchOptions={fetchBookOptions}
            />

            <ComboboxField
              name="studentId"
              label="Student"
              placeholder="Select a student"
              searchPlaceholder="Search by name or roll no..."
              emptyMessage="No students found."
              required
              fetchOptions={fetchStudentOptions}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createIssueMutation.isPending}>
                Issue Book
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
