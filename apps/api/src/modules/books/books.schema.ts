import { z } from 'zod';

export const createBookSchema = z.object({
  bookName: z.string().trim().min(1).max(100),
  authorName: z.string().trim().min(1).max(100),
  isbn: z
    .string()
    .trim()
    .regex(/^[0-9]{10}([0-9]{3})?$/, 'isbn must be 10 or 13 digits'),
  quantity: z.coerce.number().int().min(1),
  bookCover: z.string().min(1).optional(),
});

export const updateBookSchema = createBookSchema.partial().extend({
  bookCover: z.string().min(1).nullable().optional(),
});

export const bulkBookRowSchema = createBookSchema.omit({ bookCover: true });

export const bookIdSchema = z.object({
  id: z.string().min(1),
});

export const listBooksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  sortBy: z
    .enum(['bookName', 'authorName', 'isbn', 'quantity', 'createdAt', 'updatedAt'])
    .default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const exportBooksQuery = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  search: z.string().trim().optional(),
});

export const bookReportQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  sortBy: z.enum(['bookName', 'quantity', 'issuedCount', 'lateCount']).default('issuedCount'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-mm-dd');

export const bookDateReportQuery = z
  .object({
    dateOne: dateOnly,
    dateTwo: dateOnly,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    sortBy: z
      .enum(['bookId', 'bookName', 'totalIssuedCount', 'totalReturnedCount'])
      .default('totalIssuedCount'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((d) => d.dateOne <= d.dateTwo, {
    message: 'dateOne must be on or before dateTwo',
    path: ['dateTwo'],
  });

export type ExportBooksQuery = z.infer<typeof exportBooksQuery>;
export type BookReportQuery = z.infer<typeof bookReportQuery>;
export type BookDateReportQuery = z.infer<typeof bookDateReportQuery>;
