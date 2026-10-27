/**
 * Reconciliation Log Collector
 *
 * Captures structured log entries during reconciliation execution
 * and stores them in Redis for UI consumption.
 *
 * Flush strategy: auto-flush every BATCH_SIZE entries or on explicit flush().
 * Error resilience: flush() failures are caught and logged (never interrupts reconciliation).
 */

import { nanoid } from 'nanoid';
import { redis } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import type {
  ReconciliationLogEntry,
  ReconciliationLogLevel,
  ReconciliationLogPhase,
} from './reconciliation.types';

const logger = createLogger('reconciliation-logs');

const BATCH_SIZE = 10;
const LOG_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class ReconciliationLogCollector {
  private buffer: ReconciliationLogEntry[] = [];
  private readonly redisKey: string;

  constructor(private readonly runId: string) {
    this.redisKey = `reconciliation:logs:${runId}`;
  }

  /**
   * Add a log entry to the buffer.
   * Auto-flushes when buffer reaches BATCH_SIZE.
   */
  log(entry: Omit<ReconciliationLogEntry, 'id' | 'timestamp'>): void {
    const fullEntry: ReconciliationLogEntry = {
      id: nanoid(10),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.buffer.push(fullEntry);

    if (this.buffer.length >= BATCH_SIZE) {
      // Fire-and-forget flush (errors caught inside)
      void this.flush();
    }
  }

  /**
   * Write buffered entries to Redis and clear the buffer.
   * Uses RPUSH + EXPIRE in a pipeline for atomic, concurrent-safe appends.
   * Catches all errors to avoid interrupting reconciliation flow.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      const serialized = entries.map((e) => JSON.stringify(e));
      const pipeline = redis.pipeline();
      pipeline.rpush(this.redisKey, ...serialized);
      pipeline.expire(this.redisKey, LOG_TTL_SECONDS);
      await pipeline.exec();
    } catch (error) {
      // Best-effort logging - never interrupt reconciliation
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ runId: this.runId, error: msg, entryCount: entries.length }, 'Failed to flush log entries to Redis');
    }
  }

  /**
   * Retrieve all log entries for a run from Redis.
   */
  static async getAll(runId: string): Promise<ReconciliationLogEntry[]> {
    const key = `reconciliation:logs:${runId}`;
    const data = await redis.lrange(key, 0, -1);
    return data.map((d) => JSON.parse(d) as ReconciliationLogEntry);
  }
}
