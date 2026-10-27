import { useState, useEffect } from 'react';
import {
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  Calendar,
  AlertCircle,
  History,
  Settings,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/lib/api';

interface ScheduledJob {
  id: string;
  name: string;
  description: string | null;
  cron: string;
  timezone: string;
  handler: string;
  payload: Record<string, unknown> | null;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface JobRun {
  id: string;
  jobId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string | null;
  triggeredBy: string | null;
}

interface JobStats {
  totalJobs: number;
  activeJobs: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  runningJobs: number;
  availableHandlers: string[];
}

export function ScheduledJobsDemo() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  // Fetch jobs and stats
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, statsRes] = await Promise.all([
        api.get('/jobs'),
        api.get('/jobs/stats'),
      ]);
      setJobs(jobsRes.data.data);
      setStats(statsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
      toast.error('Failed to load scheduled jobs');
    } finally {
      setLoading(false);
    }
  };

  // Toggle job enabled status
  const toggleJob = async (job: ScheduledJob) => {
    try {
      await api.patch(`/jobs/${job.id}`, {
        isEnabled: !job.isEnabled,
      });
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, isEnabled: !j.isEnabled } : j))
      );
      toast.success(`${job.name} has been ${job.isEnabled ? 'disabled' : 'enabled'}`);
    } catch (error) {
      toast.error('Failed to update job');
    }
  };

  // Trigger job manually
  const triggerJob = async (jobId: string) => {
    setTriggeringJob(jobId);
    try {
      await api.post(`/jobs/${jobId}/trigger`);
      toast.success('The job has been queued for execution');
      // Refresh data after a short delay
      setTimeout(fetchData, 2000);
    } catch (error) {
      toast.error('Failed to trigger job');
    } finally {
      setTriggeringJob(null);
    }
  };

  // View job history
  const viewHistory = async (job: ScheduledJob) => {
    setSelectedJob(job);
    setHistoryDialogOpen(true);
    setRunsLoading(true);
    try {
      const response = await api.get(`/jobs/${job.id}/runs`);
      setJobRuns(response.data.data);
    } catch (error) {
      console.error('Failed to fetch job runs:', error);
      setJobRuns([]);
    } finally {
      setRunsLoading(false);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'RUNNING':
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduled Jobs</h1>
          <p className="text-muted-foreground">
            Manage and monitor cron-based scheduled tasks with the jobs service.
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="jobs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="handlers">Available Handlers</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-4">
          {/* Stats */}
          {stats && (
            <div className="grid gap-4 md:grid-cols-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Jobs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">{stats.totalJobs}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Active
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Play className="h-5 w-5 text-green-500" />
                    <span className="text-2xl font-bold">{stats.activeJobs}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Running
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                    <span className="text-2xl font-bold">{stats.runningJobs}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Runs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">{stats.totalRuns}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Successful
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="text-2xl font-bold">{stats.successfulRuns}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Failed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-500" />
                    <span className="text-2xl font-bold">{stats.failedRuns}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Jobs Table */}
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Jobs</CardTitle>
              <CardDescription>
                All registered scheduled jobs in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No scheduled jobs found. Create jobs via the API or seed script.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Handler</TableHead>
                      <TableHead>Last Run</TableHead>
                      <TableHead>Next Run</TableHead>
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
                            {job.description && (
                              <p className="text-xs text-muted-foreground">
                                {job.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              {job.cron}
                            </code>
                            <p className="text-xs text-muted-foreground mt-1">
                              {job.timezone}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{job.handler}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(job.lastRunAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {job.isEnabled ? formatDate(job.nextRunAt) : '-'}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={job.isEnabled}
                            onCheckedChange={() => toggleJob(job)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Run now"
                              onClick={() => triggerJob(job.id)}
                              disabled={triggeringJob === job.id}
                            >
                              {triggeringJob === job.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View history"
                              onClick={() => viewHistory(job)}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="handlers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Available Job Handlers</CardTitle>
              <CardDescription>
                Built-in handlers that can be used when creating scheduled jobs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats?.availableHandlers && stats.availableHandlers.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {stats.availableHandlers.map((handler) => (
                    <Card key={handler}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                          <Settings className="h-5 w-5 text-primary" />
                          <code className="text-sm font-mono">{handler}</code>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No handlers registered</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Built-in Cleanup Handlers</CardTitle>
              <CardDescription>
                These handlers are pre-registered for common maintenance tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Handler</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Recommended Schedule</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">cleanup-expired-sessions</code>
                    </TableCell>
                    <TableCell>Removes expired user sessions from the database</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">0 * * * *</code>
                      <span className="text-xs text-muted-foreground ml-2">(hourly)</span>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">cleanup-expired-password-resets</code>
                    </TableCell>
                    <TableCell>Removes expired password reset tokens</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">0 */6 * * *</code>
                      <span className="text-xs text-muted-foreground ml-2">(every 6h)</span>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">cleanup-expired-batch-uploads</code>
                    </TableCell>
                    <TableCell>Cleans up stale batch upload records</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">0 2 * * *</code>
                      <span className="text-xs text-muted-foreground ml-2">(daily 2am)</span>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">cleanup-old-audit-logs</code>
                    </TableCell>
                    <TableCell>Archives audit logs older than 90 days</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">0 3 * * 0</code>
                      <span className="text-xs text-muted-foreground ml-2">(weekly)</span>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">cleanup-old-login-history</code>
                    </TableCell>
                    <TableCell>Removes login history older than 30 days</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">0 4 * * 0</code>
                      <span className="text-xs text-muted-foreground ml-2">(weekly)</span>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code className="text-sm">test-job</code>
                    </TableCell>
                    <TableCell>Test handler for verifying job execution</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">On-demand only</span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Jobs API Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`# List all scheduled jobs
GET /api/jobs

# Get job statistics
GET /api/jobs/stats

# Get a specific job
GET /api/jobs/:id

# Create a new scheduled job
POST /api/jobs
Body: {
  "name": "daily-cleanup",
  "description": "Clean up temporary data",
  "cron": "0 2 * * *",
  "timezone": "UTC",
  "handler": "cleanup-expired-sessions",
  "payload": { "maxAge": 86400000 },
  "isEnabled": true
}

# Update a job
PATCH /api/jobs/:id
Body: { "isEnabled": false, "cron": "0 3 * * *" }

# Delete a job
DELETE /api/jobs/:id

# Trigger a job manually
POST /api/jobs/:id/trigger

# Get job run history
GET /api/jobs/:id/runs?limit=50`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Creating Custom Handlers</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/modules/jobs/jobs.service.ts

// Register a custom handler
jobsService.registerHandler('my-custom-job', async (payload) => {
  // payload contains the job's payload data
  const { maxAge, targetTable } = payload as {
    maxAge: number;
    targetTable: string;
  };

  // Perform your task
  const deleted = await prisma[targetTable].deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - maxAge) }
    }
  });

  // Return result (logged in job run record)
  return {
    deleted: deleted.count,
    table: targetTable,
  };
});

// Then create a job that uses this handler via API or seed
await prisma.scheduledJob.create({
  data: {
    name: 'custom-cleanup',
    description: 'Custom cleanup task',
    cron: '0 * * * *',
    timezone: 'UTC',
    handler: 'my-custom-job',
    payload: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      targetTable: 'tempData',
    },
    isEnabled: true,
  },
});`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Job History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Job History: {selectedJob?.name}</DialogTitle>
            <DialogDescription>
              Recent execution history for this scheduled job
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px]">
            {runsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : jobRuns.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No execution history found
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Triggered By</TableHead>
                    <TableHead>Result / Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm">
                        {formatDate(run.startedAt)}
                      </TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell className="text-sm">
                        {formatDuration(run.duration)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {run.triggeredBy || 'scheduler'}
                      </TableCell>
                      <TableCell className="text-sm max-w-[300px]">
                        {run.error ? (
                          <span className="text-red-500 truncate block">
                            {run.error}
                          </span>
                        ) : run.result ? (
                          <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                            {JSON.stringify(run.result)}
                          </code>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
