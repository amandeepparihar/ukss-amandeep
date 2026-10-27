/**
 * Product Feeds - Email Notifier
 *
 * Sends a plain-text run report to configured recipients at the end
 * of each feed run. Subject includes "morning" or "afternoon" based
 * on UTC hour (matches the PHP cron's twice-daily convention, even
 * though the Node cron currently runs once a day).
 *
 * Uses the existing `emailService` singleton from `lib/email.ts`.
 */

import { emailService } from '../../../lib/email.js';
import { createLogger } from '../../../lib/logger.js';
import type { FeedRunReport } from '../product-feeds.types.js';

const logger = createLogger('product-feeds-email');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildSubject(completedAt: string): string {
  const d = new Date(completedAt);
  const isoDate = d.toISOString().slice(0, 10);
  const hour = d.getUTCHours();
  const period = hour < 12 ? 'morning' : 'afternoon';
  return `Feed Process Log - ${isoDate} ${period}`;
}

function buildBody(report: FeedRunReport): string {
  const lines: string[] = [];

  lines.push('Product Feed Run Summary');
  lines.push('='.repeat(40));
  lines.push(`Started:    ${report.startedAt}`);
  lines.push(`Completed:  ${report.completedAt}`);
  lines.push(`Duration:   ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push(`Products:   ${report.productsProcessed}`);
  if (report.dryRun) lines.push('(DRY RUN -- no files written or uploaded)');
  lines.push('');

  lines.push('Feed files:');
  lines.push('-'.repeat(40));
  if (report.feedsGenerated.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of report.feedsGenerated) {
      lines.push(
        `  ${f.file.padEnd(48)} ${f.itemCount.toString().padStart(7)} items  ${formatBytes(f.bytes)}`,
      );
    }
  }
  lines.push('');

  lines.push('Uploads:');
  lines.push('-'.repeat(40));
  if (report.uploads.length === 0) {
    lines.push('  (none)');
  } else {
    for (const u of report.uploads) {
      lines.push(
        `  ${u.target.padEnd(12)}  ${u.filesUploaded} uploaded, ${u.filesFailed} failed`,
      );
      for (const err of u.errors.slice(0, 5)) {
        lines.push(`    - ${err}`);
      }
    }
  }
  lines.push('');

  if (report.errors.length > 0) {
    lines.push('Errors:');
    lines.push('-'.repeat(40));
    for (const err of report.errors) {
      lines.push(`  - ${err}`);
    }
  } else {
    lines.push('No errors.');
  }

  return lines.join('\n');
}

/**
 * Send the feed run report to every recipient in the list. Silently
 * returns when `recipients` is empty -- the orchestrator does not
 * treat a missing recipient list as an error.
 */
export async function sendFeedReport(
  report: FeedRunReport,
  recipients: string[],
): Promise<void> {
  if (recipients.length === 0) {
    logger.warn('No email recipients configured -- skipping feed report email');
    return;
  }

  const subject = buildSubject(report.completedAt);
  const text = buildBody(report);

  try {
    await emailService.sendEmail({
      to: recipients,
      subject,
      text,
    });
    logger.info({ recipients, subject }, 'Feed report email sent');
  } catch (err) {
    logger.error({ err, recipients }, 'Feed report email failed to send');
    // swallow -- the orchestrator already logged the run result; a
    // missing email shouldn't fail the whole run.
  }
}
