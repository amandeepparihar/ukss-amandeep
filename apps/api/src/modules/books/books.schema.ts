import { z } from 'zod';

//also used for blukRowSchema as are both same
export const createBookSchema = z.object({
  bookName: z.string().min(1).max(100),
  authorName: z.string().min(1).max(100),
  isbn: z.string().regex(/^[0-9]{10}([0-9]{3})?$/),
  quantity: z.number().min(1),
});

export const updateBookSchema = createBookSchema.partial();

export const bookIdSchema = z.object({
  id: z.string().min(1),
});

export const listBooksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
});

export const exportBooksQuery = z.object({
  search: z.string().trim().optional(),
});

export type ExportBooksQuery = z.infer<typeof exportBooksQuery>;
