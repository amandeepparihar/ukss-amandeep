import {
  createBookSchema,
  updateBookSchema,
  bookIdSchema,
  listBooksQuery,
  // exportBooksQuery,
} from './books.schema';
import { FastifyPluginAsync } from 'fastify';
import { getLogger } from '../../lib/logger-context';
import * as service from './books.service';
// import { storageProvider } from '../../lib/storage';

export const bookRoutes: FastifyPluginAsync = async (app) => {
  //GET all books
  app.get(
    '/',
    {
      preHandler: [app.requirePermission('books:view')],
    },
    async (request, reply) => {
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
    }
  );

  //get book by id
  app.get('/:id', { preHandler: [app.requirePermission('books:view')] }, async (request, reply) => {
    getLogger('book-request').info(
      { method: 'GET', url: request.url, query: request.query },
      'incoming request'
    );

    try {
      const { id } = bookIdSchema.parse(request.params);
      const result = await service.getBook(id);

      getLogger('book-reponse').info({ status: 200 }, 'book fetched successfully');

      return reply.send({
        data: result,
      });
    } catch (err) {
      getLogger('book-reponse').error({ err }, 'failed to fetch book');
      throw err;
    }
  });

  //create book
  app.post('/', { preHandler: [app.requirePermission('books:create')] }, async (request, reply) => {
    getLogger('book-request').info(
      { method: 'POST', url: request.url, body: request.body },
      'incoming request'
    );

    try {
      const input = createBookSchema.parse(request.body);
      const book = await service.createBook(input);

      getLogger('book-response').info(
        { status: 201, bookId: book.id },
        'book created successfully'
      );

      return reply.status(201).send({ data: book });
    } catch (err) {
      getLogger('book-response').error({ err }, 'failed to create book');
      throw err;
    }
  });

  //PUT update book
  app.put('/:id', { preHandler: [app.requirePermission('books:edit')] }, async (request, reply) => {
    getLogger('book-request').info(
      { method: 'PUT', url: request.url, body: request.body },
      'incoming request'
    );

    try {
      const { id } = bookIdSchema.parse(request.params);
      const input = updateBookSchema.parse(request.body);
      const result = await service.updateBook(id, input);

      getLogger('book-response').info(
        { status: 200, bookId: result.id },
        'book updated successfully'
      );

      return reply.status(200).send({ data: result });
    } catch (err) {
      getLogger('book-reponse').error({ err }, 'failed to update book');
      throw err;
    }
  });

  //delete book
  app.delete(
    '/:id',
    { preHandler: [app.requirePermission('books:delete')] },
    async (request, reply) => {
      getLogger('book-request').info(
        { method: 'DEL', url: request.url, body: request.body },
        'incoming request'
      );

      try {
        const { id } = bookIdSchema.parse(request.params);
        const result = service.deleteBook(id);

        getLogger('book-reponse').info({ status: 200, bookId: id }, 'book deleted successfully');

        return reply.status(200).send({ data: result });
      } catch (err) {
        getLogger('book-reponse').error({ err }, 'failed to delete book');
        throw err;
      }
    }
  );

  /*
  //export books as excel
  app.get(
    '/export.xlsx',
    { preHandler: [app.authenticate] },

    { schema: { querystring: exportBooksQuery } },
    async (request, reply) => {
      const books = await findBooksForExport(request.query);

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Books');
      ws.columns = [
        { header: 'Id', key: 'id', width: 8 },
        { header: 'Book Name', key: 'bookName', width: 20 },
        { header: 'Author Name', key: 'authorName', width: 20 },
        { header: 'ISBN', key: 'isbn', width: 20 },
        { header: 'Created At', key: 'createdAt', width: 20 },
      ];
      ws.addRows(books);

      const buffer = await wb.xlsx.writeBuffer();

      reply.header(
        'Content-Type',
        'pplication/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      reply.header('Content-Disposition', 'attachment; filename="books.xlsx"');

      return reply.send(Buffer.from(buffer));
    }
  );

  //export books as csv
  app.get(
    '/export.csv',
    { preHandler: [app.authenticate] },
    { schema: { querystring: exportBooksQuery } },
    async (request, reply) => {
      const books = await findBooksForExport(request.query);
      const csv = Papa.unparse(
        books.map((b) => ({
          Id: b.id,
          Name: b.bookName,
          Author: b.authorName,
          ISBN: b.isbn,
        }))
      );
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="books.csv"');
      return csv;
    }
  );

  //export book by id in pdf
  app.get(
    '/:id/details.pdf',
    { preHandler: [app.authenticate] },

    { schema: { params: bookIdSchema } },
    async (request, reply) => {
      const book = await getBook(request.params.id);

      if (!book) {
        throw httpError('Not found', 404);
      }

      const doc = new PDFDocument({ size: 'A4', margin: 40 });

      doc.fontSize(20).text(book.bookName);
      doc.moveDown().fontSize(12).text(`Author: ${book.authorName}`);
      doc.text(`ISBN: ${book.isbn}`);
      doc.text(`Created: ${book.createdAt.toISOString().slice(0, 10)}`);
      doc.end();

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="book-${book.id}.pdf"`);

      return reply.send(doc);
    }
  );

  //bluk upload
  app.post(
    '/bulk',
    { preHandler: [app.authenticate] },

    async (request, reply) => {
      const part = await request.file();
      if (!part) {
        throw httpError('No file', 404);
      }
      if (path.extname(part.filename).toLowerCase() !== '.csv') {
        part.file.resume();
        throw httpError('Only .csv files are allowed', 400);
      }

      const text = (await part.toBuffer()).toString('utf8');
      const result = await createBulkBooks(text);

      request.log.info(
        { created: result.created, failed: result.failed.length },
        'bulk upload done'
      );

      return reply.status(200).send({ data: result });
    }
  );
   */
};
