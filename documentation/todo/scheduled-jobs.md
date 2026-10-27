# Scheduled Jobs Feature Implementation

## Status: In Progress

## Overview
Comprehensive scheduled jobs system using BullMQ for managing automated background tasks with cron scheduling.

## Completed Work

### Backend

1. **Database Schema** ✅
   - Added ScheduledJob model to Prisma schema
   - Added JobRun model for execution history
   - Created migration file: `20251216232054_add_scheduled_jobs`
   - Added scheduler permissions to seed data

2. **Dependencies** ✅
   - Installed `cron-parser` package
   - BullMQ already installed

3. **Core Services**
   - **Scheduler Service** (`apps/api/src/lib/scheduler/scheduler.service.ts`)
     - BullMQ integration
     - Job scheduling with cron expressions
     - Job execution management
     - Pause/resume functionality
     - Manual job triggering
     - Graceful shutdown support

   - **Module Service** (`apps/api/src/modules/scheduler/scheduler.service.ts`)
     - CRUD operations for jobs
     - Job run history tracking
     - Cron validation

4. **Job Handlers** (`apps/api/src/lib/scheduler/handlers/`)
   - `cleanup-sessions.ts` - Delete expired sessions
   - `cleanup-exports.ts` - Delete old export files
   - `email-digest.ts` - Send notification digests (placeholder)
   - `database-backup.ts` - Trigger backup (placeholder)

5. **API Routes** (`apps/api/src/modules/scheduler/scheduler.routes.ts`)
   - GET /api/scheduler/jobs - List all jobs
   - GET /api/scheduler/jobs/:id - Get job details
   - POST /api/scheduler/jobs - Create job
   - PUT /api/scheduler/jobs/:id - Update job
   - DELETE /api/scheduler/jobs/:id - Delete job
   - POST /api/scheduler/jobs/:id/run - Manual trigger
   - POST /api/scheduler/jobs/:id/pause - Pause job
   - POST /api/scheduler/jobs/:id/resume - Resume job
   - GET /api/scheduler/jobs/:id/runs - Get run history

6. **Integration**
   - Registered routes in `app.ts`
   - Initialize scheduler on server startup in `server.ts`
   - Graceful shutdown in `server.ts`

7. **Seed Data**
   - 4 default jobs in seeds:
     - Session Cleanup (daily 3am, active)
     - Export Cleanup (daily 4am, active)
     - Audit Log Archival (weekly, inactive)
     - Database Backup (daily 1am, inactive)

### Frontend

1. **Dependencies** ✅
   - Installed `cron-parser` and `cronstrue` packages

2. **Services**
   - `apps/web/src/services/scheduler.service.ts`
     - Type-safe API client
     - All CRUD operations
     - Job execution controls

3. **Components**
   - **CronBuilder** (`apps/web/src/components/scheduler/CronBuilder.tsx`)
     - Preset schedules
     - Custom cron input
     - Real-time validation
     - Human-readable description
     - Next 5 runs preview

   - **JobForm** (`apps/web/src/components/scheduler/JobForm.tsx`)
     - Create/edit job form
     - Handler dropdown
     - Integrated CronBuilder
     - Form validation with Zod

   - **JobDetail** (`apps/web/src/components/scheduler/JobDetail.tsx`)
     - Detailed job view modal
     - Job status and configuration
     - Run history table
     - Quick actions (run, pause, edit, delete)
     - Auto-refresh

   - **ScheduledJobsPage** (`apps/web/src/pages/ScheduledJobsPage.tsx`)
     - Main jobs management page
     - DataTable with all jobs
     - CRUD operations
     - Permission-based UI

4. **Routing**
   - Added `/scheduled-jobs` route in App.tsx

5. **Documentation**
   - Comprehensive documentation in `/documentation/components/scheduled-jobs.md`

## Files Created

