import { Prisma, type Book } from '@prisma/client';
import { z } from 'zod';
import path from 'node:path';
import Papa from 'papaparse';
import { prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError, BadRequestError } from '../../lib/errors';
import { storageProvider, getStorageProviderType } from '../../lib/storage';
import { config } from '../../config';
import {
  createBookSchema,
  updateBookSchema,
  bulkBookRowSchema,
  listBooksQuery,
  type ExportBooksQuery,
  type BookReportQuery,
  type BookDateReportQuery,
} from './books.schema';

export type CreateBookInput = z.infer<typeof createBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type ListBooksQuery = z.infer<typeof listBooksQuery>;

export type BookWithCover = Book & { coverUrl: string | null };

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PaginatedBooks = {
  data: BookWithCover[];
  meta: PaginationMeta;
};

export type BulkUploadResult = {
  created: number;
  failed: { row: number; errors: string[] }[];
};

export type BookIssueStudent = {
  id: string;
  issueDate: Date;
  studentId: string;
  name: string;
  rollNo: string;
};

export type BookReportRow = {
  id: string;
  bookName: string;
  quantity: number;
  issuedCount: number;
  lateCount: number;
};

export type BookReport = {
  data: BookReportRow[];
  meta: PaginationMeta;
};

export type BookDateReportRow = {
  bookId: string;
  bookName: string;
  totalIssuedCount: number;
  totalReturnedCount: number;
};

export type BookDateReport = {
  data: BookDateReportRow[];
  meta: PaginationMeta;
};

const BOOK_REPORT_SORT_COLUMNS: Record<BookReportQuery['sortBy'], string> = {
  bookName: 'b."bookName"',
  quantity: 'b.quantity',
  issuedCount: '"issuedCount"',
  lateCount: '"lateCount"',
};

const DATE_REPORT_SORT_COLUMNS: Record<BookDateReportQuery['sortBy'], string> = {
  bookId: 'i."bookId"',
  bookName: 'b."bookName"',
  totalIssuedCount: '"totalIssuedCount"',
  totalReturnedCount: '"totalReturnedCount"',
};

function toMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

function withCoverUrl(book: Book): BookWithCover {
  //if there is no bookCover return book without cover(null)
  if (!book.bookCover) {
    return { ...book, coverUrl: null };
  }

  //e.g. http://localhost:3000/api/uploads/book.jpg if(local)
  const coverUrl =
    getStorageProviderType() === 'local'
      ? `${config.API_URL}/api${config.STORAGE_LOCAL_URL_PREFIX}/${book.bookCover}`
      : storageProvider.getPublicUrl(book.bookCover);

  return { ...book, coverUrl };
}

//the photo must be an image uploaded through post /api/files/upload
async function assertCoverFile(storageKey: string): Promise<void> {
  //now if the image is upload through api/files/upload then the file table has the storagekey as photoFile(string)
  //its status must be COMPLETED it means its uploaded
  const file = await prisma.file.findFirst({
    where: { storageKey: storageKey, status: 'COMPLETED' },
  });

  //image not found
  if (!file) {
    throw new BadRequestError('Cover image not found, upload it again');
  }
  if (!file.mimeType.startsWith('image/')) {
    throw new BadRequestError('Cover must be an image');
  }
}

//delete the stored image and mark its File record deleted
async function removeCoverFile(storageKey: string): Promise<void> {
  await storageProvider.delete(storageKey);
  //find the image on the basis of storageKey in file table and mark its status as DELETED
  await prisma.file.updateMany({
    where: { storageKey: storageKey },
    data: { status: 'DELETED' },
  });
}

