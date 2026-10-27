import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogsService } from './logs.service';

let tmpDir: string;
let service: LogsService;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));
  // module "alpha" has a log.txt, "beta" does not
  fs.mkdirSync(path.join(tmpDir, 'alpha'));
  fs.writeFileSync(path.join(tmpDir, 'alpha', 'log.txt'), '');
  fs.mkdirSync(path.join(tmpDir, 'beta'));
  service = new LogsService(tmpDir);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listModules', () => {
  it('returns only folders that contain a log.txt', () => {
    expect(service.listModules()).toEqual(['alpha']);
  });
});

describe('resolveModulePath (path safety)', () => {
  it('rejects path traversal', () => {
    expect(() => service.resolveModulePath('../../etc')).toThrow();
  });
  it('rejects absolute escape', () => {
    expect(() => service.resolveModulePath('/etc/passwd')).toThrow();
  });
  it('resolves a valid module', () => {
    expect(service.resolveModulePath('alpha')).toBe(
      path.join(tmpDir, 'alpha', 'log.txt')
    );
  });
});

describe('readPage', () => {
  let dir: string;
  let svc: LogsService;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-read-'));
    fs.mkdirSync(path.join(dir, 'mod'));
    const lines = [
      { level: 30, time: 1000, executionId: 'EXEC_A', msg: 'first' },
      { level: 40, time: 2000, executionId: 'EXEC_A', msg: 'second warn' },
      { level: 50, time: 3000, executionId: 'EXEC_B', msg: 'third error' },
      { level: 30, time: 4000, executionId: 'EXEC_B', msg: 'fourth' },
    ];
    const content =
      lines.map((l) => JSON.stringify(l)).join('\n') +
      '\n' +
      '{ broken json' + // malformed trailing line
      '\n';
    fs.writeFileSync(path.join(dir, 'mod', 'log.txt'), content);
    svc = new LogsService(dir);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns newest-first and skips malformed lines', () => {
    const page = svc.readPage('mod', { level: 'all', cursor: 0, limit: 10 });
    expect(page.rows.map((r) => r.time)).toEqual([4000, 3000, 2000, 1000]);
    expect(page.skipped).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it('applies the level floor (warn excludes info)', () => {
    const page = svc.readPage('mod', { level: 'warn', cursor: 0, limit: 10 });
    expect(page.rows.map((r) => r.time)).toEqual([3000, 2000]);
  });

  it('filters by executionId exact match', () => {
    const page = svc.readPage('mod', { level: 'all', executionId: 'EXEC_A', cursor: 0, limit: 10 });
    expect(page.rows.map((r) => r.time)).toEqual([2000, 1000]);
  });

  it('substring search matches msg/raw case-insensitively', () => {
    const page = svc.readPage('mod', { level: 'all', q: 'WARN', cursor: 0, limit: 10 });
    expect(page.rows.map((r) => r.time)).toEqual([2000]);
  });

  it('filters by time range inclusive', () => {
    const page = svc.readPage('mod', { level: 'all', from: 2000, to: 3000, cursor: 0, limit: 10 });
    expect(page.rows.map((r) => r.time)).toEqual([3000, 2000]);
  });

  it('paginates with cursor and reports nextCursor', () => {
    const p1 = svc.readPage('mod', { level: 'all', cursor: 0, limit: 2 });
    expect(p1.rows.map((r) => r.time)).toEqual([4000, 3000]);
    expect(p1.nextCursor).toBe(2);
    const p2 = svc.readPage('mod', { level: 'all', cursor: p1.nextCursor!, limit: 2 });
    expect(p2.rows.map((r) => r.time)).toEqual([2000, 1000]);
    expect(p2.nextCursor).toBeNull();
  });

  it('returns an empty page when log.txt is missing', () => {
    fs.mkdirSync(path.join(dir, 'empty'));
    const page = svc.readPage('empty', { level: 'all', cursor: 0, limit: 10 });
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('collectForExport', () => {
  let dir: string;
  let svc: LogsService;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-exp-'));
    fs.mkdirSync(path.join(dir, 'mod'));
    const content =
      [
        JSON.stringify({ level: 30, time: 1, msg: 'a' }),
        JSON.stringify({ level: 50, time: 2, msg: 'b' }),
      ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'mod', 'log.txt'), content);
    svc = new LogsService(dir);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns only matching raw lines (level floor)', () => {
    const out = svc.collectForExport('mod', { level: 'error' });
    expect(out).toEqual([JSON.stringify({ level: 50, time: 2, msg: 'b' })]);
  });

  it('returns [] when log.txt is missing', () => {
    fs.mkdirSync(path.join(dir, 'none'));
    expect(svc.collectForExport('none', { level: 'all' })).toEqual([]);
  });
});

describe('readPage multi-chunk', () => {
  /**
   * Exercises the leftover/chunk-boundary logic that the single-chunk tests
   * cannot reach. We write 5000 NDJSON lines (~160 bytes each ≈ 800KB total,
   * well over the 64KB CHUNK), then:
   *  1. Full read returns all 5000 rows newest-first.
   *  2. Cursor pagination in pages of 1000 covers all rows with no gaps/dupes.
   *  3. A unique token placed near a 64KB boundary is found intact by `q` search.
   */
  let dir: string;
  let svc: LogsService;
  const TOTAL = 5000;
  /** line index (1-based) that we want to land near the first 64KB boundary */
  const BOUNDARY_LINE_APPROX = 410; // ~64KB / ~155 bytes per line ≈ 413

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-multi-chunk-'));
    fs.mkdirSync(path.join(dir, 'big'));

    const lines: string[] = [];
    for (let t = 1; t <= TOTAL; t++) {
      const obj: Record<string, unknown> = {
        level: 30,
        time: t,
        msg: `log line ${t}`,
      };
      // Plant a unique searchable token near the expected chunk boundary
      if (t === BOUNDARY_LINE_APPROX) {
        obj.msg = `BOUNDARY_TOKEN_XYZ log line ${t}`;
      }
      lines.push(JSON.stringify(obj));
    }
    fs.writeFileSync(path.join(dir, 'big', 'log.txt'), lines.join('\n') + '\n');
    svc = new LogsService(dir);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('full read returns all 5000 rows newest-first', () => {
    const page = svc.readPage('big', { level: 'all', cursor: 0, limit: 6000 });
    expect(page.rows.length).toBe(TOTAL);
    expect(page.rows[0].time).toBe(TOTAL);           // newest first
    expect(page.rows[TOTAL - 1].time).toBe(1);        // oldest last
    expect(page.nextCursor).toBeNull();
    expect(page.skipped).toBe(0);
  });

  it('cursor pagination covers all 5000 rows with no gaps or duplicates', () => {
    const PAGE_SIZE = 1000;
    const allRows: number[] = [];
    let cursor = 0;

    let iterations = 0;
    while (true) {
      const page = svc.readPage('big', { level: 'all', cursor, limit: PAGE_SIZE });
      allRows.push(...page.rows.map((r) => r.time));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      if (++iterations > TOTAL) throw new Error('infinite pagination loop');
    }

    // Should have exactly TOTAL rows
    expect(allRows.length).toBe(TOTAL);
    // Must be strictly descending (newest-first, no duplicates, no gaps)
    const expected = Array.from({ length: TOTAL }, (_, i) => TOTAL - i);
    expect(allRows).toEqual(expected);
  });

  it('finds the boundary-token line intact via q-search', () => {
    const page = svc.readPage('big', {
      level: 'all',
      q: 'BOUNDARY_TOKEN_XYZ',
      cursor: 0,
      limit: 10,
    });
    expect(page.rows.length).toBe(1);
    expect(page.rows[0].time).toBe(BOUNDARY_LINE_APPROX);
    expect(page.rows[0].msg).toBe(`BOUNDARY_TOKEN_XYZ log line ${BOUNDARY_LINE_APPROX}`);
  });
});

describe('resolveModulePath symlink guard', () => {
  it('rejects a symlink that points outside the logs dir', () => {
    // Set up: a fresh logs dir and an outside dir the symlink will point to.
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-symlink-guard-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-symlink-outside-'));

    try {
      const symlinkPath = path.join(logsDir, 'escape');
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideDir, symlinkPath, 'dir');
        symlinkCreated = true;
      } catch {
        // EPERM or unsupported on this platform — skip the meaningful assertion.
      }

      if (symlinkCreated) {
        const svc = new LogsService(logsDir);
        // The symlink target resolves outside logsDir — must throw.
        expect(() => svc.resolveModulePath('escape')).toThrow();
      } else {
        // Symlink creation not permitted in this environment; guard is untestable here.
        expect(true).toBe(true); // test intentionally skipped
      }
    } finally {
      fs.rmSync(logsDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
