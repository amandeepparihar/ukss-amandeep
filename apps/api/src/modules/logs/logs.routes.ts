import type { FastifyPluginAsync } from 'fastify';
import { logsService } from './logs.service';
import { logQuerySchema } from './logs.schema';
import { createLogger } from '../../lib/logger';

const logger = createLogger('logs-routes');

export const logsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // GET /api/logs/modules — list modules that have a log.txt
  app.get('/modules', {
    preHandler: [app.requirePermission('logs', 'view')],
  }, async () => {
    return { data: logsService.listModules() };
  });

  // GET /api/logs/:module — paginated, filtered page (newest-first)
  app.get<{ Params: { module: string } }>('/:module', {
    preHandler: [app.requirePermission('logs', 'view')],
  }, async (request, reply) => {
    const query = logQuerySchema.parse(request.query);
    try {
      const page = logsService.readPage(request.params.module, query);
      return { data: page };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read logs';
      logger.warn({ module: request.params.module, error: message }, 'Log read failed');
      return reply.status(400).send({ error: { code: 'INVALID_MODULE', message } });
    }
  });

  // GET /api/logs/:module/export — download filtered slice as NDJSON
  app.get<{ Params: { module: string } }>('/:module/export', {
    preHandler: [app.requirePermission('logs', 'view')],
  }, async (request, reply) => {
    const query = logQuerySchema.parse(request.query);
    try {
      const lines = logsService.collectForExport(request.params.module, query);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `logs_${request.params.module}_${timestamp}.ndjson`;
      reply.header('Content-Type', 'application/x-ndjson');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return lines.join('\n') + (lines.length ? '\n' : '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export logs';
      return reply.status(400).send({ error: { code: 'INVALID_MODULE', message } });
    }
  });
};