### Backend Files
```
apps/api/prisma/schema.prisma (modified)
apps/api/prisma/migrations/20251216232054_add_scheduled_jobs/migration.sql
apps/api/prisma/seeds/index.ts (modified)
apps/api/package.json (modified - added cron-parser)
apps/api/src/lib/scheduler/scheduler.service.ts
apps/api/src/lib/scheduler/handlers/cleanup-sessions.ts
apps/api/src/lib/scheduler/handlers/cleanup-exports.ts
apps/api/src/lib/scheduler/handlers/email-digest.ts
apps/api/src/lib/scheduler/handlers/database-backup.ts
apps/api/src/modules/scheduler/scheduler.service.ts
apps/api/src/modules/scheduler/scheduler.routes.ts
apps/api/src/app.ts (modified - registered routes)
apps/api/src/server.ts (modified - scheduler init/shutdown)
```

### Frontend Files
```
apps/web/package.json (modified - added cron-parser, cronstrue)
apps/web/src/services/scheduler.service.ts
apps/web/src/components/scheduler/CronBuilder.tsx
apps/web/src/components/scheduler/JobForm.tsx
apps/web/src/components/scheduler/JobDetail.tsx
apps/web/src/pages/ScheduledJobsPage.tsx
apps/web/src/App.tsx (modified - added route)
```

### Documentation
```
documentation/components/scheduled-jobs.md
documentation/todo/scheduled-jobs.md
```

## Remaining Tasks

1. **File Verification**
   - Verify all backend files were created successfully
   - Verify all frontend files were created successfully
   - Run TypeScript check to ensure no errors

2. **Testing**
   - Test database migration
   - Test seed data creation
   - Test scheduler initialization
   - Test job creation via API
   - Test job execution
   - Test frontend UI
   - Test cron builder
   - Test job detail view

3. **Git Operations**
   - Stage all new files
   - Commit with proper message
   - Push to feature branch

4. **Menu Integration**
   - Add "Scheduled Jobs" menu item to navigation
   - Ensure proper permissions

## Commands to Run

### Database Setup
```bash
# Generate Prisma client
pnpm db:generate

# Run seeds (will create default jobs)
pnpm db:seed
```

### Testing
```bash
# Start API server
cd apps/api
pnpm dev

# Start web server (in another terminal)
cd apps/web
pnpm dev

# Navigate to http://localhost:3000/scheduled-jobs
```

### Git Commit
```bash
git add .
git commit -m "$(cat <<'EOF'
feat: implement scheduled jobs system with BullMQ

Backend:
- Add ScheduledJob and JobRun database models
- Implement BullMQ-based scheduler service
- Create job handlers for cleanup tasks
- Add REST API endpoints for job management
- Integrate scheduler initialization on server startup
- Add default scheduled jobs in seed data

Frontend:
- Create Scheduled Jobs management page
- Implement CronBuilder component with presets
- Add JobForm for creating/editing jobs
- Build JobDetail modal with run history
- Create scheduler API service
- Add route and navigation

Features:
- Visual cron expression builder
- Job execution history tracking
- Manual job triggering
- Pause/resume functionality
- Real-time status updates
- Permission-based access control

Default Jobs:
- Session cleanup (daily at 3am)
- Export cleanup (daily at 4am)
- Audit log archival (weekly, inactive)
- Database backup (daily at 1am, inactive)

Documentation:
- Comprehensive feature documentation
- Handler creation guide
- Cron expression reference
- Troubleshooting guide

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

## Next Steps

1. Verify all files exist
2. Run database migration
3. Seed default jobs
4. Test the feature end-to-end
5. Add menu item for navigation
6. Commit and push changes
7. Create pull request

## Notes

- The scheduler uses BullMQ which requires Redis
- Cron expressions are validated before saving
- Job handlers return structured results (success/output/error)
- All job executions are logged to database
- Frontend auto-refreshes job status every 5-10 seconds
- Permissions: scheduler:view, scheduler:create, scheduler:edit, scheduler:delete, scheduler:execute
