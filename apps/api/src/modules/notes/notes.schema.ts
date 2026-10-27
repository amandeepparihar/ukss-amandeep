import { z } from 'zod';

export const createNoteSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 chars'),
  content: z.string().min(1, 'Content is required'),
  isPublic: z.boolean().default(false),
});

export type CreateNoteInput  = z.infer<typeof createNoteSchema>;
