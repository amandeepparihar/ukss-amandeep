import { Student, Prisma } from '@prisma/client';
import { ListStudentsQuery, CreateStudentInput, UpdateStudentInput } from './students.schema';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';

export type PaginatedStudents = {
  data: Student[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

//get all students
export async function listStudents(query: ListStudentsQuery): Promise<PaginatedStudents> {
  const where: Prisma.StudentWhereInput = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { rollNo: { contains: query.search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, data] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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

//get student by id
export async function getStudent(id: string): Promise<Student> {
  const student = await prisma.student.findUnique({ where: { id: id } });

  if (!student) {
    throw new NotFoundError('Student Not found');
  }

  return student;
}

//create student
export async function createStudent(input: CreateStudentInput): Promise<Student> {
  const existingStudent = await prisma.student.findUnique({ where: { rollNo: input.rollNo } });

  if (existingStudent) {
    throw new ConflictError(`Student with rollNo: ${input.rollNo} already exists`);
  }

  return await prisma.student.create({
    data: { ...input },
  });
}

//update student
export async function updateStudent(id: string, input: UpdateStudentInput): Promise<Student> {
  const existingStudent = await prisma.student.findUnique({ where: { id: id } });

  if (!existingStudent) {
    throw new NotFoundError(`Student with id: ${id} not found`);
  }

  //if the new rollNo is already of someother student
  if (input.rollNo !== existingStudent.rollNo) {
    const rollNoTaken = await prisma.student.findUnique({ where: { rollNo: input.rollNo } });

    if (rollNoTaken) {
      throw new ConflictError(`rollNo: ${rollNoTaken} is already taken`);
    }
  }

  const student = await prisma.student.update({
    where: { id },
    data: { ...input },
  });

  return student;
}

//delete student
export async function deleteStudent(id: string): Promise<void> {
  const existingStudent = await prisma.student.findUnique({ where: { id } });

  if (!existingStudent) {
    throw new NotFoundError(`Student with id: ${id} not exists`);
  }

  await prisma.student.delete({ where: { id } });
}

//get student photo file for download
