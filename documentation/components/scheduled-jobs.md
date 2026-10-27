# Scheduled Jobs System

## Overview

The Scheduled Jobs system provides a comprehensive solution for managing and executing automated background tasks using BullMQ and cron expressions. It includes both backend infrastructure for job execution and a full-featured UI for managing scheduled jobs.

## Architecture

### Backend Components

#### 1. Database Models (`apps/api/prisma/schema.prisma`)

**ScheduledJob Model:**
- `id`: Unique identifier
- `name`: Unique job name
- `description`: Optional job description
- `cron`: Cron expression for scheduling
- `handler`: Name of the handler function to execute
- `isActive`: Whether the job is currently active
- `lastRunAt`: Timestamp of last execution
- `lastStatus`: Result of last run (success/failed)
- `lastError`: Error message from last failed run
- `nextRunAt`: Calculated next execution time
- Relations: `runs` (JobRun[])

**JobRun Model:**
- `id`: Unique identifier
- `jobId`: Reference to ScheduledJob
- `status`: Execution status (running/success/failed)
- `output`: Job execution output
- `error`: Error details if failed
- `startedAt`: Execution start time
- `endedAt`: Execution end time
- `duration`: Execution duration in milliseconds

#### 2. Scheduler Service (`apps/api/src/lib/scheduler/scheduler.service.ts`)

Core service that manages job execution using BullMQ:

**Key Methods:**
- `initialize()`: Load and schedule all active jobs on startup
- `scheduleJob(job)`: Add/update a repeatable job in BullMQ
- `pauseJob(jobId)`: Remove job from queue and mark inactive
- `resumeJob(jobId)`: Reactivate and reschedule a paused job
- `runJob(jobId)`: Manually trigger a job execution
- `processJob(jobId)`: Internal method that executes job handlers
- `shutdown()`: Gracefully shut down the scheduler

**Features:**
- Automatic cron parsing and next run time calculation
- Job execution with proper error handling
- Detailed logging of job execution
- Database persistence of job runs
- Graceful shutdown support

#### 3. Job Handlers (`apps/api/src/lib/scheduler/handlers/`)

Job handlers are functions that implement the actual work to be done:

**cleanup-sessions.ts**
```typescript
export async function cleanupSessionsHandler(jobId: string) {
  // Delete expired sessions from database
  // Returns: { success: boolean, output?: string, error?: string }
}
```

**cleanup-exports.ts**
```typescript
export async function cleanupExportsHandler(jobId: string) {
  // Delete old export files (>7 days)
  // Cleans both filesystem and database records
}
```

**email-digest.ts**
```typescript
export async function emailDigestHandler(jobId: string) {
  // Send periodic email digests
  // Placeholder for actual email sending
}
```

**database-backup.ts**
```typescript
export async function databaseBackupHandler(jobId: string) {
  // Create database backup
  // Placeholder for actual backup logic
}
```

#### 4. API Routes (`apps/api/src/modules/scheduler/`)

**scheduler.routes.ts** - REST API endpoints:
- `GET /api/scheduler/jobs` - List all jobs (filterable by isActive, handler)
- `GET /api/scheduler/jobs/:id` - Get job details with recent runs
- `POST /api/scheduler/jobs` - Create a new job
- `PUT /api/scheduler/jobs/:id` - Update job configuration
- `DELETE /api/scheduler/jobs/:id` - Delete a job
- `POST /api/scheduler/jobs/:id/run` - Manually trigger job
- `POST /api/scheduler/jobs/:id/pause` - Pause job execution
- `POST /api/scheduler/jobs/:id/resume` - Resume paused job
- `GET /api/scheduler/jobs/:id/runs` - Get job execution history

**Permissions Required:**
- `scheduler:view` - View jobs
- `scheduler:create` - Create jobs
- `scheduler:edit` - Edit/pause/resume jobs
- `scheduler:delete` - Delete jobs
- `scheduler:execute` - Manually trigger jobs

### Frontend Components

#### 1. Service Layer (`apps/web/src/services/scheduler.service.ts`)

TypeScript service providing typed API access:
- Type definitions for ScheduledJob and JobRun
- Methods for all CRUD operations
- Type-safe API calls with error handling

#### 2. CronBuilder Component (`apps/web/src/components/scheduler/CronBuilder.tsx`)

Interactive cron expression builder:
- Preset schedules (every minute, hourly, daily, weekly, monthly)
- Custom cron expression input
- Real-time validation
- Human-readable description using cronstrue
- Preview of next 5 run times
- Inline help with cron format examples

#### 3. JobForm Component (`apps/web/src/components/scheduler/JobForm.tsx`)

Form for creating/editing jobs:
- Job name and description inputs
- Handler dropdown (cleanup-sessions, cleanup-exports, etc.)
- Integrated CronBuilder
- Active/inactive toggle
- Form validation using Zod
- React Hook Form integration

#### 4. JobDetail Component (`apps/web/src/components/scheduler/JobDetail.tsx`)

Detailed job view modal:
- Job configuration display
- Status badges (Active/Paused, Success/Failed)
- Last run and next run times
- Error display for failed jobs
- Quick actions (Run Now, Pause/Resume, Edit, Delete)
- Run history table with status, duration, and output
- Auto-refresh every 5 seconds

#### 5. ScheduledJobsPage (`apps/web/src/pages/ScheduledJobsPage.tsx`)

