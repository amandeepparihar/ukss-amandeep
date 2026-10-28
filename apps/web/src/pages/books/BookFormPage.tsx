import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookOpen, X } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Form, TextField } from '@/components/forms';
import { UploadImageButton } from '@/components/file-upload/UploadImageButton';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import {
  useBook,
  useCreateBook,
  useUpdateBook,
  uploadBookCover,
  type BookPayload,
} from './useBooks';

// same rules as the api's createBookSchema, so errors show before submitting
// quantity is kept as a string in the form (that is what the input returns) and converted on submit
const bookFormSchema = z.object({
  bookName: z.string().trim().min(1, 'Book name is required').max(100, 'Max 100 characters'),
  authorName: z.string().trim().min(1, 'Author name is required').max(100, 'Max 100 characters'),
  isbn: z
    .string()
    .trim()
    .regex(/^[0-9]{10}([0-9]{3})?$/, 'ISBN must be 10 or 13 digits'),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Quantity must be a whole number')
    .refine((value) => Number(value) >= 1, 'Quantity must be at least 1'),
});

type BookFormValues = z.infer<typeof bookFormSchema>;

const FORM_FIELDS = new Set<string>(['bookName', 'authorName', 'isbn', 'quantity']);

export function BookFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { success, error: errorNotify } = useNotifications();

  const { data: book, isLoading: isBookLoading } = useBook(id);
  const createBookMutation = useCreateBook();
  const updateBookMutation = useUpdateBook();

  // undefined = cover untouched, string = new storage key, null = removed
  const [coverKey, setCoverKey] = useState<string | null | undefined>(undefined);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const form = useForm<BookFormValues>({
    resolver: zodResolver(bookFormSchema),
    defaultValues: {
      bookName: '',
      authorName: '',
      isbn: '',
      quantity: '1',
    },
  });

  // populate the form once the book is loaded (edit mode)
  useEffect(() => {
    if (isEdit && book) {
      form.reset({
        bookName: book.bookName,
        authorName: book.authorName,
        isbn: book.isbn,
        quantity: String(book.quantity),
      });
      setCoverPreview(book.coverUrl);
    }
  }, [isEdit, book, form]);

  const handleRemoveCover = () => {
    setCoverKey(null);
    setCoverPreview(null);
  };

  const onSubmit = async (values: BookFormValues) => {
    const payload: BookPayload = {
      bookName: values.bookName.trim(),
      authorName: values.authorName.trim(),
      isbn: values.isbn.trim(),
      quantity: Number(values.quantity),
    };

    // only send the cover when it changed, so an untouched cover is kept
    if (coverKey !== undefined) {
      payload.bookCover = coverKey;
    }

    try {
      if (isEdit && id) {
        await updateBookMutation.mutateAsync({ id, data: payload });
        success('Book updated successfully');
      } else {
        await createBookMutation.mutateAsync(payload);
        success('Book created successfully');
      }
      navigate('/books');
    } catch (err) {
      const apiError = getApiError(err);

      // duplicate isbn belongs on the field, not in a toast
      if (apiError.code === 'CONFLICT') {
        form.setError('isbn', { message: apiError.message }, { shouldFocus: true });
        return;
      }

      // server-side validation errors belong on their fields
      if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
        const seen = new Set<string>();

        for (const detail of apiError.details) {
          if (!detail.field || !FORM_FIELDS.has(detail.field) || seen.has(detail.field)) continue;
          seen.add(detail.field);
          form.setError(
            detail.field as keyof BookFormValues,
            { message: detail.message },
            { shouldFocus: seen.size === 1 }
          );
        }

        if (seen.size > 0) return;
      }

      errorNotify(apiError.message);
    }
  };

  const isSubmitting = createBookMutation.isPending || updateBookMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? 'Edit Book' : 'Add New Book'}
        description={isEdit ? 'Update book details' : 'Add a book to the library'}
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Books', href: '/books' },
          { label: isEdit ? 'Edit Book' : 'New Book' },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate('/books')}>
            Back to List
          </Button>
        }
      />

      <Card className="max-w-full mx-auto">
        <CardHeader>
          <h2 className="text-xl font-semibold">Book Details</h2>
          <p className="text-sm text-muted-foreground">
            {isEdit ? 'Update the book and its cover.' : 'Enter the book details and add a cover.'}
          </p>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  name="bookName"
                  label="Book Name"
                  placeholder="e.g. The Story of Time"
                  required
                  disabled={isBookLoading}
                />
                <TextField
                  name="authorName"
                  label="Author Name"
                  placeholder="e.g. Neeta Berry"
                  required
                  disabled={isBookLoading}
                />
                <TextField
                  name="isbn"
                  label="ISBN"
                  placeholder="10 or 13 digits"
                  required
                  disabled={isBookLoading}
                />
                <TextField
                  name="quantity"
                  label="Quantity"
                  type="number"
                  placeholder="e.g. 5"
                  required
                  disabled={isBookLoading}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Cover Image</p>
                <div className="flex items-center gap-4">
                  {coverPreview ? (
                    <img
                      src={coverPreview}
                      alt="Book cover"
                      className="h-32 w-24 rounded object-cover border"
                    />
                  ) : (
                    <div className="flex h-32 w-24 items-center justify-center rounded border bg-muted">
                      <BookOpen className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <UploadImageButton
                      label={coverPreview ? 'Change Cover' : 'Upload Cover'}
                      disabled={isBookLoading || isSubmitting}
                      onUpload={uploadBookCover}
                      onComplete={(result) => {
                        setCoverKey(result.storageKey);
                        setCoverPreview(result.previewUrl);
                      }}
                      onError={errorNotify}
                    />
                    {coverPreview && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveCover}
                        disabled={isSubmitting}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG, WEBP or GIF, up to 5MB.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 border-t pt-6">
              <Button type="button" variant="outline" onClick={() => navigate('/books')}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isBookLoading}>
                {isEdit ? 'Update Book' : 'Create Book'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
