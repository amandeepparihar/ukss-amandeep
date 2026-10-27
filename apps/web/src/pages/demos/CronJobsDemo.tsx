import { useState } from 'react';
import { Play, Pause, Trash2, RefreshCw, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  lastStatus: 'success' | 'failed' | 'pending';
  runCount: number;
}

const sampleCronJobs: CronJob[] = [
  {
    id: 'cron-1',
    name: 'daily-report',
    schedule: '0 9 * * *',
    description: 'Generate daily analytics report',
    enabled: true,
    lastRun: new Date('2024-12-16T09:00:00'),
    nextRun: new Date('2024-12-17T09:00:00'),
    lastStatus: 'success',
    runCount: 45,
  },
  {
    id: 'cron-2',
    name: 'cleanup-temp-files',
    schedule: '0 2 * * *',
    description: 'Clean up temporary files older than 7 days',
    enabled: true,
    lastRun: new Date('2024-12-16T02:00:00'),
    nextRun: new Date('2024-12-17T02:00:00'),
    lastStatus: 'success',
    runCount: 120,
  },
  {
    id: 'cron-3',
    name: 'sync-external-data',
    schedule: '*/15 * * * *',
    description: 'Sync data from external API every 15 minutes',
    enabled: true,
    lastRun: new Date('2024-12-16T10:45:00'),
    nextRun: new Date('2024-12-16T11:00:00'),
    lastStatus: 'success',
    runCount: 2880,
  },
  {
    id: 'cron-4',
    name: 'weekly-backup',
    schedule: '0 3 * * 0',
    description: 'Full database backup every Sunday',
    enabled: true,
    lastRun: new Date('2024-12-15T03:00:00'),
    nextRun: new Date('2024-12-22T03:00:00'),
    lastStatus: 'success',
    runCount: 12,
  },
  {
    id: 'cron-5',
    name: 'expired-sessions-cleanup',
    schedule: '0 * * * *',
    description: 'Remove expired user sessions every hour',
    enabled: true,
    lastRun: new Date('2024-12-16T10:00:00'),
    nextRun: new Date('2024-12-16T11:00:00'),
    lastStatus: 'success',
    runCount: 720,
  },
  {
    id: 'cron-6',
    name: 'send-reminder-emails',
    schedule: '0 8 * * 1-5',
    description: 'Send reminder emails on weekdays',
    enabled: false,
    lastRun: new Date('2024-12-13T08:00:00'),
    nextRun: undefined,
    lastStatus: 'failed',
    runCount: 30,
  },
];

const cronExpressions = [
  { expression: '* * * * *', description: 'Every minute' },
  { expression: '*/5 * * * *', description: 'Every 5 minutes' },
  { expression: '*/15 * * * *', description: 'Every 15 minutes' },
  { expression: '0 * * * *', description: 'Every hour' },
  { expression: '0 */2 * * *', description: 'Every 2 hours' },
  { expression: '0 0 * * *', description: 'Every day at midnight' },
  { expression: '0 9 * * *', description: 'Every day at 9 AM' },
  { expression: '0 9 * * 1-5', description: 'Weekdays at 9 AM' },
  { expression: '0 0 * * 0', description: 'Every Sunday at midnight' },
  { expression: '0 0 1 * *', description: 'First day of month' },
  { expression: '0 0 1 1 *', description: 'January 1st (yearly)' },
];

