import { Issue, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CreateIssueInput, ListIssueInput } from './issues.schema';
import { ConflictError, NotFoundError } from '../../lib/errors';

export type PaginatedIssue = {
  data: Issue[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

//get all issues
export async function listIssues(query: ListIssueInput): Promise<PaginatedIssue> {
  const where = query.status ? { status: query.status } : {};
  const [total, data] = await Promise.all([
    prisma.issue.count({ where }),
    prisma.issue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { book: true, student: true },
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

//return a book
export async function returnIssue(id: string): Promise<Issue> {
  const issue = await prisma.issue.findUnique({
    where: { id: id },
  });

  if (!issue) {
    throw new NotFoundError('Issue not found');
  }

  if (issue.status === 'RETURNED') {
    throw new ConflictError('Book is already returned');
  }

  return await prisma.issue.update({
    where: { id: id },
    data: {
      status: 'RETURNED',
      returnDate: new Date(),
    },
    include: { book: true, student: true },
  });
}

//create issue
export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  //book must exists
  const book = await prisma.book.findUnique({
    where: { id: input.bookId },
  });
  if (!book) {
    throw new NotFoundError('Book does not exists');
  }

  //student must exists
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
  });
  if (!student) {
    throw new NotFoundError('Student does not exists');
  }

  //book must not already issued
  const bookIssued = await prisma.issue.findFirst({
    where: { bookId: input.bookId, status: 'ISSUED' },
  });
  if (bookIssued) {
    throw new NotFoundError('Book is already Issued');
  }

  return await prisma.issue.create({
    data: {
      bookId: input.bookId,
      studentId: input.studentId,
      issueDate: input.issueDate,
    },
    include: { book: true, student: true },
  });
}
