import { Worker, Job } from 'bullmq';
import { config } from '../../config';
import { emailService } from '../email';
import { getEmailTemplate } from '../email-templates';
import { getLogger, runWithExecution } from '../logger-context';
import { prisma } from '../prisma';
import type { EmailJobData } from './index';

// Redis connection config
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
};

/**
 * Process email jobs
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  // Wrap job processing with execution context (logs to console + logs/email-worker/log.txt)
  return runWithExecution('email-worker', async () => {
    const { to, subject, html, text, template, variables, replyTo } = job.data;
    const logger = getLogger();

    logger.info({ 
      jobId: job.id,
      jobType: 'email',
      executionSource: 'worker',
      to,
      template
    }, 'Processing email job');

      let finalSubject = subject;
      let finalHtml = html;
      let finalText = text;

      // If template is specified, render it
      if (template && variables) {
        const rendered = getEmailTemplate(template, variables);
        if (rendered) {
          finalSubject = rendered.subject;
          finalHtml = rendered.html;
          finalText = rendered.text;
        } else {
          throw new Error(`Email template not found: ${template}`);
        }
      }

      // Send the email
      await emailService.sendEmail({
        to,
        subject: finalSubject,
        html: finalHtml,
        text: finalText,
        replyTo,
      });

      logger.info({ jobId: job.id, to }, 'Email sent successfully');
    }
  );
}

/**
 * Create and start the email worker
 */
export function startEmailWorker(): Worker {
  const worker = new Worker<EmailJobData>('email', processEmailJob, {
    connection,
    concurrency: 5, // Process up to 5 emails concurrently
  });

  worker.on('completed', (job) => {
    const logger = getLogger();
    logger.info({ jobId: job.id }, 'Email job completed');
  });

  worker.on('failed', (job, error) => {
    const logger = getLogger();
    logger.error({ jobId: job?.id, error: error.message }, 'Email job failed');

    // Update notification status if this was a notification email
    if (job?.data && 'notificationId' in job.data) {
      const notificationId = (job.data as unknown as { notificationId: string }).notificationId;
      prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          error: error.message,
          attempts: { increment: 1 },
        },
      }).catch((err: Error) => {
        logger.error({ err, notificationId }, 'Failed to update notification status');
      });
    }
  });

  worker.on('error', (error) => {
    const logger = getLogger();
    logger.error({ error: error.message }, 'Email worker error');
  });

  const logger = getLogger();
  logger.info('Email worker started');
  return worker;
}

/**
 * Stop the email worker gracefully
 */
export async function stopEmailWorker(worker: Worker): Promise<void> {
  await worker.close();
  const logger = getLogger();
  logger.info('Email worker stopped');
}
