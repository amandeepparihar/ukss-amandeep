import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { ScheduledJobStatus } from '@prisma/client';
import * as cronParser from 'cron-parser';

const logger = createLogger('jobs');

// Job handlers registry
type JobHandler = (payload: unknown) => Promise<{ result?: unknown; logs?: string }>;
const handlers = new Map<string, JobHandler>();

export interface CreateJobInput {
  name: string;
  description?: string;
  cron: string;
  timezone?: string;
  handler: string;
  payload?: unknown;
  isEnabled?: boolean;
}

export interface UpdateJobInput {
  name?: string;
  description?: string;
  cron?: string;
  timezone?: string;
  handler?: string;
  payload?: unknown;
  isEnabled?: boolean;
}

export class JobsService {
  /**
   * Register a job handler
   */
  registerHandler(name: string, handler: JobHandler): void {
    handlers.set(name, handler);
    logger.info({ handler: name }, 'Job handler registered');
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): string[] {
    return Array.from(handlers.keys());
  }

  /**
   * Get all scheduled jobs
   */
  async getAll(): Promise<Array<{
    id: string;
    name: string;
    description: string | null;
    cron: string;
    timezone: string;
    handler: string;
    payload: unknown;
    isEnabled: boolean;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lastRun: {
      status: ScheduledJobStatus;
      startedAt: Date;
      duration: number | null;
    } | null;
  }>> {
    const jobs = await prisma.scheduledJob.findMany({
      orderBy: { name: 'asc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      cron: job.cron,
      timezone: job.timezone,
      handler: job.handler,
      payload: job.payload,
      isEnabled: job.isEnabled,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      lastRun: job.runs[0] ? {
        status: job.runs[0].status,
        startedAt: job.runs[0].startedAt,
        duration: job.runs[0].duration,
      } : null,
    }));
  }

