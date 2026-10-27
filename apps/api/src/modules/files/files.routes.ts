import type { FastifyInstance } from 'fastify';
import { filesService } from './files.service';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file types
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

export async function filesRoutes(app: FastifyInstance) {
  // Upload file (server-side)
  app.post<{
    Body: {
      folder?: string;
    };
  }>(
    '/upload',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({
          error: {
            code: 'NO_FILE',
            message: 'No file uploaded',
          },
        });
      }

      // Check file size
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(400).send({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds limit (10MB)',
          },
        });
      }

      // Check file type
      if (!filesService.isAllowedType(data.mimetype, ALLOWED_TYPES)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'File type not allowed',
          },
        });
      }

      const folder = (data.fields.folder as { value?: string })?.value || 'uploads';

      const file = await filesService.upload({
        filename: data.filename,
        mimetype: data.mimetype,
        size: buffer.length,
        buffer,
        uploadedById: request.user.sub,
        folder,
      });

      return {
        data: file,
      };
    }
  );

  // Get presigned upload URL (for client-side upload)
  app.post<{
    Body: {
      filename: string;
      mimetype: string;
      folder?: string;
    };
  }>(
    '/presigned-upload',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['filename', 'mimetype'],
          properties: {
            filename: { type: 'string' },
            mimetype: { type: 'string' },
            folder: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { filename, mimetype, folder } = request.body;

      // Check file type
      if (!filesService.isAllowedType(mimetype, ALLOWED_TYPES)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'File type not allowed',
          },
        });
      }

      const result = await filesService.getPresignedUploadUrl(filename, mimetype, folder);

      return {
        data: result,
      };
    }
  );

  // Confirm client-side upload
  app.post<{
    Body: {
      key: string;
      originalName: string;
      mimetype: string;
      size: number;
    };
  }>(
    '/confirm-upload',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['key', 'originalName', 'mimetype', 'size'],
          properties: {
            key: { type: 'string' },
            originalName: { type: 'string' },
            mimetype: { type: 'string' },
            size: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      const { key, originalName, mimetype, size } = request.body;

      try {
        const file = await filesService.confirmUpload(
          key,
          originalName,
          mimetype,
          size,
          request.user.sub
        );

        return {
          data: file,
        };
      } catch (error) {
        return reply.code(400).send({
          error: {
            code: 'UPLOAD_CONFIRM_FAILED',
            message: error instanceof Error ? error.message : 'Failed to confirm upload',
          },
        });
      }
    }
  );

  // Get file by ID (only owner can access, unless admin)
  app.get<{
    Params: { id: string };
  }>(
    '/:id',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      // Check if user has admin permission for files
      const isAdmin = request.user.permissions?.includes('files:admin') ?? false;
      const file = await filesService.getById(request.params.id, request.user.sub, isAdmin);

      if (!file) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'File not found or access denied',
          },
        });
      }

      return {
        data: file,
      };
    }
  );

  // Get download URL (only owner can access, unless admin)
  app.get<{
    Params: { id: string };
  }>(
    '/:id/download',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      // Check if user has admin permission for files
      const isAdmin = request.user.permissions?.includes('files:admin') ?? false;
      const url = await filesService.getDownloadUrl(request.params.id, request.user.sub, isAdmin);

      if (!url) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'File not found or access denied',
          },
        });
      }

      return {
        data: { url },
      };
    }
  );

  // Get user's files
  app.get<{
    Querystring: { page?: number; limit?: number };
  }>(
    '/',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const { page, limit } = request.query;
      return filesService.getByUser(request.user.sub, { page, limit });
    }
  );

  // Delete file (only owner can delete, unless admin)
  app.delete<{
    Params: { id: string };
  }>(
    '/:id',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      try {
        // Check if user has admin permission for files
        const isAdmin = request.user.permissions?.includes('files:admin') ?? false;
        await filesService.delete(request.params.id, request.user.sub, isAdmin);
        return {
          data: { success: true },
        };
      } catch (error) {
        return reply.code(400).send({
          error: {
            code: 'DELETE_FAILED',
            message: error instanceof Error ? error.message : 'Failed to delete file',
          },
        });
      }
    }
  );
}