Main jobs management page:
- DataTable with all scheduled jobs
- Columns: Name, Schedule, Status, Last Run, Next Run, Actions
- Quick actions in table rows
- Create, Edit, Delete operations
- Inline run and pause/resume controls
- Permission-based UI elements

## Usage

### Creating a New Job Handler

1. Create handler file in `apps/api/src/lib/scheduler/handlers/`:

```typescript
// my-task.ts
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';

export async function myTaskHandler(jobId: string) {
  try {
    logger.info('Starting my task...');

    // Your task logic here
    const result = await doSomething();

    const output = `Task completed: ${result}`;
    logger.info(output);

    return {
      success: true,
      output,
    };
  } catch (error: any) {
    logger.error('My task failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}
```

2. Register handler in `scheduler.service.ts`:

```typescript
import { myTaskHandler } from './handlers/my-task.js';

const JOB_HANDLERS: Record<string, JobHandler> = {
  // ... existing handlers
  'my-task': myTaskHandler,
};
```

3. Add to available handlers in JobForm component:

```typescript
const AVAILABLE_HANDLERS = [
  // ... existing handlers
  { value: 'my-task', label: 'My Custom Task' },
];
```

### Creating Jobs via UI

1. Navigate to Scheduled Jobs page
2. Click "Create Job"
3. Fill in job details:
   - Name: Descriptive name for the job
   - Description: What the job does
   - Handler: Select from available handlers
   - Schedule: Use preset or custom cron expression
   - Active: Toggle to activate immediately
4. Click "Create Job"

### Creating Jobs via API

```typescript
POST /api/scheduler/jobs
{
  "name": "Session Cleanup",
  "description": "Delete expired sessions",
  "cron": "0 3 * * *",
  "handler": "cleanup-sessions",
  "isActive": true
}
```

### Cron Expression Format

Format: `minute hour day month weekday`

Examples:
- `* * * * *` - Every minute
- `0 * * * *` - Every hour
- `*/15 * * * *` - Every 15 minutes
- `0 3 * * *` - Daily at 3 AM
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 0 1 * *` - Monthly on the 1st at midnight
- `0 9-17 * * 1-5` - Weekdays 9 AM to 5 PM

Fields:
- Minute: 0-59
- Hour: 0-23
- Day: 1-31
- Month: 1-12
- Weekday: 0-6 (0 = Sunday)

Special characters:
- `*` - Any value
- `,` - Value list separator (1,3,5)
- `-` - Range (1-5)
- `/` - Step values (*/15)

## Default Scheduled Jobs

The system comes with 4 pre-seeded jobs:

1. **Session Cleanup** (Active)
   - Cron: `0 3 * * *` (Daily at 3 AM)
   - Handler: cleanup-sessions
   - Deletes expired session records

2. **Export Cleanup** (Active)
   - Cron: `0 4 * * *` (Daily at 4 AM)
   - Handler: cleanup-exports
   - Deletes export files older than 7 days

3. **Audit Log Archival** (Inactive)
   - Cron: `0 2 * * 0` (Weekly on Sunday at 2 AM)
   - Handler: email-digest
   - Placeholder for archival logic

4. **Database Backup** (Inactive)
   - Cron: `0 1 * * *` (Daily at 1 AM)
   - Handler: database-backup
   - Placeholder for backup logic

## Monitoring and Debugging

### Viewing Job History

1. Click on a job in the Scheduled Jobs page
2. View the "Recent Runs" section
3. Check status, duration, and output/errors

### Manual Execution

1. Click the Play button next to a job
2. Job will be queued immediately
3. Check execution results in job detail view

### Logs

All job executions are logged:
- Start/completion messages
- Success/failure status
- Execution duration
- Error details

Check application logs for detailed execution traces.

## Best Practices

1. **Job Handler Design:**
   - Keep handlers focused on a single task
   - Implement proper error handling
   - Log important events
   - Return meaningful output messages
   - Keep execution time reasonable

2. **Scheduling:**
   - Avoid very frequent jobs (< 1 minute) unless necessary
   - Stagger multiple jobs to avoid resource contention
   - Consider time zones when scheduling
   - Use appropriate intervals for the task nature

3. **Error Handling:**
   - Always wrap handler logic in try-catch
   - Return structured results with success flag
   - Log errors for debugging
   - Consider retry logic for transient failures

4. **Performance:**
   - Keep job handlers efficient
   - Batch operations when possible
   - Monitor job execution times
   - Scale BullMQ workers if needed

5. **Security:**
   - Restrict job creation to admins
   - Validate cron expressions
   - Sanitize job outputs
   - Audit job modifications

## Troubleshooting

### Job Not Running

1. Check if job is active
2. Verify cron expression is valid
3. Check Redis connection
4. Review application logs for errors
5. Ensure BullMQ worker is running

### Job Failing

1. View error in job detail page
2. Check handler implementation
3. Review job execution logs
4. Verify required resources are available
5. Test handler logic independently

### Performance Issues

1. Review job execution times
2. Optimize handler logic
3. Reduce job frequency if possible
4. Scale Redis or BullMQ workers
5. Monitor system resources

## Future Enhancements

Potential improvements:
- Job dependencies (run after another job)
- Conditional execution based on results
- Webhook notifications on job completion
- Job chaining and workflows
- Advanced retry policies
- Job execution history cleanup
- Export job logs
- Real-time job execution monitoring
- Job execution statistics and analytics