  /**
   * Get job by ID
   */
  async getById(id: string) {
    return prisma.scheduledJob.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * Create a new scheduled job
   */
  async create(input: CreateJobInput) {
    // Validate cron expression
    const nextRunAt = this.getNextRunTime(input.cron, input.timezone);

    const job = await prisma.scheduledJob.create({
      data: {
        name: input.name,
        description: input.description,
        cron: input.cron,
        timezone: input.timezone ?? 'UTC',
        handler: input.handler,
        payload: input.payload as object ?? undefined,
        isEnabled: input.isEnabled ?? true,
        nextRunAt,
      },
    });

    logger.info({ jobId: job.id, name: job.name }, 'Scheduled job created');
    return job;
  }

  /**
   * Update a scheduled job
   */
  async update(id: string, input: UpdateJobInput) {
    const existing = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!existing) return null;

    // Recalculate next run time if cron changed
    let nextRunAt = existing.nextRunAt;
    if (input.cron || input.timezone) {
      nextRunAt = this.getNextRunTime(
        input.cron ?? existing.cron,
        input.timezone ?? existing.timezone
      );
    }

    const job = await prisma.scheduledJob.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        cron: input.cron,
        timezone: input.timezone,
        handler: input.handler,
        payload: input.payload as object ?? undefined,
        isEnabled: input.isEnabled,
        nextRunAt,
      },
    });

    logger.info({ jobId: job.id, name: job.name }, 'Scheduled job updated');
    return job;
  }

  /**
   * Delete a scheduled job
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.scheduledJob.delete({ where: { id } });
      logger.info({ jobId: id }, 'Scheduled job deleted');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enable/disable a job
   */
  async setEnabled(id: string, isEnabled: boolean) {
    const job = await prisma.scheduledJob.update({
      where: { id },
      data: {
        isEnabled,
        nextRunAt: isEnabled ? this.getNextRunTimeForJob(id) : null,
      },
    });

    logger.info({ jobId: id, isEnabled }, 'Job enabled status changed');
    return job;
  }

  /**
   * Manually trigger a job
   */
  async triggerJob(id: string, triggeredBy: string): Promise<{
    runId: string;
    status: ScheduledJobStatus;
    duration: number;
    result?: unknown;
    error?: string;
    logs?: string;
  }> {
    const job = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!job) {
      throw new Error('Job not found');
    }

    const handler = handlers.get(job.handler);
    if (!handler) {
      throw new Error(`Handler not found: ${job.handler}`);
    }

    // Create run record
    const run = await prisma.scheduledJobRun.create({
      data: {
        jobId: id,
        triggeredBy,
        status: 'RUNNING',
      },
    });

    const startTime = Date.now();
    let status: ScheduledJobStatus = 'COMPLETED';
    let result: unknown;
    let error: string | undefined;
    let logs: string | undefined;

    try {
      const output = await handler(job.payload);
      result = output.result;
      logs = output.logs;
    } catch (err) {
      status = 'FAILED';
      error = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: id, error }, 'Job execution failed');
    }

    const duration = Date.now() - startTime;

    // Update run record
    await prisma.scheduledJobRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        duration,
        result: result as object ?? undefined,
        error,
        logs,
      },
    });

    // Update job last run time
    await prisma.scheduledJob.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: job.isEnabled ? this.getNextRunTime(job.cron, job.timezone) : null,
      },
    });

    return { runId: run.id, status, duration, result, error, logs };
  }

  /**
   * Get job run history
   */
  async getRunHistory(jobId: string, limit: number = 50) {
    return prisma.scheduledJobRun.findMany({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get run details
   */
  async getRunDetails(runId: string) {
    return prisma.scheduledJobRun.findUnique({
      where: { id: runId },
      include: { job: true },
    });
  }

  /**
   * Cancel a running job
   */
  async cancelRun(runId: string): Promise<boolean> {
    try {
      await prisma.scheduledJobRun.update({
        where: { id: runId },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse cron expression and return human-readable description
   */
  parseCron(cron: string): {
    valid: boolean;
    description?: string;
    nextRuns?: string[];
    error?: string;
  } {
    try {
      const interval = cronParser.parseExpression(cron, { utc: true });
      const nextRuns: string[] = [];

      for (let i = 0; i < 5; i++) {
        nextRuns.push(interval.next().toISOString());
      }

      return {
        valid: true,
        description: this.cronToDescription(cron),
        nextRuns,
      };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid cron expression',
      };
    }
  }

  /**
   * Get jobs due to run
   */
  async getDueJobs(): Promise<string[]> {
    const now = new Date();
    const jobs = await prisma.scheduledJob.findMany({
      where: {
        isEnabled: true,
        nextRunAt: { lte: now },
      },
      select: { id: true },
    });

    return jobs.map(j => j.id);
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    totalJobs: number;
    enabledJobs: number;
    disabledJobs: number;
    todayRuns: number;
    successRate: number;
    failedToday: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalJobs,
      enabledJobs,
      todayRuns,
      failedToday,
    ] = await Promise.all([
      prisma.scheduledJob.count(),
      prisma.scheduledJob.count({ where: { isEnabled: true } }),
      prisma.scheduledJobRun.count({ where: { startedAt: { gte: todayStart } } }),
      prisma.scheduledJobRun.count({
        where: {
          startedAt: { gte: todayStart },
          status: 'FAILED',
        },
      }),
    ]);

    const successRate = todayRuns > 0
      ? Math.round(((todayRuns - failedToday) / todayRuns) * 100)
      : 100;

    return {
      totalJobs,
      enabledJobs,
      disabledJobs: totalJobs - enabledJobs,
      todayRuns,
      successRate,
      failedToday,
    };
  }

  /**
   * Helper: Calculate next run time
   */
  private getNextRunTime(cron: string, timezone?: string): Date | null {
    try {
      const interval = cronParser.parseExpression(cron, {
        tz: timezone ?? 'UTC',
      });
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  /**
   * Helper: Get next run time for existing job
   */
  private async getNextRunTimeForJob(id: string): Promise<Date | null> {
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
      select: { cron: true, timezone: true },
    });

    if (!job) return null;
    return this.getNextRunTime(job.cron, job.timezone);
  }

  /**
   * Helper: Convert cron to human-readable description
   */
  private cronToDescription(cron: string): string {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Common patterns
    if (cron === '* * * * *') return 'Every minute';
    if (cron === '0 * * * *') return 'Every hour';
    if (cron === '0 0 * * *') return 'Daily at midnight';
    if (cron === '0 0 * * 0') return 'Weekly on Sunday at midnight';
    if (cron === '0 0 1 * *') return 'Monthly on the 1st at midnight';

    // Build description
    const descriptions: string[] = [];

    if (minute !== '*' && hour !== '*') {
      descriptions.push(`At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
    } else if (minute === '0' && hour === '*') {
      descriptions.push('Every hour');
    } else if (minute !== '*') {
      descriptions.push(`At minute ${minute}`);
    }

    if (dayOfMonth !== '*') {
      descriptions.push(`on day ${dayOfMonth}`);
    }

    if (month !== '*') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      descriptions.push(`in ${months[parseInt(month) - 1] || month}`);
    }

    if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      descriptions.push(`on ${days[parseInt(dayOfWeek)] || dayOfWeek}`);
    }

    return descriptions.length > 0 ? descriptions.join(' ') : cron;
  }
}

export const jobsService = new JobsService();

// Register built-in job handlers
jobsService.registerHandler('cleanup-expired-sessions', async () => {
  const deleted = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { result: { deletedCount: deleted.count }, logs: `Deleted ${deleted.count} expired sessions` };
});

jobsService.registerHandler('cleanup-expired-password-resets', async () => {
  const deleted = await prisma.passwordReset.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { result: { deletedCount: deleted.count }, logs: `Deleted ${deleted.count} expired password resets` };
});

jobsService.registerHandler('cleanup-expired-batch-uploads', async () => {
  const deleted = await prisma.batchUpload.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { result: { deletedCount: deleted.count }, logs: `Deleted ${deleted.count} expired batch uploads` };
});

jobsService.registerHandler('cleanup-old-audit-logs', async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const deleted = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: thirtyDaysAgo } },
  });
  return { result: { deletedCount: deleted.count }, logs: `Deleted ${deleted.count} audit logs older than 30 days` };
});

jobsService.registerHandler('cleanup-old-login-history', async () => {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const deleted = await prisma.loginHistory.deleteMany({
    where: { createdAt: { lt: ninetyDaysAgo } },
  });
  return { result: { deletedCount: deleted.count }, logs: `Deleted ${deleted.count} login history records older than 90 days` };
});

jobsService.registerHandler('test-job', async (payload) => {
  return { result: { message: 'Test job executed successfully', payload }, logs: 'Test job ran' };
});
