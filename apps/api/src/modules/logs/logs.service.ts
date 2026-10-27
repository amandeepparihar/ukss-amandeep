import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { LEVEL_FLOOR, type LogEntry, type LogPage, type LogQuery } from './logs.schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the logs directory the same way lib/logger.ts does: LOGS_DIR env override, else relative to this source file (cwd-independent). */
function defaultLogsDir(): string {
  if (process.env.LOGS_DIR) return process.env.LOGS_DIR;
  return path.resolve(__dirname, '../../../logs');
}

export class LogsService {
  constructor(private readonly logsDir: string = defaultLogsDir()) {}

  /** Folders under logsDir that contain a log.txt, sorted alphabetically. */
  listModules(): string[] {
    if (!fs.existsSync(this.logsDir)) return [];
    return fs
      .readdirSync(this.logsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) =>
        fs.existsSync(path.join(this.logsDir, name, 'log.txt'))
      )
      .sort();
  }

  /**
   * Resolve `<logsDir>/<module>/log.txt`, asserting the result stays inside
   * logsDir. Throws on traversal/absolute escape — `module` is client input.
   */
  resolveModulePath(module: string): string {
    const target = path.resolve(this.logsDir, module, 'log.txt');
    const root = path.resolve(this.logsDir) + path.sep;
    // String-level guard: rejects ../ and absolute escapes.
    if (!target.startsWith(root)) {
      throw new Error(`Invalid module: ${module}`);
    }
    // Symlink guard: path.resolve is string-only, but fs follows symlinks.
    // If the real (symlink-followed) path escapes the real logs root, reject.
    // We check the deepest ancestor that exists on disk to handle the case where
    // log.txt doesn't exist yet but the module dir itself is a symlink pointing out.
    const realRoot = fs.realpathSync(this.logsDir) + path.sep;
    try {
      const realTarget = fs.realpathSync(target);
      if (!realTarget.startsWith(realRoot)) {
        throw new Error(`Invalid module: ${module}`);
      }
      return realTarget;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
      // log.txt doesn't exist yet — check the module dir itself for symlink escape.
      const moduleDir = path.resolve(this.logsDir, module);
      try {
        const realModuleDir = fs.realpathSync(moduleDir) + path.sep;
        if (!realModuleDir.startsWith(realRoot)) {
          throw new Error(`Invalid module: ${module}`);
        }
      } catch (e2) {
        // Module dir also doesn't exist (ENOENT) — no symlink to follow, safe to proceed.
        if ((e2 as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw e2;
        }
      }
      // File/module doesn't exist yet; that's fine — callers guard with existsSync.
      return target;
    }
  }

  private static readonly CHUNK = 64 * 1024; // 64KB

  /**
   * Read one page of matching log lines, newest-first.
   * `cursor` = number of MATCHING lines already consumed from the newest end.
   */
  readPage(
    module: string,
    query: Pick<LogQuery, 'level' | 'cursor' | 'limit'> &
      Partial<Pick<LogQuery, 'q' | 'executionId' | 'from' | 'to'>>
  ): LogPage {
    const file = this.resolveModulePath(module);
    if (!fs.existsSync(file)) {
      return { rows: [], nextCursor: null, skipped: 0 };
    }

    const floor = LEVEL_FLOOR[query.level] ?? 0;
    const qLower = query.q ? query.q.toLowerCase() : null;
    const rows: LogEntry[] = [];
    let skipped = 0;
    let matchedSeen = 0; // matches encountered from newest end (incl. skipped-by-cursor)
    let exhausted = true;

    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      let pos = size;
      let leftover = ''; // partial line continuing into earlier (unread) bytes
      const buf = Buffer.alloc(LogsService.CHUNK);

      outer: while (pos > 0) {
        const readSize = Math.min(LogsService.CHUNK, pos);
        pos -= readSize;
        fs.readSync(fd, buf, 0, readSize, pos);
        const text = buf.toString('utf8', 0, readSize) + leftover;
        const parts = text.split('\n');
        // parts[0] continues into earlier bytes — hold it for the next chunk.
        leftover = parts.shift() ?? '';

        // Process the complete lines newest-first (end → start).
        for (let i = parts.length - 1; i >= 0; i--) {
          const line = parts[i];
          if (!line.trim()) continue;
          const entry = this.parseAndFilter(line, floor, qLower, query);
          if (entry === 'skip') { skipped++; continue; }
          if (entry === null) continue; // filtered out
          matchedSeen++;
          if (matchedSeen <= query.cursor) continue; // already shown on earlier pages
          rows.push(entry);
          if (rows.length >= query.limit) { exhausted = false; break outer; }
        }
      }

      // Handle the very first line of the file (final leftover) if not exhausted.
      if (exhausted && leftover.trim()) {
        const entry = this.parseAndFilter(leftover, floor, qLower, query);
        if (entry === 'skip') skipped++;
        else if (entry !== null) {
          matchedSeen++;
          if (matchedSeen > query.cursor && rows.length < query.limit) {
            rows.push(entry);
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    const nextCursor = exhausted ? null : query.cursor + rows.length;
    return { rows, nextCursor, skipped };
  }

  /** All raw matching lines in file order (oldest-first). Bounded by the 50MB cap. */
  collectForExport(
    module: string,
    query: Pick<LogQuery, 'level'> &
      Partial<Pick<LogQuery, 'q' | 'executionId' | 'from' | 'to'>>
  ): string[] {
    const file = this.resolveModulePath(module);
    if (!fs.existsSync(file)) return [];
    const MAX_EXPORT_BYTES = 50 * 1024 * 1024; // matches the logger's 50MB rotation cap
    const stat = fs.statSync(file);
    if (stat.size > MAX_EXPORT_BYTES) {
      throw new Error(
        `Log file too large to export (${Math.round(stat.size / 1e6)} MB). Narrow with time/level filters.`
      );
    }
    const floor = LEVEL_FLOOR[query.level] ?? 0;
    const qLower = query.q ? query.q.toLowerCase() : null;
    const out: string[] = [];
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const entry = this.parseAndFilter(line, floor, qLower, query);
      if (entry !== null && entry !== 'skip') out.push(entry.raw);
    }
    return out;
  }

  /** Parse one NDJSON line and apply filters. Returns entry, null (filtered), or 'skip' (unparseable). */
  private parseAndFilter(
    line: string,
    floor: number,
    qLower: string | null,
    query: Partial<Pick<LogQuery, 'executionId' | 'from' | 'to'>>
  ): LogEntry | null | 'skip' {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      return 'skip';
    }
    const level = typeof data.level === 'number' ? data.level : 0;
    const time = typeof data.time === 'number' ? data.time : 0;
    const executionId =
      typeof data.executionId === 'string' ? data.executionId : null;
    const msg = typeof data.msg === 'string' ? data.msg : '';

    if (level < floor) return null;
    if (query.executionId && executionId !== query.executionId) return null;
    if (query.from !== undefined && time < query.from) return null;
    if (query.to !== undefined && time > query.to) return null;
    if (qLower && !line.toLowerCase().includes(qLower)) return null;

    return { level, time, executionId, msg, data, raw: line };
  }
}

export const logsService = new LogsService();
