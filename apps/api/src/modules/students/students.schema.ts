import { z } from 'zod';

export const studentIdSchema = z.object({
  id: z.string().min(1),
});

export const createStudentSchema = z.object({
  name: z.string().min(1).max(100),
  rollNo: z.string().trim().min(1).max(20),
  phoneNo: z
    .string()
    .trim()
    .min(7)
    .max(15)
    .regex(/^[0-9+]+$/, 'phoneNo must contain only digits and +'),
  country: z.string().trim().min(1).max(50),
  state: z.string().trim().min(1).max(50),
  city: z.string().trim().min(1).max(50),
});

export const updateStudentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rollNo: z.string().trim().min(1).max(20),
  phoneNo: z
    .string()
    .trim()
    .min(7)
    .max(15)
    .regex(/^[0-9+]+$/, 'phoneNo must contain only digits and +'),
  country: z.string().trim().min(1).max(60),
  state: z.string().trim().min(1).max(60),
  city: z.string().trim().min(1).max(60),
});

export const listStudentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
});

export type ListStudentsQuery = z.infer<typeof listStudentsQuery>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
