/**
 * Shopify Inventory Sync routes.
 * Registered at /api/shopify-inventory-sync.
 */
import type { FastifyInstance } from 'fastify';
import { CompareRequestSchema, ApplyUpdatesRequestSchema } from './shopify-inventory-sync.schema';
import { ShopifyInventorySyncService } from './shopify-inventory-sync.service';

export async function shopifyInventorySyncRoutes(app: FastifyInstance): Promise<void> {
  const service = new ShopifyInventorySyncService();

  // GET /stores — list Shopify stores with export file status
  app.get('/stores', {
    preHandler: [app.requirePermission('shopify-inventory-sync:view')],
  }, async (_request, reply) => {
    const stores = await service.getStores();
    return reply.send({ data: stores });
  });

  // POST /compare — parse Excel and compare with DB
  app.post('/compare', {
    preHandler: [app.requirePermission('shopify-inventory-sync:create')],
  }, async (request, reply) => {
    try {
      reply.raw.setTimeout(5 * 60 * 1000);

      const body = CompareRequestSchema.parse(request.body);
      const { storeId } = body;

      // Get store name for the response
      const storeName = await service.getStoreName(storeId);
      if (!storeName) {
        return reply.status(404).send({ error: `Store ${storeId} not found` });
      }

      const exportFile = await service.getExportFile(storeId);
      const parsed = service.parseExcel(exportFile.filePath);

      const result = await service.compareWithDb(
        storeId,
        storeName,
        exportFile.fileName,
        parsed.rows,
        parsed.skipped,
      );

      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Compare failed');
      return reply.status(500).send({ error: message });
    }
  });

  // POST /upload — upload Excel file, save to store dir, and compare with DB
  app.post('/upload', {
    preHandler: [app.requirePermission('shopify-inventory-sync:create')],
  }, async (request, reply) => {
    try {
      reply.raw.setTimeout(5 * 60 * 1000);

      const data = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      if (!data.filename?.endsWith('.xlsx')) {
        return reply.status(400).send({ error: 'Only .xlsx files are accepted' });
      }

      // Extract storeId from multipart fields
      // @fastify/multipart fields can be MultipartValue or MultipartValue[]
      const storeIdField = data.fields?.storeId as { value?: string } | undefined;
      const storeIdValue = storeIdField?.value;
      const storeId = Number(storeIdValue);
      if (!Number.isFinite(storeId) || storeId <= 0) {
        return reply.status(400).send({ error: `Valid storeId is required (got: ${JSON.stringify(storeIdValue)})` });
      }

      // Verify store exists
      const storeName = await service.getStoreName(storeId);
      if (!storeName) {
        return reply.status(404).send({ error: `Store ${storeId} not found` });
      }

      const buffer = await data.toBuffer();
      if (buffer.length === 0) return reply.status(400).send({ error: 'File is empty' });

      // Save file to store directory
      await service.saveUploadedFile(storeId, buffer, data.filename);

      // Parse and compare
      const parsed = service.parseExcelFromBuffer(buffer);

      const result = await service.compareWithDb(
        storeId,
        storeName,
        data.filename,
        parsed.rows,
        parsed.skipped,
      );

      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Upload failed');
      return reply.status(500).send({ error: message });
    }
  });

  // POST /apply — bulk update DB with confirmed mismatches
  app.post('/apply', {
    preHandler: [app.requirePermission('shopify-inventory-sync:create')],
  }, async (request, reply) => {
    try {
      const body = ApplyUpdatesRequestSchema.parse(request.body);
      const result = await service.applyUpdates(body.storeId, body.updates);
      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Apply failed');
      return reply.status(500).send({ error: message });
    }
  });
}
