import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { jobsService } from './jobs.service';
import { createLogger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { logAudit } from '../../lib/helpers/audit_utils';

const logger = createLogger('jobs-routes');

// Validation schemas
const createJobSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  cron: z.string().min(9).max(100), // Minimum valid cron: "* * * * *"
  timezone: z.string().max(50).optional(),
  handler: z.string().min(1).max(100),
  payload: z.unknown().optional(),
  isEnabled: z.boolean().optional(),
});

const updateJobSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cron: z.string().min(9).max(100).optional(),
  timezone: z.string().max(50).optional(),
  handler: z.string().min(1).max(100).optional(),
  payload: z.unknown().optional(),
  isEnabled: z.boolean().optional(),
});

export const jobsRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication and admin permission
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings', 'view'));

  // GET /api/jobs - List all scheduled jobs
  app.get('/', async () => {
    const jobs = await jobsService.getAll();
    return { data: jobs };
  });

  // GET /api/jobs/stats - Get job statistics
  app.get('/stats', async () => {
    const stats = await jobsService.getStats();
    return { data: stats };
  });

  // GET /api/jobs/handlers - Get available handlers
  app.get('/handlers', async () => {
    const handlers = jobsService.getHandlers();
    return { data: handlers };
  });

  // POST /api/jobs/parse-cron - Parse and validate cron expression
  app.post<{
    Body: { cron: string };
  }>('/parse-cron', async (request) => {
    const { cron } = request.body;
    const result = jobsService.parseCron(cron);
    return { data: result };
  });

  // GET /api/jobs/:id - Get job details
  app.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const job = await jobsService.getById(request.params.id);

    if (!job) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return { data: job };
  });

  // GET /api/jobs/:id/history - Get job run history
  app.get<{
    Params: { id: string };
    Querystring: { limit?: number };
  }>('/:id/history', async (request) => {
    const { id } = request.params;
    const limit = request.query.limit ?? 50;
    const history = await jobsService.getRunHistory(id, limit);
    return { data: history };
  });

  // POST /api/jobs - Create new job
  app.post<{
    Body: z.infer<typeof createJobSchema>;
  }>(
    '/',
    {
      preHandler: [app.requirePermission('settings', 'create')],
    },
    async (request, reply) => {
      const input = createJobSchema.parse(request.body);

      // Validate cron
      const cronValidation = jobsService.parseCron(input.cron);
      if (!cronValidation.valid) {
        return reply.status(400).send({
          error: { code: 'INVALID_CRON', message: cronValidation.error },
        });
      }

      // Validate handler exists
      const handlers = jobsService.getHandlers();
      if (!handlers.includes(input.handler)) {
        return reply.status(400).send({
          error: { code: 'INVALID_HANDLER', message: `Unknown handler: ${input.handler}` },
        });
      }

      const job = await jobsService.create(input);

      await logAudit(request.user.id, 'create', 'scheduled_job', job.id, input, request);

      logger.info({ jobId: job.id, userId: request.user.id }, 'Job created');

      return reply.status(201).send({
        message: 'Job created successfully',
        data: job,
      });
    }
  );

  // PUT /api/jobs/:id - Update job
  app.put<{
    Params: { id: string };
    Body: z.infer<typeof updateJobSchema>;
  }>(
    '/:id',
    {
      preHandler: [app.requirePermission('settings', 'edit')],
    },
    async (request, reply) => {
      const { id } = request.params;
      const input = updateJobSchema.parse(request.body);

      // Validate cron if provided
      if (input.cron) {
        const cronValidation = jobsService.parseCron(input.cron);
        if (!cronValidation.valid) {
          return reply.status(400).send({
            error: { code: 'INVALID_CRON', message: cronValidation.error },
          });
        }
      }

      // Validate handler if provided
      if (input.handler) {
        const handlers = jobsService.getHandlers();
        if (!handlers.includes(input.handler)) {
          return reply.status(400).send({
            error: { code: 'INVALID_HANDLER', message: `Unknown handler: ${input.handler}` },
          });
        }
      }

      const job = await jobsService.update(id, input);

      if (!job) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }

      await logAudit(request.user.id, 'update', 'scheduled_job', id, input, request);

      logger.info({ jobId: id, userId: request.user.id }, 'Job updated');

      return {
        message: 'Job updated successfully',
        data: job,
      };
    }
  );

  // DELETE /api/jobs/:id - Delete job
  app.delete<{
    Params: { id: string };
  }>(
    '/:id',
    {
      preHandler: [app.requirePermission('settings', 'delete')],
    },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await jobsService.delete(id);

      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }

      await logAudit(request.user.id, 'delete', 'scheduled_job', id, undefined, request);

      logger.info({ jobId: id, userId: request.user.id }, 'Job deleted');

      return { message: 'Job deleted successfully' };
    }
  );

  // POST /api/jobs/:id/enable - Enable job
  app.post<{
    Params: { id: string };
  }>(
    '/:id/enable',
    {
      preHandler: [app.requirePermission('settings', 'edit')],
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const job = await jobsService.setEnabled(id, true);

        await logAudit(request.user.id, 'enable', 'scheduled_job', id, undefined, request);

        return { message: 'Job enabled', data: job };
      } catch {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }
    }
  );

  // POST /api/jobs/:id/disable - Disable job
  app.post<{
    Params: { id: string };
  }>(
    '/:id/disable',
    {
      preHandler: [app.requirePermission('settings', 'edit')],
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const job = await jobsService.setEnabled(id, false);

        await logAudit(request.user.id, 'disable', 'scheduled_job', id, undefined, request);

        return { message: 'Job disabled', data: job };
      } catch {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }
    }
  );

  // POST /api/jobs/:id/trigger - Manually trigger job
  app.post<{
    Params: { id: string };
  }>(
    '/:id/trigger',
    {
      preHandler: [app.requirePermission('settings', 'edit')],
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await jobsService.triggerJob(id, request.user.id);

        await logAudit(
          request.user.id,
          'trigger',
          'scheduled_job',
          id,
          { runId: result.runId },
          request
        );

        return {
          message: result.status === 'COMPLETED' ? 'Job completed successfully' : 'Job failed',
          data: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to trigger job';
        return reply.status(400).send({
          error: { code: 'JOB_TRIGGER_ERROR', message },
        });
      }
    }
  );

  // GET /api/jobs/runs/:runId - Get run details
  app.get<{
    Params: { runId: string };
  }>('/runs/:runId', async (request, reply) => {
    const run = await jobsService.getRunDetails(request.params.runId);

    if (!run) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Run not found' },
      });
    }

    return { data: run };
  });

  // POST /api/jobs/runs/:runId/cancel - Cancel a running job
  app.post<{
    Params: { runId: string };
  }>(
    '/runs/:runId/cancel',
    {
      preHandler: [app.requirePermission('settings', 'edit')],
    },
    async (request, reply) => {
      const { runId } = request.params;
      const cancelled = await jobsService.cancelRun(runId);

      if (!cancelled) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Run not found' },
        });
      }

      await logAudit(request.user.id, 'cancel', 'scheduled_job_run', runId, undefined, request);

      return { message: 'Run cancelled' };
    }
  );
};
