import { prisma } from '../../lib/prisma';
import { s3Service } from './s3.service';
import { createLogger } from '../../lib/logger';
import type { BatchUploadStatus, BatchUploadItemStatus } from '@prisma/client';

const logger = createLogger('batch-upload');

// Batch upload expiry time (24 hours)
const BATCH_EXPIRY_HOURS = 24;

export interface BatchUploadFile {
  clientId: string;      // Client-provided unique ID for this file
  checksum: string;      // MD5 hash of file content
  filename: string;      // Original filename
  mimetype: string;      // MIME type
  size: number;          // File size in bytes
}

export interface BatchUploadInitResult {
  batchId: string;
  expiresAt: Date;
  items: BatchUploadItemResult[];
}

export interface BatchUploadItemResult {
  clientId: string;
  checksum: string;
  status: BatchUploadItemStatus;
  uploadUrl?: string;     // Presigned URL for upload (only if PENDING)
  storageKey?: string;    // S3 key (only if already uploaded)
  error?: string;
}

export interface BatchUploadStatusResult {
  batchId: string;
  status: BatchUploadStatus;
  totalFiles: number;
  pendingCount: number;
  uploadedCount: number;
  failedCount: number;
  skippedCount: number;
  items: BatchUploadItemResult[];
  expiresAt: Date;
  completedAt?: Date;
}

export class BatchUploadService {
  /**
   * Initialize a new batch upload session
   * Returns status for each file: PENDING (needs upload) or SKIPPED (already exists)
   */
  async initBatch(
    userId: string,
    files: BatchUploadFile[],
    folder: string = 'uploads'
  ): Promise<BatchUploadInitResult> {
    const expiresAt = new Date(Date.now() + BATCH_EXPIRY_HOURS * 60 * 60 * 1000);

    // Check for existing files by checksum (global deduplication)
    const checksums = files.map(f => f.checksum);
    const existingFiles = await prisma.file.findMany({
      where: {
        checksum: { in: checksums },
        status: { not: 'DELETED' },
      },
      select: {
        checksum: true,
        storageKey: true,
        storageUrl: true,
        id: true,
      },
    });

    const existingByChecksum = new Map(
      existingFiles.map(f => [f.checksum, f])
    );

    // Create batch upload session with items
    const batch = await prisma.$transaction(async (tx) => {
      // Create batch
      const newBatch = await tx.batchUpload.create({
        data: {
          userId,
          totalFiles: files.length,
          folder,
          expiresAt,
        },
      });

      // Create batch items
      const itemsData = files.map(file => {
        const existing = existingByChecksum.get(file.checksum);
        return {
          batchId: newBatch.id,
          clientId: file.clientId,
          checksum: file.checksum,
          filename: file.filename,
          mimetype: file.mimetype,
          size: file.size,
          status: existing ? 'SKIPPED' as const : 'PENDING' as const,
          storageKey: existing?.storageKey,
          storageUrl: existing?.storageUrl,
          fileId: existing?.id,
        };
      });

      await tx.batchUploadItem.createMany({
        data: itemsData,
      });

      return newBatch;
    });

    // Fetch items with presigned URLs for pending ones
    const items = await this.getItemsWithUploadUrls(batch.id, folder);

    logger.info(
      { batchId: batch.id, totalFiles: files.length, pendingCount: items.filter(i => i.status === 'PENDING').length },
      'Batch upload initialized'
    );

    return {
      batchId: batch.id,
      expiresAt,
      items,
    };
  }

  /**
   * Resume an existing batch - returns status and upload URLs for pending files
   */
  async resumeBatch(batchId: string, userId: string): Promise<BatchUploadStatusResult | null> {
    const batch = await prisma.batchUpload.findFirst({
      where: {
        id: batchId,
        userId,
      },
      include: {
        items: true,
      },
    });

    if (!batch) {
      return null;
    }

    // Check if expired
    if (batch.expiresAt < new Date()) {
      await prisma.batchUpload.update({
        where: { id: batchId },
        data: { status: 'EXPIRED' },
      });
      return {
        batchId: batch.id,
        status: 'EXPIRED',
        totalFiles: batch.totalFiles,
        pendingCount: 0,
        uploadedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        items: [],
        expiresAt: batch.expiresAt,
      };
    }

    const items = await this.getItemsWithUploadUrls(batchId, batch.folder);
    const counts = this.countItemsByStatus(batch.items);

    return {
      batchId: batch.id,
      status: batch.status,
      totalFiles: batch.totalFiles,
      ...counts,
      items,
      expiresAt: batch.expiresAt,
      completedAt: batch.completedAt ?? undefined,
    };
  }

