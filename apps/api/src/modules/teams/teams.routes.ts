import type { FastifyPluginAsync } from 'fastify';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import * as service from './teams.service';
import {
  getTeamsQuerySchema,
  exportTeamsQuerySchema,
  getTeamParamsSchema,
  nameAvailableQuerySchema,
  createTeamSchema,
  updateTeamSchema,
} from './teams.schema';
import { logAudit } from '../../lib/helpers/audit_utils';
import { exportService, type ExportColumn } from '../exports/export.service';

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'teamsId', header: 'ID', width: 10 },
  { key: 'teamName', header: 'Team Name', width: 30 },
  { key: 'sort', header: 'Sort', width: 10 },
  { key: 'created', header: 'Created', width: 20 },
];

export const teamsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/teams
  app.get(
    '/',
    {
      preHandler: [app.requirePermission('teams:view')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = getTeamsQuerySchema.parse(request.query);
          const result = await service.getTeams(query);

          getLogger('teams-response').info(
            { status: 200, total: result.meta.total },
            'teams fetched successfully'
          );

          return reply.send({
            data: result.data,
            meta: result.meta,
          });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to fetch teams');
          throw err;
        }
      });
    }
  );

  // GET /api/teams/next-sort
  app.get(
    '/next-sort',
    {
      preHandler: [app.requirePermission('teams:view')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info({ method: 'GET', url: request.url }, 'incoming request');

        try {
          const result = await service.getNextSort();

          getLogger('teams-response').info(
            { status: 200, nextSort: result.nextSort },
            'next sort fetched successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to fetch next sort');
          throw err;
        }
      });
    }
  );

  // GET /api/teams/name-available
  app.get(
    '/name-available',
    {
      preHandler: [app.requirePermission('teams:view')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const { name, excludeId } = nameAvailableQuerySchema.parse(request.query);
          const result = await service.checkNameAvailable(name, excludeId);

          getLogger('teams-response').info(
            { status: 200, available: result.available },
            'name availability checked successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to check name availability');
          throw err;
        }
      });
    }
  );

  // GET /api/teams/export
  app.get(
    '/export',
    {
      preHandler: [app.requirePermission('teams:view')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const { format, ...filters } = exportTeamsQuerySchema.parse(request.query);
          const teams = await service.getTeamsForExport(filters);

          const { buffer, mimeType, extension } = await exportService.export(format, {
            filename: 'teams-export',
            columns: EXPORT_COLUMNS,
            data: teams as unknown as Record<string, unknown>[],
            title: 'Teams Export',
          });

          await logAudit(
            request.user.sub,
            'export',
            'team',
            'all',
            { format, ...filters, count: teams.length },
            request
          );

          getLogger('teams-response').info(
            { status: 200, format, count: teams.length },
            'teams exported successfully'
          );

          const dateStr = new Date().toISOString().split('T')[0];

          return reply
            .header('Content-Type', mimeType)
            .header('Content-Disposition', `attachment; filename="teams-${dateStr}.${extension}"`)
            .send(buffer);
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to export teams');
          throw err;
        }
      });
    }
  );

  // GET /api/teams/:id
  app.get(
    '/:id',
    {
      preHandler: [app.requirePermission('teams:view')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'GET', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = getTeamParamsSchema.parse(request.params);
          const team = await service.getTeamById(id);

          getLogger('teams-response').info({ status: 200, id }, 'team fetched successfully');

          return reply.send({ data: team });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to fetch team');
          throw err;
        }
      });
    }
  );

  // POST /api/teams
  app.post(
    '/',
    {
      preHandler: [app.requirePermission('teams:create')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'POST', url: request.url, body: request.body },
          'incoming request'
        );

        try {
          const input = createTeamSchema.parse(request.body);
          const team = await service.createTeam(input);

          await logAudit(request.user.sub, 'create', 'team', String(team.teamsId), input, request);

          getLogger('teams-response').info(
            { status: 201, teamsId: team.teamsId },
            'team created successfully'
          );

          return reply.status(201).send({ data: team });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to create team');
          throw err;
        }
      });
    }
  );

  // PUT /api/teams/:id
  app.put(
    '/:id',
    {
      preHandler: [app.requirePermission('teams:edit')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'PUT', url: request.url, params: request.params, body: request.body },
          'incoming request'
        );

        try {
          const { id } = getTeamParamsSchema.parse(request.params);
          const input = updateTeamSchema.parse(request.body);

          const team = await service.updateTeam(id, input);

          await logAudit(request.user.sub, 'update', 'team', String(id), input, request);

          getLogger('teams-response').info(
            { status: 200, teamsId: id },
            'team updated successfully'
          );

          return reply.send({ data: team });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to update team');
          throw err;
        }
      });
    }
  );

  // DELETE /api/teams/:id
  app.delete(
    '/:id',
    {
      preHandler: [app.requirePermission('teams:delete')],
    },
    async (request, reply) => {
      return runWithExecution('teams', async () => {
        getLogger('teams-request').info(
          { method: 'DELETE', url: request.url, params: request.params },
          'incoming request'
        );

        try {
          const { id } = getTeamParamsSchema.parse(request.params);

          const result = await service.deleteTeam(id);

          await logAudit(request.user.sub, 'delete', 'team', String(id), undefined, request);

          getLogger('teams-response').info(
            { status: 200, teamsId: id },
            'team deleted successfully'
          );

          return reply.send({ data: result });
        } catch (err) {
          getLogger('teams-response').error({ err }, 'failed to delete team');
          throw err;
        }
      });
    }
  );
};
