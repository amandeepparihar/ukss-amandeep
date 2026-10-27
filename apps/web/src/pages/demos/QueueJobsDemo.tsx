import { useState } from 'react';
import { Play, Pause, RefreshCw, Trash2, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Job {
  id: string;
  name: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  data: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
  processedAt?: Date;
  finishedAt?: Date;
  error?: string;
}

const sampleJobs: Job[] = [
  { id: 'job-1', name: 'send-email', status: 'completed', progress: 100, data: { to: 'user@example.com', template: 'welcome' }, attempts: 1, createdAt: new Date('2024-12-16T10:00:00'), processedAt: new Date('2024-12-16T10:00:05'), finishedAt: new Date('2024-12-16T10:00:10') },
  { id: 'job-2', name: 'process-image', status: 'active', progress: 45, data: { fileId: 'f123', operations: ['resize', 'compress'] }, attempts: 1, createdAt: new Date('2024-12-16T10:05:00'), processedAt: new Date('2024-12-16T10:05:02') },
  { id: 'job-3', name: 'generate-report', status: 'waiting', progress: 0, data: { reportType: 'monthly', userId: 'u456' }, attempts: 0, createdAt: new Date('2024-12-16T10:10:00') },
  { id: 'job-4', name: 'send-email', status: 'failed', progress: 0, data: { to: 'invalid-email', template: 'notification' }, attempts: 3, createdAt: new Date('2024-12-16T09:55:00'), processedAt: new Date('2024-12-16T09:55:05'), error: 'Invalid email address' },
  { id: 'job-5', name: 'sync-data', status: 'delayed', progress: 0, data: { source: 'external-api', schedule: '*/5 * * * *' }, attempts: 0, createdAt: new Date('2024-12-16T10:15:00') },
  { id: 'job-6', name: 'cleanup-files', status: 'completed', progress: 100, data: { olderThan: '30d', folder: 'temp' }, attempts: 1, createdAt: new Date('2024-12-16T09:00:00'), processedAt: new Date('2024-12-16T09:00:01'), finishedAt: new Date('2024-12-16T09:00:15') },
];

const queueStats = {
  waiting: 15,
  active: 3,
  completed: 1250,
  failed: 12,
  delayed: 5,
};

const statusIcons: Record<Job['status'], React.ElementType> = {
  waiting: Clock,
  active: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  delayed: AlertCircle,
};

const statusColors: Record<Job['status'], string> = {
  waiting: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  delayed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
};

export function QueueJobsDemo() {
  const [jobs] = useState<Job[]>(sampleJobs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Queue Jobs (BullMQ)</h1>
        <p className="text-muted-foreground">
          Background job processing with BullMQ and Redis for reliable task execution.
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {/* Queue Stats */}
          <div className="grid gap-4 md:grid-cols-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Waiting</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-gray-500" />
                  <span className="text-2xl font-bold">{queueStats.waiting}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                  <span className="text-2xl font-bold">{queueStats.active}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">{queueStats.completed}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="text-2xl font-bold">{queueStats.failed}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Delayed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                  <span className="text-2xl font-bold">{queueStats.delayed}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Queue Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Queue Controls</CardTitle>
              <CardDescription>Manage queue workers and jobs</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3">
              <Button variant="outline">
                <Play className="h-4 w-4 mr-2" />
                Resume Queue
              </Button>
              <Button variant="outline">
                <Pause className="h-4 w-4 mr-2" />
                Pause Queue
              </Button>
              <Button variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Failed
              </Button>
              <Button variant="outline" className="text-red-600">
                <Trash2 className="h-4 w-4 mr-2" />
                Clean Completed
              </Button>
            </CardContent>
          </Card>

          {/* Recent Jobs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Jobs</CardTitle>
              <CardDescription>Last 10 jobs across all statuses</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const StatusIcon = statusIcons[job.status];
                    return (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-xs">{job.id}</TableCell>
                        <TableCell>{job.name}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[job.status]}>
                            <StatusIcon className={`h-3 w-3 mr-1 ${job.status === 'active' ? 'animate-spin' : ''}`} />
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {job.status === 'active' ? (
                            <Progress value={job.progress} className="h-2 w-20" />
                          ) : job.status === 'completed' ? (
                            '100%'
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>{job.attempts}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {job.createdAt.toLocaleTimeString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {jobs.map((job) => {
              const StatusIcon = statusIcons[job.status];
              return (
                <Card key={job.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{job.name}</CardTitle>
                      <Badge className={statusColors[job.status]}>
                        <StatusIcon className={`h-3 w-3 mr-1 ${job.status === 'active' ? 'animate-spin' : ''}`} />
                        {job.status}
                      </Badge>
                    </div>
                    <CardDescription className="font-mono text-xs">{job.id}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {job.status === 'active' && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Progress</span>
                          <span>{job.progress}%</span>
                        </div>
                        <Progress value={job.progress} className="h-2" />
                      </div>
                    )}
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Attempts:</span>
                        <span>{job.attempts}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created:</span>
                        <span>{job.createdAt.toLocaleString()}</span>
                      </div>
                      {job.error && (
                        <div className="text-red-500 mt-2 p-2 bg-red-50 dark:bg-red-950 rounded text-xs">
                          {job.error}
                        </div>
                      )}
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Data:</span>
                      <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto">
                        {JSON.stringify(job.data, null, 2)}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Queue Setup</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/lib/queue.ts
import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis';

// Create a queue
export const emailQueue = new Queue('email', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,  // Keep last 100 completed
    removeOnFail: 500,      // Keep last 500 failed
  },
});

// Create a worker to process jobs
const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    const { to, template, data } = job.data;

    // Update progress
    await job.updateProgress(10);

    // Process the job
    await sendEmail({ to, template, data });

    await job.updateProgress(100);
    return { sent: true };
  },
  {
    connection: redis,
    concurrency: 5,  // Process 5 jobs at a time
  }
);

// Listen for events
emailWorker.on('completed', (job) => {
  console.log(\`Job \${job.id} completed\`);
});

emailWorker.on('failed', (job, error) => {
  console.log(\`Job \${job?.id} failed: \${error.message}\`);
});`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adding Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { emailQueue } from '../lib/queue';

// Add a single job
await emailQueue.add('send-welcome', {
  to: 'user@example.com',
  template: 'welcome',
  data: { name: 'John' },
});

// Add with options
await emailQueue.add('send-notification', data, {
  delay: 5000,           // Wait 5 seconds before processing
  priority: 1,           // Higher priority (1 is highest)
  attempts: 5,           // Override default attempts
  jobId: 'unique-id',    // Custom job ID (prevents duplicates)
});

// Add bulk jobs
await emailQueue.addBulk([
  { name: 'send-email', data: { to: 'a@example.com' } },
  { name: 'send-email', data: { to: 'b@example.com' } },
]);

// Scheduled/repeatable jobs
await emailQueue.add(
  'daily-report',
  { type: 'daily' },
  {
    repeat: {
      pattern: '0 9 * * *',  // Every day at 9 AM
    },
  }
);`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Queue Management</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Get queue stats
const counts = await emailQueue.getJobCounts();
// { waiting: 10, active: 2, completed: 100, failed: 5, delayed: 3 }

// Get jobs by status
const waiting = await emailQueue.getWaiting(0, 10);
const active = await emailQueue.getActive(0, 10);
const completed = await emailQueue.getCompleted(0, 10);
const failed = await emailQueue.getFailed(0, 10);

// Retry failed jobs
const failedJobs = await emailQueue.getFailed();
for (const job of failedJobs) {
  await job.retry();
}

// Remove a job
const job = await emailQueue.getJob('job-id');
await job?.remove();

// Clean old jobs
await emailQueue.clean(24 * 3600 * 1000, 100, 'completed'); // Older than 24h
await emailQueue.clean(7 * 24 * 3600 * 1000, 100, 'failed');

// Pause/Resume queue
await emailQueue.pause();
await emailQueue.resume();

// Drain (remove all jobs)
await emailQueue.drain();`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
