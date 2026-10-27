/**
 * Checkpoint Manager for Resumable Syncs
 *
 * Saves progress every 500 products to allow resume after failures/restarts
 */

import { prisma } from '../prisma';
import { createLogger } from '../logger';
import type { CheckpointState } from './types';

const logger = createLogger('shopify-checkpoint');

export class CheckpointManager {
  private syncId: string;
  private batchSize: number;

  constructor(syncId: string, batchSize = 500) {
    this.syncId = syncId;
    this.batchSize = batchSize;
  }

  /**
   * Save checkpoint state to database
   */
  async save(state: CheckpointState): Promise<void> {
    try {
      await prisma.shopifySync.update({
        where: { id: this.syncId },
        data: {
          checkpoint: JSON.stringify(state),
          processed: state.processed,
          created: state.created,
          updated: state.updated,
          failed: state.failed,
        },
      });

      logger.debug(
        { syncId: this.syncId, processed: state.processed, batch: state.batchNumber },
        'Checkpoint saved'
      );
    } catch (error) {
      logger.error({ error, syncId: this.syncId }, 'Failed to save checkpoint');
      throw error;
    }
  }

  /**
   * Load checkpoint state from database
   */
  async load(): Promise<CheckpointState | null> {
    try {
      const sync = await prisma.shopifySync.findUnique({
        where: { id: this.syncId },
        select: { checkpoint: true, processed: true, created: true, updated: true, failed: true },
      });

      if (!sync?.checkpoint) {
        return null;
      }

      const checkpoint = JSON.parse(sync.checkpoint) as CheckpointState;

      // Merge with current DB state (in case of partial updates)
      checkpoint.processed = sync.processed;
      checkpoint.created = sync.created;
      checkpoint.updated = sync.updated;
      checkpoint.failed = sync.failed;

      logger.info(
        { syncId: this.syncId, checkpoint },
        'Loaded checkpoint, resuming sync'
      );

      return checkpoint;
    } catch (error) {
      logger.error({ error, syncId: this.syncId }, 'Failed to load checkpoint');
      return null;
    }
  }

  /**
   * Clear checkpoint after successful completion
   */
  async clear(): Promise<void> {
    try {
      await prisma.shopifySync.update({
        where: { id: this.syncId },
        data: { checkpoint: null },
      });

      logger.debug({ syncId: this.syncId }, 'Checkpoint cleared');
    } catch (error) {
      logger.error({ error, syncId: this.syncId }, 'Failed to clear checkpoint');
    }
  }

  /**
   * Check if we should save a checkpoint (every batchSize products)
   */
  shouldSaveCheckpoint(processed: number): boolean {
    return processed > 0 && processed % this.batchSize === 0;
  }

  /**
   * Create initial checkpoint state
   */
  static createInitialState(): CheckpointState {
    return {
      lastProductId: null,
      batchNumber: 0,
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
    };
  }
}
