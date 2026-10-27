/**
 * @taskId #165096
 * Debenhams Delta Products Upload routes.
 * Registered at /api/debenhams-inventory-upload — separate from /api/debenhams.
 */
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { DownloadFilenameParamsSchema } from './debenhams-inventory-upload.schema';
import { DebenhamsInventoryUploadService } from './debenhams-inventory-upload.service';

export async function debenhamsInventoryUploadRoutes(app: FastifyInstance): Promise<void> {

  // GET /template — public, no auth needed (static column headers, no sensitive data)
  // Cannot use requirePermission here: browser <a download> does not send JWT Authorization header.
  app.get('/template', async (_req, reply) => {
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="debenhams_upload_template.csv"');
    return reply.send('sku,ean,customisationgroup\n');
  });

  // POST /upload — synchronous, 5-min timeout
  app.post('/upload', { preHandler: [app.requirePermission('debenhams-inventory-upload', 'create')] }, async (request, reply) => {
    reply.raw.setTimeout(5 * 60 * 1000);

    const data = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });
    if (data.mimetype !== 'text/csv' && !data.filename?.endsWith('.csv')) {
      return reply.status(400).send({ error: 'Only .csv files are accepted' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) return reply.status(400).send({ error: 'File is empty' });

    const service = new DebenhamsInventoryUploadService();
    const result = await service.processUpload(buffer, data.filename ?? 'upload.csv');
    return reply.send({ data: result });
  });

  // GET /download/:filename — stream file (never readFile into memory)
  app.get<{ Params: { filename: string } }>(
    '/download/:filename',
    { preHandler: [app.requirePermission('debenhams-inventory-upload', 'view')] },
    async (request, reply) => {
      const { filename } = request.params;

      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }
      if (!/^debenhams_offers_\d{14}\.csv$/.test(filename)) {
        return reply.status(400).send({ error: 'Invalid filename format' });
      }

      const filePath = path.join(process.cwd(), 'temp', 'debenhams', filename);
      try {
        await fs.access(filePath);
      } catch {
        return reply.status(404).send({ error: 'File not found' });
      }

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(createReadStream(filePath));
    },
  );

  // GET /imports — last 10 import logs
  app.get('/imports', { preHandler: [app.requirePermission('debenhams-inventory-upload', 'view')] }, async (_req, reply) => {
    const logs = await prisma.debenhamsImportLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return reply.send({ data: logs });
  });
}
