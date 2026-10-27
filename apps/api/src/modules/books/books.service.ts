import type { Book, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { storageProvider } from '../../lib/storage';
import { createBookSchema, ExportBooksQuery, listBooksQuery } from './books.schema';
import { z } from 'zod';
import path from 'node:path';
import Papa from 'papaparse';

export type CreateBookInput = Pick<Book, 'bookName' | 'authorName' | 'isbn' | 'quantity'>;
export type UpdateBookInput = Partial<CreateBookInput>;

export type BulkUploadResult = {
  created: number;
  failed: { row: number; errors: string[] }[];
};

export type PaginatedBooks = {
  data: Book[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

//get all books
export async function listBooks(query: z.infer<typeof listBooksQuery>): Promise<PaginatedBooks> {
  const where: Prisma.BookWhereInput = query.search
    ? {
        bookName: { contains: query.search, mode: 'insensitive' },
      }
    : {};

  const [total, data] = await Promise.all([
    prisma.book.count({ where }),
    prisma.book.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize) || 1,
    },
  };
}

//get book by id
export async function getBook(id: string): Promise<Book | null> {
  const book = await prisma.book.findUnique({
    where: { id: id },
  })

  if(!book) {
    throw new NotFoundError("Book not found")
  }
  return book;
}

//create book
export async function createBook(inputBook: CreateBookInput, coverKey?: string): Promise<Book> {
  const existedBook = await prisma.book.findUnique({
    where: { isbn: inputBook.isbn },
  });

  if (existedBook) {
    throw new ConflictError('isbn already exists');
  }

  return await prisma.book.create({
    data: { ...inputBook, bookCover: coverKey },
  });
}

//update book
export async function updateBook(
  id: string,
  input: UpdateBookInput,
  coverKey?: string
): Promise<Book> {
  const existingBook = await prisma.book.findUnique({ where: { id: id } });
  if (!existingBook) {
    throw new NotFoundError('Book');
  }

  const book = await prisma.book.update({
    where: { id: id },
    data: { ...input, bookCover: coverKey },
  });

  // new cover saved, so the old one is no longer referenced
  if (coverKey && existingBook.bookCover) {
    await storageProvider.delete(existingBook.bookCover);
  }

  return book;
}

//delete book
export async function deleteBook(id: string): Promise<void> {
  const existingBook = await prisma.book.findUnique({ where: { id: id } });
  if (!existingBook) {
    throw new NotFoundError('Book');
  }

  const activeIssue = await prisma.issue.findFirst({
    where: { bookId: id, status: 'ISSUED' },
  });
  if (activeIssue) {
    throw new ConflictError('Book is currently issued and cannot be deleted');
  }

  // onDelete: Cascade removes this book's issue history
  await prisma.book.delete({ where: { id: id } });

  if (existingBook.bookCover) {
    await storageProvider.delete(existingBook.bookCover);
  }
}

//get book cover
export async function getBookCover(id: string): Promise<{ content: Buffer; fileName: string }> {
  const book = await getBook(id);

  if (!book?.bookCover) {
    throw new NotFoundError('Book cover');
  }

  if (!(await storageProvider.exists(book.bookCover))) {
    throw new NotFoundError('Book cover');
  }

  const content = await storageProvider.getContent(book.bookCover);

  //replace everything using regex which is not char, number,
  const safeName = book.bookName.replace(/[^\w.-]/g, '_');

  return {
    content,
    fileName: `${safeName}${path.extname(book.bookCover)}`,
  };
}

//get books for export which matching the search
export async function findBooksForExport(query: ExportBooksQuery): Promise<Book[]> {
  const where: Prisma.BookWhereInput = query.search
    ? { bookName: { contains: query.search, mode: 'insensitive' } }
    : {};

  return await prisma.book.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

//create bulk books
export async function createBulkBooks(csvText: string): Promise<BulkUploadResult> {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  const failed: BulkUploadResult['failed'] = [];
  const valid: CreateBookInput[] = [];

  parsed.data.forEach((raw, i) => {
    const result = createBookSchema.safeParse(raw);
    if (!result.success) {
      failed.push({
        row: i + 2,
        errors: result.error.issues.map((iss) => iss.message),
      });
    } else {
      valid.push(result.data);
    }
  });

  const created = await prisma.book.createMany({
    data: valid,
    skipDuplicates: true,
  });

  return { created: created.count, failed };
}
