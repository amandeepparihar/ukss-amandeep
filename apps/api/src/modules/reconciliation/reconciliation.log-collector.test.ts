import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (vi.hoisted ensures these exist before vi.mock factories run) ----

const { mockRedisGet, mockRedisSet, mockLoggerError } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

vi.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  }),
}));

vi.mock('nanoid', () => ({
  nanoid: (size: number) => 'mock-id-' + String(size),
}));

// Import after mocks are defined
import { ReconciliationLogCollector } from './reconciliation.log-collector';
import type { ReconciliationLogEntry } from './reconciliation.types';

// ---- Helpers ----

const LOG_TTL_SECONDS = 7 * 24 * 60 * 60; // must match source

function makeEntry(overrides: Partial<Omit<ReconciliationLogEntry, 'id' | 'timestamp'>> = {}): Omit<ReconciliationLogEntry, 'id' | 'timestamp'> {
  return {
    level: 'info',
    marketplace: 'shopify',
    phase: 'api_fetch',
    message: 'test message',
    ...overrides,
  };
}

// ---- Tests ----

describe('ReconciliationLogCollector', () => {
  const RUN_ID = 'test-run-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ------------------------------------------------------------------
  // log() - entry creation
  // ------------------------------------------------------------------

  describe('log()', () => {
    it('creates entries with id and timestamp', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);

      collector.log(makeEntry({ message: 'hello' }));

      // Flush to persist buffered entries to Redis so we can inspect them
      await collector.flush();

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const storedJson = mockRedisSet.mock.calls[0][1] as string;
      const entries: ReconciliationLogEntry[] = JSON.parse(storedJson);

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('mock-id-10');
      expect(entries[0].timestamp).toBe('2026-01-15T10:00:00.000Z');
      expect(entries[0].level).toBe('info');
      expect(entries[0].marketplace).toBe('shopify');
      expect(entries[0].phase).toBe('api_fetch');
      expect(entries[0].message).toBe('hello');
    });

    it('auto-flushes when buffer reaches BATCH_SIZE (10 entries)', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);

      // Log exactly 10 entries to trigger auto-flush
      for (let i = 0; i < 10; i++) {
        collector.log(makeEntry({ message: `entry-${i}` }));
      }

      // Auto-flush is fire-and-forget; drain microtask queue
      await vi.runAllTimersAsync();

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const storedJson = mockRedisSet.mock.calls[0][1] as string;
      const entries: ReconciliationLogEntry[] = JSON.parse(storedJson);
      expect(entries).toHaveLength(10);
      expect(entries[0].message).toBe('entry-0');
      expect(entries[9].message).toBe('entry-9');
    });

    it('does not auto-flush below BATCH_SIZE', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);

      for (let i = 0; i < 9; i++) {
        collector.log(makeEntry({ message: `entry-${i}` }));
      }

      await vi.runAllTimersAsync();

      expect(mockRedisSet).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // flush()
  // ------------------------------------------------------------------

  describe('flush()', () => {
    it('writes to Redis with correct key and TTL', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);
      collector.log(makeEntry());

      await collector.flush();

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      expect(mockRedisSet).toHaveBeenCalledWith(
        `reconciliation:logs:${RUN_ID}`,
        expect.any(String),
        'EX',
        LOG_TTL_SECONDS,
      );
    });

    it('appends to existing entries in Redis', async () => {
      const existingEntries: ReconciliationLogEntry[] = [
        {
          id: 'existing-1',
          timestamp: '2026-01-15T09:00:00.000Z',
          level: 'info',
          marketplace: 'toffs',
          phase: 'summary',
          message: 'already stored',
        },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(existingEntries));

      const collector = new ReconciliationLogCollector(RUN_ID);
      collector.log(makeEntry({ message: 'new entry' }));

      await collector.flush();

      const storedJson = mockRedisSet.mock.calls[0][1] as string;
      const entries: ReconciliationLogEntry[] = JSON.parse(storedJson);

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('existing-1');
      expect(entries[0].message).toBe('already stored');
      expect(entries[1].message).toBe('new entry');
    });

    it('is a no-op when buffer is empty', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);

      await collector.flush();

      expect(mockRedisGet).not.toHaveBeenCalled();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('catches Redis errors without throwing', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis connection refused'));

      const collector = new ReconciliationLogCollector(RUN_ID);
      collector.log(makeEntry());

      // Should not throw
      await expect(collector.flush()).resolves.toBeUndefined();

      // Logger should have been called with the error
      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: RUN_ID,
          error: 'Redis connection refused',
          entryCount: 1,
        }),
        'Failed to flush log entries to Redis',
      );
    });

    it('catches non-Error exceptions without throwing', async () => {
      mockRedisGet.mockRejectedValue('string error');

      const collector = new ReconciliationLogCollector(RUN_ID);
      collector.log(makeEntry());

      await expect(collector.flush()).resolves.toBeUndefined();

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'string error',
        }),
        'Failed to flush log entries to Redis',
      );
    });

    it('clears the buffer after flush so subsequent flush is a no-op', async () => {
      const collector = new ReconciliationLogCollector(RUN_ID);
      collector.log(makeEntry());

      await collector.flush();
      expect(mockRedisSet).toHaveBeenCalledTimes(1);

      // Second flush should be a no-op
      await collector.flush();
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // getAll() (static)
  // ------------------------------------------------------------------

  describe('getAll()', () => {
    it('returns parsed entries from Redis', async () => {
      const storedEntries: ReconciliationLogEntry[] = [
        {
          id: 'abc',
          timestamp: '2026-01-15T09:00:00.000Z',
          level: 'warn',
          marketplace: 'fruugo',
          phase: 'check_missing_orders',
          message: 'missing 2 orders',
        },
        {
          id: 'def',
          timestamp: '2026-01-15T09:01:00.000Z',
          level: 'error',
          marketplace: 'fruugo',
          phase: 'check_status_sync',
          message: 'stuck status',
          details: { errorMessage: 'timeout' },
        },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(storedEntries));

      const result = await ReconciliationLogCollector.getAll('some-run');

      expect(mockRedisGet).toHaveBeenCalledWith('reconciliation:logs:some-run');
      expect(result).toEqual(storedEntries);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no data in Redis', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await ReconciliationLogCollector.getAll('nonexistent-run');

      expect(result).toEqual([]);
    });
  });
});
