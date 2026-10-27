import { z } from 'zod';

/** Pino numeric level floor per UI level selector. */
export const LEVEL_FLOOR: Record<string, number> = {
  all: 0,
  info: 30,
  warn: 40,
  error: 50,
};

export const logQuerySchema = z.object({
  level: z.enum(['all', 'info', 'warn', 'error']).default('all'),
  q: z.string().trim().max(200).optional(),
  executionId: z.string().trim().max(100).optional(),
  from: z.coerce.number().int().nonnegative().optional(), // epoch ms
  to: z.coerce.number().int().nonnegative().optional(),   // epoch ms
  cursor: z.coerce.number().int().nonnegative().default(0), // matched rows already consumed from newest
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type LogQuery = z.infer<typeof logQuerySchema>;

/** One parsed log line returned to the client. */
export interface LogEntry {
  level: number;
  time: number;
  executionId: string | null;
  msg: string;
  /** Full parsed JSON object for the expand view. */
  data: Record<string, unknown>;
  /** Original raw line text. */
  raw: string;
}

export interface LogPage {
  rows: LogEntry[];
  /** Cursor to pass for the next (older) page, or null if exhausted. */
  nextCursor: number | null;
  /** Count of unparseable lines skipped while building this page. */
  skipped: number;
}
