import { Queue, Worker, Job } from 'bullmq';
import { config } from '../../config';
import { createLogger } from '../logger';

const logger = createLogger('queue');

// Redis connection config
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
};

// Queue names
export const QUEUE_NAMES = {
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  EXPORT: 'export',
} as const;

// Create queues
export const emailQueue = new Queue(QUEUE_NAMES.EMAIL, { connection });
export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, { connection });
export const exportQueue = new Queue(QUEUE_NAMES.EXPORT, { connection });

logger.info({ queues: Object.values(QUEUE_NAMES) }, 'Queues initialized');

// Job types
export interface EmailJobData {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  variables?: Record<string, unknown>;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface NotificationJobData {
  userId: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH';
  template: string;
  variables: Record<string, unknown>;
}

// Helper to add jobs
export async function addEmailJob(data: EmailJobData, options?: { priority?: number; delay?: number }) {
  const job = await emailQueue.add('send', data, {
    priority: options?.priority ?? 5,
    delay: options?.delay,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // 1 minute
    },
  });
  logger.info({ jobId: job.id, to: data.to }, 'Email job added to queue');
  return job;
}

export async function addNotificationJob(data: NotificationJobData) {
  const job = await notificationQueue.add('send', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000,
    },
  });
  return job;
}

// Get queue stats
export async function getQueueStats(queueName: keyof typeof QUEUE_NAMES) {
  const queue = {
    [QUEUE_NAMES.EMAIL]: emailQueue,
    [QUEUE_NAMES.NOTIFICATION]: notificationQueue,
    [QUEUE_NAMES.EXPORT]: exportQueue,
  }[QUEUE_NAMES[queueName]];

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

export { Queue, Worker, Job };
