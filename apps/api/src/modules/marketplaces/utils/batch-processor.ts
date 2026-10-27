/**
 * Batch Processor
 *
 * Process large datasets in chunks to avoid memory issues
 * and respect API rate limits.
 */

import { createLogger } from '../../../lib/logger';

const logger = createLogger('batch-processor');

/**
 * Batch processor configuration.
 */
export interface BatchConfig {
  /** Number of items per batch (default: 100) */
  batchSize: number;
  /** Maximum concurrent batches (default: 1 for sequential) */
  concurrency?: number;
  /** Delay between batches in ms (default: 0) */
  delayBetweenBatches?: number;
  /** Continue processing if a batch fails (default: false) */
  continueOnError?: boolean;
}

/**
 * Result of batch processing.
 * TResult is the type of successfully processed items.
 * TInput is the type of input items (used for failed items tracking).
 */
export interface BatchResult<TResult, TInput = TResult> {
  /** Successfully processed items */
  successful: TResult[];
  /** Failed items with error details (original input items) */
  failed: Array<{ item: TInput; error: Error }>;
  /** Total items processed */
  total: number;
  /** Number of batches processed */
  batchCount: number;
  /** Processing duration in milliseconds */
  duration: number;
}

/**
 * Progress callback for batch processing.
 */
export type BatchProgressCallback = (
  completed: number,
  total: number,
  batchNumber: number
) => void;

/**
 * Default batch configuration.
 */
const DEFAULT_BATCH_CONFIG: BatchConfig = {
  batchSize: 100,
  concurrency: 1,
  delayBetweenBatches: 0,
  continueOnError: false,
};

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Batch processor for large datasets.
 */
export class BatchProcessor {
  private readonly config: BatchConfig;

  constructor(config?: Partial<BatchConfig>) {
    this.config = {
      ...DEFAULT_BATCH_CONFIG,
      ...config,
    };
  }

  /**
   * Process items in batches.
   *
   * @param items - Array of items to process
   * @param processor - Function to process each batch
   * @param onProgress - Optional progress callback
   * @returns Batch processing result
   *
   * @example
   * const result = await batchProcessor.process(
   *   products,
   *   async (batch) => {
   *     await api.updateProducts(batch);
   *     return batch;
   *   }
   * );
   * console.log(`Processed ${result.successful.length} items`);
   */
  async process<T, R = T>(
    items: T[],
    processor: (batch: T[], batchIndex: number) => Promise<R[]>,
    onProgress?: BatchProgressCallback
  ): Promise<BatchResult<R, T>> {
    const startTime = Date.now();
    const successful: R[] = [];
    const failed: Array<{ item: T; error: Error }> = [];

    // Split into batches
    const batches = this.chunk(items, this.config.batchSize);
    let completedItems = 0;

    logger.info(
      {
        totalItems: items.length,
        batchSize: this.config.batchSize,
        batchCount: batches.length,
      },
      'Starting batch processing'
    );

    // Process batches
    if (this.config.concurrency && this.config.concurrency > 1) {
      // Parallel processing
      await this.processParallel(batches, processor, successful, failed, (completed) => {
        completedItems = completed;
        if (onProgress) {
          onProgress(completedItems, items.length, Math.ceil(completedItems / this.config.batchSize));
        }
      });
    } else {
      // Sequential processing
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        try {
          const results = await processor(batch, i);
          successful.push(...results);
          completedItems += batch.length;

          if (onProgress) {
            onProgress(completedItems, items.length, i + 1);
          }
        } catch (error) {
          const err = error as Error;
          logger.error(
            { batchIndex: i, error: err.message },
            'Batch processing failed'
          );

          // Record failures
          for (const item of batch) {
            failed.push({ item: item as unknown as T, error: err });
          }

          if (!this.config.continueOnError) {
            throw err;
          }
        }

        // Delay between batches (except after last batch)
        if (this.config.delayBetweenBatches && i < batches.length - 1) {
          await sleep(this.config.delayBetweenBatches);
        }
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        successful: successful.length,
        failed: failed.length,
        duration,
      },
      'Batch processing completed'
    );

    return {
      successful,
      failed,
      total: items.length,
      batchCount: batches.length,
      duration,
    };
  }

  /**
   * Process batches in parallel with concurrency limit.
   */
  private async processParallel<T, R>(
    batches: T[][],
    processor: (batch: T[], batchIndex: number) => Promise<R[]>,
    successful: R[],
    failed: Array<{ item: T; error: Error }>,
    onProgress: (completed: number) => void
  ): Promise<void> {
    const concurrency = this.config.concurrency || 1;
    let completedItems = 0;
    let runningCount = 0;
    let batchIndex = 0;

    await new Promise<void>((resolve, reject) => {
      const startNext = () => {
        while (runningCount < concurrency && batchIndex < batches.length) {
          const currentIndex = batchIndex;
          const batch = batches[currentIndex];
          batchIndex++;
          runningCount++;

          processor(batch, currentIndex)
            .then((results) => {
              successful.push(...results);
              completedItems += batch.length;
              onProgress(completedItems);
            })
            .catch((error) => {
              const err = error as Error;
              for (const item of batch) {
                failed.push({ item, error: err });
              }
              completedItems += batch.length;
              onProgress(completedItems);

              if (!this.config.continueOnError) {
                reject(error);
                return;
              }
            })
            .finally(() => {
              runningCount--;
              if (batchIndex >= batches.length && runningCount === 0) {
                resolve();
              } else {
                startNext();
              }
            });
        }
      };

      startNext();
    });
  }

  /**
   * Split array into chunks.
   */
  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Process items one by one with error handling.
   * Useful when each item needs individual processing.
   *
   * @param items - Array of items to process
   * @param processor - Function to process each item
   * @param onProgress - Optional progress callback
   * @returns Processing result
   */
  async processIndividually<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    onProgress?: BatchProgressCallback
  ): Promise<BatchResult<R, T>> {
    const batchProcessor = async (batch: T[], batchIndex: number): Promise<R[]> => {
      const results: R[] = [];

      for (let i = 0; i < batch.length; i++) {
        const result = await processor(batch[i], batchIndex * this.config.batchSize + i);
        results.push(result);
      }

      return results;
    };

    return this.process(items, batchProcessor, onProgress);
  }

  /**
   * Get the current configuration.
   */
  getConfig(): BatchConfig {
    return { ...this.config };
  }
}

/**
 * Create a batch processor with custom configuration.
 */
export function createBatchProcessor(config?: Partial<BatchConfig>): BatchProcessor {
  return new BatchProcessor(config);
}

/**
 * Utility to chunk an array.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
