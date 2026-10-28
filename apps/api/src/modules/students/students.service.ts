import { Prisma, type Student } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors';
import { storageProvider, getStorageProviderType } from '../../lib/storage';
import { config } from '../../config';
import type { ListStudentsQuery, CreateStudentInput, UpdateStudentInput } from './students.schema';

export type StudentWithPhoto = Student & { photoUrl: string | null };

export type PaginatedStudents = {
  data: StudentWithPhoto[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

//add the public url of the photo to a student
function withPhotoUrl(student: Student): StudentWithPhoto {
  //if there is no photoFile return student data without photo
  if (!student.photoFile) {
    return { ...student, photoUrl: null };
  }

  //e.g. http://localhost:3000/api/uploads/deep.jpg if(local)
  const photoUrl =
    getStorageProviderType() === 'local'
      ? `${config.API_URL}/api${config.STORAGE_LOCAL_URL_PREFIX}/${student.photoFile}`
      : storageProvider.getPublicUrl(student.photoFile);

  //there is photo return student with photo
  return { ...student, photoUrl };
}

//the photo must be an image uploaded through post /api/files/upload
async function assertPhotoFile(storageKey: string): Promise<void> {
  //now if the image is upload through api/files/upload then the file table has the storagekey as photoFile(string)
  //its status must be COMPLETED it means its uploaded
  const file = await prisma.file.findFirst({
    where: { storageKey: storageKey, status: 'COMPLETED' },
  });

  //image is not found
  if (!file) {
    throw new BadRequestError('Photo not found, upload it again');
  }
  if (!file.mimeType.startsWith('image/')) {
    throw new BadRequestError('Photo must be an image');
  }
}

//delete the stored image and mark its File record deleted
async function removePhotoFile(storageKey: string): Promise<void> {
  await storageProvider.delete(storageKey);
  //find the image on the basis of storageKey in file table and mark its status as DELETED
  await prisma.file.updateMany({
    where: { storageKey: storageKey },
    data: { status: 'DELETED' },
  });
}

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
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: data.map(withPhotoUrl),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize) || 1,
    },
  };
}

//get student by id
export async function getStudent(id: string): Promise<StudentWithPhoto> {
  const student = await prisma.student.findUnique({ where: { id: id } });

  if (!student) {
    throw new NotFoundError('Student');
  }

  return withPhotoUrl(student);
}

//create student
export async function createStudent(input: CreateStudentInput): Promise<StudentWithPhoto> {
  const existingStudent = await prisma.student.findUnique({ where: { rollNo: input.rollNo } });

  if (existingStudent) {
    throw new ConflictError(`Student with rollNo: ${input.rollNo} already exists`);
  }

  //if there is photoFile add it in the file table with storage key and status: COMPLETED
  if (input.photoFile) {
    await assertPhotoFile(input.photoFile);
  }

  const student = await prisma.student.create({ data: input });

  //if there is photoFile we got student with photo else without photo
  return withPhotoUrl(student);
}

//update student
export async function updateStudent(
  id: string,
  input: UpdateStudentInput
): Promise<StudentWithPhoto> {
  const existingStudent = await prisma.student.findUnique({ where: { id: id } });

  if (!existingStudent) {
    throw new NotFoundError('Student');
  }

  //the new rollNo must not belong to some other student
  if (input.rollNo !== existingStudent.rollNo) {
    const rollNoTaken = await prisma.student.findUnique({ where: { rollNo: input.rollNo } });

    if (rollNoTaken) {
      throw new ConflictError(`rollNo: ${input.rollNo} is already taken`);
    }
  }

  //got a photo
  const photoChanged = input.photoFile !== undefined;

  //add the photoFile in the file table
  if (photoChanged && input.photoFile) {
    await assertPhotoFile(input.photoFile);
  }

  //update the studnet
  const student = await prisma.student.update({
    where: { id: id },
    data: input,
  });

  //old image removeit
  if (photoChanged && existingStudent.photoFile) {
    await removePhotoFile(existingStudent.photoFile);
  }

  return withPhotoUrl(student);
}

//delete student
export async function deleteStudent(id: string): Promise<void> {
  const existingStudent = await prisma.student.findUnique({ where: { id: id } });

  if (!existingStudent) {
    throw new NotFoundError('Student');
  }

  //student must not have issued book
  const activeIssue = await prisma.issue.findFirst({
    where: { studentId: id, status: 'ISSUED' },
  });
  if (activeIssue) {
    throw new ConflictError('Student has a book issued and cannot be deleted');
  }

  await prisma.student.delete({ where: { id: id } });

  //if it does have photoFile remove it from the storage and mark the status DELETED in file
  if (existingStudent.photoFile) {
    await removePhotoFile(existingStudent.photoFile);
  }
}