//get all books
export async function listBooks(query: ListBooksQuery): Promise<PaginatedBooks> {
  const where: Prisma.BookWhereInput = query.search
    ? {
        bookName: { contains: query.search, mode: 'insensitive' },
      }
    : {};

  const [total, data] = await Promise.all([
    prisma.book.count({ where }),
    prisma.book.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: data.map(withCoverUrl),
    meta: toMeta(query.page, query.pageSize, total),
  };
}

//get book by id
export async function getBook(id: string): Promise<BookWithCover> {
  const book = await prisma.book.findUnique({
    where: { id: id },
  });

  if (!book) {
    throw new NotFoundError('Book');
  }

  return withCoverUrl(book);
}

//create book
export async function createBook(input: CreateBookInput): Promise<BookWithCover> {
  const existedBook = await prisma.book.findUnique({
    where: { isbn: input.isbn },
  });

  if (existedBook) {
    throw new ConflictError('isbn already exists');
  }

  if (input.bookCover) {
    await assertCoverFile(input.bookCover);
  }

  const book = await prisma.book.create({ data: input });

  return withCoverUrl(book);
}

//update book
export async function updateBook(id: string, input: UpdateBookInput): Promise<BookWithCover> {
  const existingBook = await prisma.book.findUnique({ where: { id: id } });
  if (!existingBook) {
    throw new NotFoundError('Book');
  }

  if (input.isbn && input.isbn !== existingBook.isbn) {
    const isbnTaken = await prisma.book.findUnique({ where: { isbn: input.isbn } });
    if (isbnTaken) {
      throw new ConflictError(`isbn: ${input.isbn} already exists`);
    }
  }

  const coverChanged = input.bookCover !== undefined && input.bookCover !== existingBook.bookCover;

  if (coverChanged && input.bookCover) {
    await assertCoverFile(input.bookCover);
  }

  const book = await prisma.book.update({
    where: { id: id },
    data: input,
  });

  if (coverChanged && existingBook.bookCover) {
    await removeCoverFile(existingBook.bookCover);
  }

  return withCoverUrl(book);
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

  //onDelete
  await prisma.book.delete({ where: { id: id } });

  if (existingBook.bookCover) {
    await removeCoverFile(existingBook.bookCover);
  }
}

//get book cover for download
export async function getBookCover(id: string): Promise<{ content: Buffer; fileName: string }> {
  const book = await getBook(id);

  if (!book.bookCover || !(await storageProvider.exists(book.bookCover))) {
    throw new NotFoundError('Book cover');
  }

  const content = await storageProvider.getContent(book.bookCover);

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

//this book issued students
export async function getStuNameOfIssuedBooks(bookId: string): Promise<BookIssueStudent[]> {
  await getBook(bookId);

  return prisma.$queryRaw<BookIssueStudent[]>`
    SELECT i.id,
           i."issueDate",
           s.id AS "studentId",
           s.name,
           s."rollNo"
      FROM "Issue" i
      JOIN "Student" s ON s.id = i."studentId"
     WHERE i."bookId" = ${bookId}
       AND i.status = 'ISSUED'
     ORDER BY i."issueDate" DESC`;
}

//fine students
export async function getFineStuCountByBookId(bookId: string): Promise<BookIssueStudent[]> {
  await getBook(bookId);

  return prisma.$queryRaw<BookIssueStudent[]>`
    SELECT i.id,
           i."issueDate",
           s.id AS "studentId",
           s.name,
           s."rollNo"
      FROM "Issue" i
      JOIN "Student" s ON s.id = i."studentId"
     WHERE i."bookId" = ${bookId}
       AND i.status = 'ISSUED'
       AND i."issueDate" < NOW() - interval '3 days'
     ORDER BY i."issueDate" ASC`;
}

//books on loan right now: copies out, copies left, and how many loans are late (3+ days)
export async function getBookReport(query: BookReportQuery): Promise<BookReport> {
  const searchFilter = query.search
    ? Prisma.sql`AND b."bookName" ILIKE ${'%' + query.search + '%'}`
    : Prisma.empty;

  const sortColumn = Prisma.raw(BOOK_REPORT_SORT_COLUMNS[query.sortBy]);
  const sortOrder = Prisma.raw(query.sortOrder === 'asc' ? 'ASC' : 'DESC');

  const [data, [{ total }]] = await Promise.all([
    prisma.$queryRaw<BookReportRow[]>`
      SELECT b.id,
             b."bookName",
             b.quantity,
             COUNT(i.id)::int AS "issuedCount",
             (COUNT(i.id) FILTER (WHERE i."issueDate" < NOW() - interval '3 days'))::int AS "lateCount"
        FROM "Book" b
        JOIN "Issue" i ON i."bookId" = b.id AND i.status = 'ISSUED'
       WHERE TRUE ${searchFilter}
       GROUP BY b.id
       ORDER BY ${sortColumn} ${sortOrder}, b.id
       LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,

    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(DISTINCT b.id)::int AS total
        FROM "Book" b
        JOIN "Issue" i ON i."bookId" = b.id AND i.status = 'ISSUED'
       WHERE TRUE ${searchFilter}`,
  ]);

  return {
    data,
    meta: toMeta(query.page, query.pageSize, total),
  };
}

//books issued between two dates, with how many are still out and how many came back
export async function getBookDateReport(query: BookDateReportQuery): Promise<BookDateReport> {
  const sortColumn = Prisma.raw(DATE_REPORT_SORT_COLUMNS[query.sortBy]);
  const sortOrder = Prisma.raw(query.sortOrder === 'asc' ? 'ASC' : 'DESC');

  const [data, [{ total }]] = await Promise.all([
    prisma.$queryRaw<BookDateReportRow[]>`
      SELECT i."bookId",
             b."bookName",
             COUNT(CASE WHEN i.status = 'ISSUED' THEN 1 END)::int AS "totalIssuedCount",
             COUNT(CASE WHEN i.status = 'RETURNED' THEN 1 END)::int AS "totalReturnedCount"
        FROM "Issue" i
        JOIN "Book" b ON b.id = i."bookId"
       WHERE i."issueDate"::date BETWEEN ${query.dateOne}::date AND ${query.dateTwo}::date
       GROUP BY i."bookId", b."bookName", b.id
       ORDER BY ${sortColumn} ${sortOrder}, b.id
       LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,

    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(DISTINCT i."bookId")::int AS total
        FROM "Issue" i
       WHERE i."issueDate"::date BETWEEN ${query.dateOne}::date AND ${query.dateTwo}::date`,
  ]);

  return {
    data,
    meta: toMeta(query.page, query.pageSize, total),
  };
}

//create bulk books from an uploaded csv
export async function createBulkBooks(fileBuffer: Buffer): Promise<BulkUploadResult> {
  const parsed = Papa.parse<Record<string, string>>(fileBuffer.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.data.length === 0) {
    throw new BadRequestError('The CSV file has no rows');
  }

  const failed: BulkUploadResult['failed'] = [];
  const rows: { row: number; data: CreateBookInput }[] = [];
  const isbnsInFile = new Set<string>();

  parsed.data.forEach((raw, i) => {
    // +1 for the header line, +1 because spreadsheet rows start at 1
    const row = i + 2;

    const result = bulkBookRowSchema.safeParse(raw);
    if (!result.success) {
      failed.push({
        row: row,
        errors: result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`),
      });
      return;
    }

    if (isbnsInFile.has(result.data.isbn)) {
      failed.push({
        row: row,
        errors: [`isbn ${result.data.isbn} appears more than once in the file`],
      });
      return;
    }

    isbnsInFile.add(result.data.isbn);
    rows.push({ row: row, data: result.data });
  });

  // isbns that are already in the database
  const existing = await prisma.book.findMany({
    where: { isbn: { in: [...isbnsInFile] } },
    select: { isbn: true },
  });
  const existingIsbns = new Set(existing.map((b) => b.isbn));

  const toCreate = rows.filter(({ row, data }) => {
    if (existingIsbns.has(data.isbn)) {
      failed.push({ row: row, errors: [`isbn ${data.isbn} already exists`] });
      return false;
    }
    return true;
  });

  const created = await prisma.book.createMany({
    data: toCreate.map((r) => r.data),
    skipDuplicates: true,
  });

  failed.sort((a, b) => a.row - b.row);

  return { created: created.count, failed };
}
