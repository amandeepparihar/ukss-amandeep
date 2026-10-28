import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CreateIssueInput, ListIssueInput } from './issues.schema';
import { ConflictError, NotFoundError } from '../../lib/errors';

const withBookAndStudent = { book: true, student: true } satisfies Prisma.IssueInclude;

export type IssueWithRelations = Prisma.IssueGetPayload<{ include: typeof withBookAndStudent }>;

export type PaginatedIssue = {
  data: IssueWithRelations[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

//get all issues
export async function listIssues(query: ListIssueInput): Promise<PaginatedIssue> {
  const where: Prisma.IssueWhereInput = {
    status: query.status,
    bookId: query.bookId,
    studentId: query.studentId,
  };

  const [total, data] = await Promise.all([
    prisma.issue.count({ where }),
    prisma.issue.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: withBookAndStudent,
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

//issue a book
export async function createIssue(input: CreateIssueInput): Promise<IssueWithRelations> {
  const student = await prisma.student.findUnique({ where: { id: input.studentId } });

  if (!student) {
    throw new NotFoundError('Student');
  }

  return prisma.$transaction(async (tx) => {
    const taken = await tx.book.updateMany({
      where: { id: input.bookId, quantity: { gt: 0 } },
      data: { quantity: { decrement: 1 } },
    });

    if (taken.count === 0) {
      const book = await tx.book.findUnique({ where: { id: input.bookId } });
      if (!book) {
        throw new NotFoundError('Book');
      }
      throw new ConflictError('No copies of this book are available');
    }

    return tx.issue.create({
      data: {
        bookId: input.bookId,
        studentId: input.studentId,
        issueDate: new Date(), //book can only be issued today
      },
      include: withBookAndStudent,
    });
  });
}

//return a book
export async function returnIssue(id: string): Promise<IssueWithRelations> {
  return prisma.$transaction(async (tx) => {
    const returned = await tx.issue.updateMany({
      where: { id: id, status: 'ISSUED' },
      data: { status: 'RETURNED', returnDate: new Date() },
    });

    if (returned.count === 0) {
      const issue = await tx.issue.findUnique({ where: { id: id } });
      if (!issue) {
        throw new NotFoundError('Issue');
      }
      throw new ConflictError('Book is already returned');
    }

    // only the bookId is needed to put the copy back
    const { bookId } = await tx.issue.findUniqueOrThrow({
      where: { id: id },
      select: { bookId: true },
    });

    await tx.book.update({
      where: { id: bookId },
      data: { quantity: { increment: 1 } },
    });

    return tx.issue.findUniqueOrThrow({
      where: { id: id },
      include: withBookAndStudent,
    });
  });
}
