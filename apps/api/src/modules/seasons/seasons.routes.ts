import type { FastifyPluginAsync } from 'fastify';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import * as service from './seasons.service';
import {
  getSeasonsQuerySchema,
  exportSeasonsQuerySchema,
  getSeasonParamsSchema,
  nameAvailableQuerySchema,
  createSeasonSchema,
  updateSeasonSchema,
} from './seasons.schema';
import { logAudit } from '../../lib/helpers/audit_utils';
import { exportService, type ExportColumn } from '../exports/export.service';

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'seasonsId', header: 'ID', width: 10 },
  { key: 'season', header: 'Season', width: 30 },
  { key: 'sort', header: 'Sort', width: 10 },
  { key: 'created', header: 'Created', width: 20 },
];

export const seasonsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/seasons
  app.get(
    '/',
    {
      preHandler: [app.requirePermission('seasons:view')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = getSeasonsQuerySchema.parse(request.query);
          const result = await service.getSeasons(query);

          getLogger('seasons-response').info(
            { status: 200, total: result.meta.total },
            'seasons fetched successfully'
          );

          return reply.send({
            data: result.data,
            meta: result.meta,
          });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to fetch seasons');
          throw err;
        }
      });
    }
  );

  // GET /api/seasons/next-sort
  app.get(
    '/next-sort',
    {
      preHandler: [app.requirePermission('seasons:view')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info({ method: 'GET', url: request.url }, 'incoming request');

        try {
          const result = await service.getNextSort();

          getLogger('seasons-response').info(
            { status: 200, nextSort: result.nextSort },
            'next sort fetched successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to fetch next sort');
          throw err;
        }
      });
    }
  );

  // GET /api/seasons/export
  app.get(
    '/export',
    {
      preHandler: [app.requirePermission('seasons:view')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const { format, ...filters } = exportSeasonsQuerySchema.parse(request.query);
          const seasons = await service.getSeasonsForExport(filters);

          const { buffer, mimeType, extension } = await exportService.export(format, {
            filename: 'seasons-export',
            columns: EXPORT_COLUMNS,
            data: seasons as unknown as Record<string, unknown>[],
            title: 'Seasons Export',
          });

          await logAudit(
            request.user.sub,
            'export',
            'season',
            'all',
            { format, ...filters, count: seasons.length },
            request
          );

          getLogger('seasons-response').info(
            { status: 200, format, count: seasons.length },
            'seasons exported successfully'
          );

          const dateStr = new Date().toISOString().split('T')[0];

          return reply
            .header('Content-Type', mimeType)
            .header('Content-Disposition', `attachment; filename="seasons-${dateStr}.${extension}"`)
            .send(buffer);
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to export seasons');
          throw err;
        }
      });
    }
  );

  // GET /api/seasons/:id
  app.get(
    '/:id',
    {
      preHandler: [app.requirePermission('seasons:view')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'GET', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = getSeasonParamsSchema.parse(request.params);
          const season = await service.getSeasonById(id);

          getLogger('seasons-response').info({ status: 200, id }, 'season fetched successfully');

          return reply.send({ data: season });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to fetch season');
          throw err;
        }
      });
    }
  );

  // GET /api/seasons/name-check
  app.get(
    '/name-check',
    {
      preHandler: [app.requirePermission('seasons:view')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const { season, excludeId } = nameAvailableQuerySchema.parse(request.query);
          const result = await service.checkNameAvailable(season, excludeId);

          getLogger('seasons-response').info(
            { status: 200, available: result.available },
            'name availability checked successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to check name availability');
          throw err;
        }
      });
    }
  );

  // POST /api/seasons
  app.post(
    '/',
    {
      preHandler: [app.requirePermission('seasons:create')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'POST', url: request.url, body: request.body },
          'incoming request'
        );

        try {
          const input = createSeasonSchema.parse(request.body);
          const season = await service.createSeason(input);

          await logAudit(
            request.user.sub,
            'create',
            'season',
            String(season.seasonsId),
            input,
            request
          );

          getLogger('seasons-response').info(
            { status: 201, seasonsId: season.seasonsId },
            'season created successfully'
          );

          return reply.status(201).send({ data: season });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to create season');
          throw err;
        }
      });
    }
  );

  // PUT /api/seasons/:id
  app.put(
    '/:id',
    {
      preHandler: [app.requirePermission('seasons:edit')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'PUT', url: request.url, params: request.params, body: request.body },
          'incoming request'
        );

        try {
          const { id } = getSeasonParamsSchema.parse(request.params);
          const input = updateSeasonSchema.parse(request.body);

          const season = await service.updateSeason(id, input);

          await logAudit(request.user.sub, 'update', 'season', String(id), input, request);

          getLogger('seasons-response').info(
            { status: 200, seasonsId: id },
            'season updated successfully'
          );

          return reply.send({ data: season });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to update season');
          throw err;
        }
      });
    }
  );

  // DELETE /api/seasons/:id
  app.delete(
    '/:id',
    {
      preHandler: [app.requirePermission('seasons:delete')],
    },
    async (request, reply) => {
      return runWithExecution('seasons', async () => {
        getLogger('seasons-request').info(
          { method: 'DELETE', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = getSeasonParamsSchema.parse(request.params);

          const result = await service.deleteSeason(id);

          await logAudit(request.user.sub, 'delete', 'season', String(id), undefined, request);

          getLogger('seasons-response').info(
            { status: 200, seasonsId: id },
            'season deleted successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('seasons-response').error({ err }, 'failed to delete season');
          throw err;
        }
      });
    }
  );
};
