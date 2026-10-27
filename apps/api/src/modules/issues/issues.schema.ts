import { z } from 'zod';

export const issueIdSchema = z.object({
  id: z.string().min(1),
});

export const listIssueSchema = z.object({
  page: z.coerce.number().int().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(['ISSUED', 'RETURNED']).optional(),
});

export const createIssueSchema = z.object({
  bookId: z.string().min(1),
  studentId: z.string().min(1),
  issueDate: z.coerce.date(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type ListIssueInput = z.infer<typeof listIssueSchema>;