export function CronJobsDemo() {
  const [jobs, setJobs] = useState<CronJob[]>(sampleCronJobs);

  const toggleJob = (id: string) => {
    setJobs((prev) =>
      prev.map((job) =>
        job.id === id ? { ...job, enabled: !job.enabled } : job
      )
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cron Jobs & Scheduled Tasks</h1>
        <p className="text-muted-foreground">
          Schedule recurring tasks with cron expressions using BullMQ repeatable jobs.
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="expressions">Cron Expressions</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-bold">{jobs.length}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">{jobs.filter((j) => j.enabled).length}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Paused</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Pause className="h-5 w-5 text-yellow-500" />
                  <span className="text-2xl font-bold">{jobs.filter((j) => !j.enabled).length}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-blue-500" />
                  <span className="text-2xl font-bold">
                    {jobs.reduce((sum, j) => sum + j.runCount, 0).toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Jobs Table */}
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Jobs</CardTitle>
              <CardDescription>Manage your recurring scheduled tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Runs</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{job.name}</p>
                          <p className="text-xs text-muted-foreground">{job.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">{job.schedule}</code>
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.lastRun ? job.lastRun.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.nextRun ? job.nextRun.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {job.lastStatus === 'success' ? (
                          <Badge className="bg-green-100 text-green-800">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        ) : job.lastStatus === 'failed' ? (
                          <Badge className="bg-red-100 text-red-800">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>{job.runCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Switch
                          checked={job.enabled}
                          onCheckedChange={() => toggleJob(job.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" title="Run now">
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" className="text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expressions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cron Expression Reference</CardTitle>
              <CardDescription>
                Format: minute hour day-of-month month day-of-week
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-muted p-4 rounded-lg">
                  <pre className="text-sm">
{`┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
│ │ │ │ │
* * * * *`}
                  </pre>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Expression</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cronExpressions.map((item) => (
                      <TableRow key={item.expression}>
                        <TableCell>
                          <code className="bg-muted px-2 py-1 rounded text-sm">
                            {item.expression}
                          </code>
                        </TableCell>
                        <TableCell>{item.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="text-sm text-muted-foreground space-y-1">
                  <p><strong>Special characters:</strong></p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li><code>*</code> - Any value</li>
                    <li><code>,</code> - Value list separator (e.g., 1,3,5)</li>
                    <li><code>-</code> - Range of values (e.g., 1-5)</li>
                    <li><code>/</code> - Step values (e.g., */15 for every 15)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Setting Up Cron Jobs with BullMQ</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/lib/scheduler.ts
import { Queue, Worker } from 'bullmq';
import { redis } from './redis';
import { logger } from './logger';

// Create scheduler queue
export const schedulerQueue = new Queue('scheduler', {
  connection: redis,
});

// Define scheduled jobs
export async function setupScheduledJobs() {
  // Daily report at 9 AM
  await schedulerQueue.add(
    'daily-report',
    { type: 'analytics' },
    {
      repeat: {
        pattern: '0 9 * * *',
        tz: 'America/New_York', // Timezone support
      },
      jobId: 'daily-report', // Prevents duplicates on restart
    }
  );

  // Cleanup every hour
  await schedulerQueue.add(
    'cleanup-sessions',
    { maxAge: 24 * 60 * 60 * 1000 },
    {
      repeat: {
        pattern: '0 * * * *',
      },
      jobId: 'cleanup-sessions',
    }
  );

  // Every 15 minutes
  await schedulerQueue.add(
    'sync-data',
    { source: 'external-api' },
    {
      repeat: {
        pattern: '*/15 * * * *',
      },
      jobId: 'sync-data',
    }
  );

  logger.info('Scheduled jobs configured');
}`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Creating the Worker</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/workers/scheduler.worker.ts
import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

// Job handlers
const handlers: Record<string, (job: Job) => Promise<void>> = {
  'daily-report': async (job) => {
    logger.info({ jobId: job.id }, 'Generating daily report');
    // Generate report logic
    await generateDailyReport(job.data);
  },

  'cleanup-sessions': async (job) => {
    logger.info({ jobId: job.id }, 'Cleaning up expired sessions');
    const { maxAge } = job.data;
    await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  },

  'sync-data': async (job) => {
    logger.info({ jobId: job.id }, 'Syncing external data');
    await syncExternalData(job.data.source);
  },
};

// Create worker
export const schedulerWorker = new Worker(
  'scheduler',
  async (job: Job) => {
    const handler = handlers[job.name];
    if (!handler) {
      throw new Error(\`Unknown job: \${job.name}\`);
    }
    await handler(job);
  },
  {
    connection: redis,
    concurrency: 1, // Run one job at a time
  }
);

// Event handlers
schedulerWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'Scheduled job completed');
});

schedulerWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, error }, 'Scheduled job failed');
});`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Managing Repeatable Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// List all repeatable jobs
const repeatableJobs = await schedulerQueue.getRepeatableJobs();
// [{ key, name, id, endDate, tz, pattern, next }]

// Remove a repeatable job
await schedulerQueue.removeRepeatableByKey(repeatableJob.key);

// Or by name and pattern
await schedulerQueue.removeRepeatable('daily-report', {
  pattern: '0 9 * * *',
});

// Pause/Resume specific job type
// (You'd need to track state separately)

// Get next scheduled run times
for (const job of repeatableJobs) {
  console.log(\`\${job.name}: next run at \${new Date(job.next)}\`);
}

// Update schedule (remove and re-add)
await schedulerQueue.removeRepeatable('daily-report', { pattern: '0 9 * * *' });
await schedulerQueue.add('daily-report', data, {
  repeat: { pattern: '0 10 * * *' }, // Changed to 10 AM
  jobId: 'daily-report',
});`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Initialize on Server Start</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/server.ts
import { setupScheduledJobs } from './lib/scheduler';
import './workers/scheduler.worker'; // Start worker

async function start() {
  const app = await buildApp();

  // Setup scheduled jobs after server starts
  await setupScheduledJobs();

  await app.listen({ port: config.PORT, host: config.HOST });
}

start();`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
