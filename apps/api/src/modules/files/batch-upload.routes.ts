import type { FastifyInstance } from 'fastify';
import { batchUploadService, type BatchUploadFile } from './batch-upload.service';
import { filesService } from './files.service';

// Allowed file types (same as single upload)
const ALLOWED_TYPES = [
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
];

// Max files per batch
const MAX_FILES_PER_BATCH = 100;

// Max file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function batchUploadRoutes(app: FastifyInstance) {
  /**
   * Initialize a new batch upload session
   * POST /api/files/batch
   *
   * Body: {
   *   files: Array<{
   *     clientId: string,    // Client-provided unique ID
   *     checksum: string,    // MD5 hash of file content
   *     filename: string,    // Original filename
   *     mimetype: string,    // MIME type
   *     size: number         // File size in bytes
   *   }>,
   *   folder?: string        // Target folder (default: 'uploads')
   * }
   *
   * Response: {
   *   batchId: string,
   *   expiresAt: string,
   *   items: Array<{
   *     clientId: string,
   *     checksum: string,
   *     status: 'PENDING' | 'SKIPPED',
   *     uploadUrl?: string,  // Only if status is PENDING/UPLOADING
   *     storageKey?: string  // Only if already exists
   *   }>
   * }
   */
  app.post<{
    Body: {
      files: BatchUploadFile[];
      folder?: string;
    };
  }>(
    '/batch',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['files'],
          properties: {
            files: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_FILES_PER_BATCH,
              items: {
                type: 'object',
                required: ['clientId', 'checksum', 'filename', 'mimetype', 'size'],
                properties: {
                  clientId: { type: 'string', minLength: 1 },
                  checksum: { type: 'string', minLength: 32, maxLength: 64 },
                  filename: { type: 'string', minLength: 1 },
                  mimetype: { type: 'string', minLength: 1 },
                  size: { type: 'number', minimum: 1, maximum: MAX_FILE_SIZE },
                },
              },
            },
            folder: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { files, folder } = request.body;

      // Validate all file types
      for (const file of files) {
        if (!filesService.isAllowedType(file.mimetype, ALLOWED_TYPES)) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_FILE_TYPE',
              message: `File type not allowed: ${file.filename} (${file.mimetype})`,
            },
          });
        }
      }

      // Check for duplicate clientIds
      const clientIds = new Set<string>();
      for (const file of files) {
        if (clientIds.has(file.clientId)) {
          return reply.code(400).send({
            error: {
              code: 'DUPLICATE_CLIENT_ID',
              message: `Duplicate clientId: ${file.clientId}`,
            },
          });
        }
        clientIds.add(file.clientId);
      }

      const result = await batchUploadService.initBatch(
        request.user.sub,
        files,
        folder
      );

      return {
        data: result,
      };
    }
  );

  /**
   * Resume an existing batch upload
   * GET /api/files/batch/:batchId
   *
   * Returns the current status of the batch and upload URLs for pending files
   */
  app.get<{
    Params: { batchId: string };
  }>(
    '/batch/:batchId',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const result = await batchUploadService.resumeBatch(
        request.params.batchId,
        request.user.sub
      );

      if (!result) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch upload not found or access denied',
          },
        });
      }

      return {
        data: result,
      };
    }
  );

  /**
   * Get batch status only (no upload URLs)
   * GET /api/files/batch/:batchId/status
   */
  app.get<{
    Params: { batchId: string };
  }>(
    '/batch/:batchId/status',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const result = await batchUploadService.getBatchStatus(
        request.params.batchId,
        request.user.sub
      );

      if (!result) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch upload not found or access denied',
          },
        });
      }

      return {
        data: result,
      };
    }
  );

  /**
   * Confirm a file upload in the batch
   * POST /api/files/batch/:batchId/confirm
   *
   * Body: { clientId: string }
   *
   * Called by client after successfully uploading a file to the presigned URL
   */
  app.post<{
    Params: { batchId: string };
    Body: { clientId: string };
  }>(
    '/batch/:batchId/confirm',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['clientId'],
          properties: {
            clientId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await batchUploadService.confirmUpload(
        request.params.batchId,
        request.user.sub,
        request.body.clientId
      );

      if (!result) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch item not found or access denied',
          },
        });
      }

      return {
        data: result,
      };
    }
  );

  /**
   * Mark a file upload as failed
   * POST /api/files/batch/:batchId/failed
   *
   * Body: { clientId: string, error: string }
   */
  app.post<{
    Params: { batchId: string };
    Body: { clientId: string; error: string };
  }>(
    '/batch/:batchId/failed',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['clientId', 'error'],
          properties: {
            clientId: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await batchUploadService.markFailed(
        request.params.batchId,
        request.user.sub,
        request.body.clientId,
        request.body.error
      );

      if (!result) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch item not found or access denied',
          },
        });
      }

      return {
        data: result,
      };
    }
  );

  /**
   * Retry failed uploads in a batch
   * POST /api/files/batch/:batchId/retry
   *
   * Returns new upload URLs for all failed items
   */
  app.post<{
    Params: { batchId: string };
  }>(
    '/batch/:batchId/retry',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const items = await batchUploadService.retryFailed(
        request.params.batchId,
        request.user.sub
      );

      if (items.length === 0) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch not found, not in progress, or no failed items',
          },
        });
      }

      return {
        data: { items },
      };
    }
  );

  /**
   * Cancel a batch upload
   * DELETE /api/files/batch/:batchId
   *
   * Cancels the batch and cleans up any orphaned S3 files
   */
  app.delete<{
    Params: { batchId: string };
  }>(
    '/batch/:batchId',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const success = await batchUploadService.cancelBatch(
        request.params.batchId,
        request.user.sub
      );

      if (!success) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Batch not found, access denied, or already completed',
          },
        });
      }

      return {
        data: { success: true },
      };
    }
  );

  /**
   * Bulk confirm multiple file uploads
   * POST /api/files/batch/:batchId/confirm-bulk
   *
   * Body: { clientIds: string[] }
   *
   * Confirms multiple files at once (more efficient than individual confirms)
   */
  app.post<{
    Params: { batchId: string };
    Body: { clientIds: string[] };
  }>(
    '/batch/:batchId/confirm-bulk',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['clientIds'],
          properties: {
            clientIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { clientIds } = request.body;
      const results = [];

      for (const clientId of clientIds) {
        const result = await batchUploadService.confirmUpload(
          request.params.batchId,
          request.user.sub,
          clientId
        );
        if (result) {
          results.push(result);
        }
      }

      return {
        data: {
          confirmed: results.length,
          items: results,
        },
      };
    }
  );
}
