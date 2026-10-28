import { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import * as mime from 'mime-types';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import { BadRequestError } from '../../lib/errors';
import { exportService, type ExportColumn } from '../exports/export.service';
import * as service from './books.service';
import {
  createBookSchema,
  updateBookSchema,
  bookIdSchema,
  listBooksQuery,
  exportBooksQuery,
  bookReportQuery,
  bookDateReportQuery,
} from './books.schema';

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'bookName', header: 'Book Name', width: 30 },
  { key: 'authorName', header: 'Author Name', width: 25 },
  { key: 'isbn', header: 'ISBN', width: 18 },
  { key: 'quantity', header: 'Quantity', width: 10 },
  { key: 'createdAt', header: 'Created', width: 20 },
];

export const bookRoutes: FastifyPluginAsync = async (app) => {
  //GET all books
  app.get('/', { preHandler: [app.requirePermission('books:view')] }, async (request, reply) => {
    return runWithExecution('books', async () => {
      getLogger('books-request').info(
        { method: 'GET', url: request.url, query: request.query },
        'incoming request'
      );

      try {
        const query = listBooksQuery.parse(request.query);
        const result = await service.listBooks(query);

        getLogger('books-response').info(
          { status: 200, total: result.meta.total },
          'books fetched successfully'
        );

        return reply.send({
          data: result.data,
          meta: result.meta,
        });
      } catch (err) {
        getLogger('books-response').error({ err }, 'failed to fetch books');
        throw err;
      }
    });
  });

  //GET export books as csv / xlsx / pdf
  app.get(
    '/export',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = exportBooksQuery.parse(request.query);
          const books = await service.findBooksForExport(query);

          const { buffer, mimeType, extension } = await exportService.export(query.format, {
            filename: 'books-export',
            columns: EXPORT_COLUMNS,
            data: books as unknown as Record<string, unknown>[],
            title: 'Books Export',
          });

          getLogger('books-response').info(
            { status: 200, format: query.format, count: books.length },
            'books exported successfully'
          );

          const dateStr = new Date().toISOString().split('T')[0];

          return reply
            .header('Content-Type', mimeType)
            .header('Content-Disposition', `attachment; filename="books-${dateStr}.${extension}"`)
            .send(buffer);
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to export books');
          throw err;
        }
      });
    }
  );

  //GET books on loan right now, with issued and late counts
  app.get(
    '/report',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = bookReportQuery.parse(request.query);
          const result = await service.getBookReport(query);

          getLogger('books-response').info(
            { status: 200, total: result.meta.total },
            'book report fetched successfully'
          );

          return reply.send({
            data: result.data,
            meta: result.meta,
          });
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to fetch book report');
          throw err;
        }
      });
    }
  );

  //GET books issued / returned between two dates
  app.get(
    '/date-report',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = bookDateReportQuery.parse(request.query);
          const result = await service.getBookDateReport(query);

          getLogger('books-response').info(
            { status: 200, total: result.meta.total },
            'book date report fetched successfully'
          );

          return reply.send({
            data: result.data,
            meta: result.meta,
          });
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to fetch book date report');
          throw err;
        }
      });
    }
  );

  //POST bulk upload books from a csv file
  app.post(
    '/bulk',
    { preHandler: [app.requirePermission('books:create')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info({ method: 'POST', url: request.url }, 'incoming request');

        try {
          const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } });

          if (!file) {
            throw new BadRequestError('No file uploaded');
          }
          if (path.extname(file.filename).toLowerCase() !== '.csv') {
            file.file.resume();
            throw new BadRequestError('Only .csv files are allowed');
          }

          const buffer = await file.toBuffer();
          if (buffer.length === 0) {
            throw new BadRequestError('File is empty');
          }

          const result = await service.createBulkBooks(buffer);

          getLogger('books-response').info(
            { status: 200, created: result.created, failed: result.failed.length },
            'bulk upload done'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to bulk upload books');
          throw err;
        }
      });
    }
  );

  //GET book by id
  app.get('/:id', { preHandler: [app.requirePermission('books:view')] }, async (request, reply) => {
    return runWithExecution('books', async () => {
      getLogger('books-request').info(
        { method: 'GET', url: request.url, params: request.params },
        'incoming request'
      );

      try {
        const { id } = bookIdSchema.parse(request.params);
        const result = await service.getBook(id);

        getLogger('books-response').info({ status: 200, bookId: id }, 'book fetched successfully');

        return reply.send({ data: result });
      } catch (err) {
        getLogger('books-response').error({ err }, 'failed to fetch book');
        throw err;
      }
    });
  });

  //GET download the book cover
  app.get(
    '/:id/cover',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = bookIdSchema.parse(request.params);
          const { content, fileName } = await service.getBookCover(id);

          getLogger('books-response').info({ status: 200, bookId: id }, 'book cover downloaded');

          return reply
            .header('Content-Type', mime.lookup(fileName) || 'application/octet-stream')
            .header('Content-Disposition', `attachment; filename="${fileName}"`)
            .send(content);
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to download book cover');
          throw err;
        }
      });
    }
  );

  //GET students who currently have this book
  app.get(
    '/:id/issued-students',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = bookIdSchema.parse(request.params);
          const data = await service.getStuNameOfIssuedBooks(id);

          getLogger('books-response').info(
            { status: 200, bookId: id, total: data.length },
            'issued students fetched successfully'
          );

          return reply.send({ data });
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to fetch issued students');
          throw err;
        }
      });
    }
  );

  //GET students who are late with this book
  app.get(
    '/:id/late-students',
    { preHandler: [app.requirePermission('books:view')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'GET', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = bookIdSchema.parse(request.params);
          const data = await service.getFineStuCountByBookId(id);

          getLogger('books-response').info(
            { status: 200, bookId: id, total: data.length },
            'late students fetched successfully'
          );

          return reply.send({ data });
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to fetch late students');
          throw err;
        }
      });
    }
  );

  //POST create book
  app.post('/', { preHandler: [app.requirePermission('books:create')] }, async (request, reply) => {
    return runWithExecution('books', async () => {
      getLogger('books-request').info(
        { method: 'POST', url: request.url, body: request.body },
        'incoming request'
      );

      try {
        const input = createBookSchema.parse(request.body);
        const book = await service.createBook(input);

        getLogger('books-response').info(
          { status: 201, bookId: book.id },
          'book created successfully'
        );

        return reply.status(201).send({ data: book });
      } catch (err) {
        getLogger('books-response').error({ err }, 'failed to create book');
        throw err;
      }
    });
  });

  //PUT update book
  app.put('/:id', { preHandler: [app.requirePermission('books:edit')] }, async (request, reply) => {
    return runWithExecution('books', async () => {
      getLogger('books-request').info(
        { method: 'PUT', url: request.url, params: request.params, body: request.body },
        'incoming request'
      );

      try {
        const { id } = bookIdSchema.parse(request.params);
        const input = updateBookSchema.parse(request.body);
        const book = await service.updateBook(id, input);

        getLogger('books-response').info({ status: 200, bookId: id }, 'book updated successfully');

        return reply.send({ data: book });
      } catch (err) {
        getLogger('books-response').error({ err }, 'failed to update book');
        throw err;
      }
    });
  });

  //DELETE book
  app.delete(
    '/:id',
    { preHandler: [app.requirePermission('books:delete')] },
    async (request, reply) => {
      return runWithExecution('books', async () => {
        getLogger('books-request').info(
          { method: 'DELETE', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = bookIdSchema.parse(request.params);
          await service.deleteBook(id);

          getLogger('books-response').info(
            { status: 204, bookId: id },
            'book deleted successfully'
          );

          return reply.status(204).send();
        } catch (err) {
          getLogger('books-response').error({ err }, 'failed to delete book');
          throw err;
        }
      });
    }
  );
};