  /**
   * Confirm that a file has been uploaded to S3
   */
  async confirmUpload(
    batchId: string,
    userId: string,
    clientId: string
  ): Promise<BatchUploadItemResult | null> {
    // Verify batch ownership and get item
    const item = await prisma.batchUploadItem.findFirst({
      where: {
        batchId,
        clientId,
        batch: { userId },
      },
      include: {
        batch: true,
      },
    });

    if (!item || !item.storageKey) {
      return null;
    }

    // Verify file exists in S3
    const exists = await s3Service.exists(item.storageKey);
    if (!exists) {
      // Update item as failed
      const updated = await prisma.batchUploadItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          error: 'File not found in storage after upload',
          retryCount: { increment: 1 },
        },
      });

      return {
        clientId: updated.clientId,
        checksum: updated.checksum,
        status: updated.status,
        error: updated.error ?? undefined,
      };
    }

    // Create File record and update item
    const result = await prisma.$transaction(async (tx) => {
      // Create the actual File record
      const file = await tx.file.create({
        data: {
          filename: item.filename,
          mimeType: item.mimetype,
          size: item.size,
          storageKey: item.storageKey!,
          storageUrl: item.storageUrl || s3Service.getPublicUrl(item.storageKey!),
          status: 'COMPLETED',
          uploadedById: userId,
          checksum: item.checksum,
        },
      });

      // Update batch item
      const updatedItem = await tx.batchUploadItem.update({
        where: { id: item.id },
        data: {
          status: 'UPLOADED',
          fileId: file.id,
        },
      });

      return updatedItem;
    });

    // Check if batch is complete
    await this.checkBatchCompletion(batchId);

    logger.info(
      { batchId, clientId, fileId: result.fileId },
      'Batch upload item confirmed'
    );

    return {
      clientId: result.clientId,
      checksum: result.checksum,
      status: result.status,
      storageKey: result.storageKey ?? undefined,
    };
  }

  /**
   * Mark an upload as failed (client reporting failure)
   */
  async markFailed(
    batchId: string,
    userId: string,
    clientId: string,
    error: string
  ): Promise<BatchUploadItemResult | null> {
    const item = await prisma.batchUploadItem.findFirst({
      where: {
        batchId,
        clientId,
        batch: { userId },
      },
    });

    if (!item) {
      return null;
    }

    const updated = await prisma.batchUploadItem.update({
      where: { id: item.id },
      data: {
        status: 'FAILED',
        error,
        retryCount: { increment: 1 },
      },
    });

    // Check if batch is complete (all items have final status)
    await this.checkBatchCompletion(batchId);

    return {
      clientId: updated.clientId,
      checksum: updated.checksum,
      status: updated.status,
      error: updated.error ?? undefined,
    };
  }

  /**
   * Retry failed uploads - regenerate presigned URLs
   */
  async retryFailed(batchId: string, userId: string): Promise<BatchUploadItemResult[]> {
    const batch = await prisma.batchUpload.findFirst({
      where: {
        id: batchId,
        userId,
        status: 'IN_PROGRESS',
      },
    });

    if (!batch) {
      return [];
    }

    // Reset failed items to pending
    await prisma.batchUploadItem.updateMany({
      where: {
        batchId,
        status: 'FAILED',
      },
      data: {
        status: 'PENDING',
        error: null,
      },
    });

    // Return items with new upload URLs
    return this.getItemsWithUploadUrls(batchId, batch.folder);
  }

  /**
   * Get batch status without upload URLs
   */
  async getBatchStatus(batchId: string, userId: string): Promise<BatchUploadStatusResult | null> {
    const batch = await prisma.batchUpload.findFirst({
      where: {
        id: batchId,
        userId,
      },
      include: {
        items: true,
      },
    });

    if (!batch) {
      return null;
    }

    const counts = this.countItemsByStatus(batch.items);

    return {
      batchId: batch.id,
      status: batch.status,
      totalFiles: batch.totalFiles,
      ...counts,
      items: batch.items.map(item => ({
        clientId: item.clientId,
        checksum: item.checksum,
        status: item.status,
        storageKey: item.storageKey ?? undefined,
        error: item.error ?? undefined,
      })),
      expiresAt: batch.expiresAt,
      completedAt: batch.completedAt ?? undefined,
    };
  }

  /**
   * Cancel a batch upload
   */
  async cancelBatch(batchId: string, userId: string): Promise<boolean> {
    const batch = await prisma.batchUpload.findFirst({
      where: {
        id: batchId,
        userId,
        status: 'IN_PROGRESS',
      },
    });

    if (!batch) {
      return false;
    }

    // Delete any uploaded S3 files that don't have File records
    const uploadedItems = await prisma.batchUploadItem.findMany({
      where: {
        batchId,
        storageKey: { not: null },
        fileId: null, // Not yet confirmed
      },
    });

    for (const item of uploadedItems) {
      if (item.storageKey) {
        try {
          await s3Service.delete(item.storageKey);
        } catch (error) {
          logger.warn({ error, storageKey: item.storageKey }, 'Failed to delete orphaned S3 object');
        }
      }
    }

    // Delete batch (cascade deletes items)
    await prisma.batchUpload.delete({
      where: { id: batchId },
    });

    logger.info({ batchId }, 'Batch upload cancelled');

    return true;
  }

  /**
   * Clean up expired batches (run periodically)
   */
  async cleanupExpired(): Promise<number> {
    const expiredBatches = await prisma.batchUpload.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: 'IN_PROGRESS',
      },
      include: {
        items: {
          where: {
            storageKey: { not: null },
            fileId: null,
          },
        },
      },
    });

    let cleanedCount = 0;

    for (const batch of expiredBatches) {
      // Delete orphaned S3 files
      for (const item of batch.items) {
        if (item.storageKey) {
          try {
            await s3Service.delete(item.storageKey);
          } catch (error) {
            logger.warn({ error, storageKey: item.storageKey }, 'Failed to delete expired S3 object');
          }
        }
      }

      // Update batch status
      await prisma.batchUpload.update({
        where: { id: batch.id },
        data: { status: 'EXPIRED' },
      });

      cleanedCount++;
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Cleaned up expired batch uploads');
    }

    return cleanedCount;
  }

  // Private helpers

  private async getItemsWithUploadUrls(batchId: string, folder: string): Promise<BatchUploadItemResult[]> {
    const items = await prisma.batchUploadItem.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });

    const results: BatchUploadItemResult[] = [];

    for (const item of items) {
      const result: BatchUploadItemResult = {
        clientId: item.clientId,
        checksum: item.checksum,
        status: item.status,
        storageKey: item.storageKey ?? undefined,
        error: item.error ?? undefined,
      };

      // Generate presigned URL for pending items
      if (item.status === 'PENDING') {
        const key = s3Service.generateKey(folder, item.filename);
        const uploadUrl = await s3Service.getSignedUploadUrl(key, item.mimetype);

        // Update item with storage key
        await prisma.batchUploadItem.update({
          where: { id: item.id },
          data: {
            storageKey: key,
            storageUrl: s3Service.getPublicUrl(key),
            status: 'UPLOADING',
          },
        });

        result.uploadUrl = uploadUrl;
        result.storageKey = key;
        result.status = 'UPLOADING';
      }

      results.push(result);
    }

    return results;
  }

  private async checkBatchCompletion(batchId: string): Promise<void> {
    const items = await prisma.batchUploadItem.findMany({
      where: { batchId },
      select: { status: true },
    });

    // Check if all items have final status
    const allComplete = items.every(
      item => ['UPLOADED', 'FAILED', 'SKIPPED'].includes(item.status)
    );

    if (allComplete) {
      const hasFailures = items.some(item => item.status === 'FAILED');

      await prisma.batchUpload.update({
        where: { id: batchId },
        data: {
          status: hasFailures ? 'FAILED' : 'COMPLETED',
          completedAt: new Date(),
        },
      });

      logger.info(
        { batchId, hasFailures },
        'Batch upload completed'
      );
    }
  }

  private countItemsByStatus(items: { status: BatchUploadItemStatus }[]) {
    return {
      pendingCount: items.filter(i => i.status === 'PENDING' || i.status === 'UPLOADING').length,
      uploadedCount: items.filter(i => i.status === 'UPLOADED').length,
      failedCount: items.filter(i => i.status === 'FAILED').length,
      skippedCount: items.filter(i => i.status === 'SKIPPED').length,
    };
  }
}

export const batchUploadService = new BatchUploadService();
