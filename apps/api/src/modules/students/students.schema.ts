import { z } from 'zod';

const lettersOnly = /^[A-Za-z][A-Za-z\s'.-]*$/;

export const studentIdSchema = z.object({
  id: z.string().min(1),
});

export const createStudentSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(lettersOnly, 'name must contain letters only'),
  rollNo: z
    .string()
    .trim()
    .regex(/^[0-9]{1,20}$/, 'rollNo must contain digits only'),
  phoneNo: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, 'phoneNo must be a 10 digit number'),
  country: z.string().trim().min(1).max(50).regex(lettersOnly, 'country must contain letters only'),
  state: z.string().trim().min(1).max(50).regex(lettersOnly, 'state must contain letters only'),
  city: z.string().trim().min(1).max(50).regex(lettersOnly, 'city must contain letters only'),
  photoFile: z.string().min(1).optional(),
});

export const updateStudentSchema = createStudentSchema.extend({
  photoFile: z.string().min(1).nullable().optional(),
});

export const listStudentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  sortBy: z.enum(['name', 'rollNo', 'city', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListStudentsQuery = z.infer<typeof listStudentsQuery>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
