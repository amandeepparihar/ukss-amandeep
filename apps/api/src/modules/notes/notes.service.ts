import { prisma } from '../../lib/prisma';
import type { CreateNoteInput } from './notes.schema';

export class NotesService {
  async findAll() {
    return prisma.note.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateNoteInput) {
    return prisma.note.create({ data });
  }
}
