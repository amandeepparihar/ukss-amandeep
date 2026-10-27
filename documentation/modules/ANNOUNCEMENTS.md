# Announcements Module

## Overview

The Announcements module provides a system banner notification feature including:
- Admin-created announcements with targeting
- Time-based scheduling (start/end dates)
- Role-based targeting
- Page-specific display
- User dismissal tracking
- Priority-based ordering

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANNOUNCEMENTS SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                   Admin Dashboard                       │     │
│  │                                                         │     │
│  │  Create/Edit Announcements:                            │     │
│  │  - Title, Content                                      │     │
│  │  - Type (Info, Warning, Success, Error)               │     │
│  │  - Target Roles (or all users)                        │     │
│  │  - Start/End Dates                                    │     │
│  │  - Priority (1-10)                                    │     │
│  │  - Dismissable (yes/no)                              │     │
│  └────────────────────────────────────────────────────────┘     │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                   Announcement DB                       │     │
│  │                                                         │     │
│  │  - Filter: isActive, startsAt, endsAt                 │     │
│  │  - Target: targetRoles[]                              │     │
│  │  - Dismiss: AnnouncementDismissal                     │     │
│  └────────────────────────────────────────────────────────┘     │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────┐     │
│  │               AnnouncementBanner (UI)                   │     │
│  │                                                         │     │
│  │  ┌─────────────────────────────────────────────────┐   │     │
│  │  │ ⚠️ Scheduled maintenance on Dec 20th...    [X] │   │     │
│  │  └─────────────────────────────────────────────────┘   │     │
│  │  ┌─────────────────────────────────────────────────┐   │     │
│  │  │ ℹ️ New feature available: Dark mode!       [X] │   │     │
│  │  └─────────────────────────────────────────────────┘   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

```prisma
enum AnnouncementType {
  INFO
  WARNING
  SUCCESS
  ERROR
}

model Announcement {
  id          String             @id @default(cuid())

  title       String
  content     String             // Markdown supported
  type        AnnouncementType   @default(INFO)

  // Visibility
  isActive    Boolean            @default(true)
  startsAt    DateTime?          // Start showing
  endsAt      DateTime?          // Stop showing

  // Targeting
  targetRoles String[]           // Empty = all users
  dismissable Boolean            @default(true)

  // Display options
  showOnPages String[]           // Empty = all pages
  priority    Int                @default(5) // 1 = highest

  // Tracking
  createdById String

  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([isActive])
  @@index([startsAt])
  @@index([endsAt])
  @@index([priority])
}

model AnnouncementDismissal {
  id             String   @id @default(cuid())
  userId         String
  announcementId String
  dismissedAt    DateTime @default(now())

  @@unique([userId, announcementId])
  @@index([userId])
  @@index([announcementId])
}
```

## API Endpoints

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/announcements` | List all (admin) | `announcements:view` |
| GET | `/api/announcements/active` | Get active for user | Authenticated |
| GET | `/api/announcements/:id` | Get single | `announcements:view` |
| POST | `/api/announcements` | Create | `announcements:create` |
| PUT | `/api/announcements/:id` | Update | `announcements:edit` |
| DELETE | `/api/announcements/:id` | Delete | `announcements:delete` |
| POST | `/api/announcements/:id/dismiss` | Dismiss for user | Authenticated |

---

## Quick Start

### Displaying Announcements

The AnnouncementBanner component is already integrated into the AppShell layout. Active announcements automatically appear for users.

```tsx
// apps/web/src/components/layout/AppShell.tsx
import { AnnouncementBanner } from './AnnouncementBanner';

export function AppShell({ children }) {
  return (
    <div>
      <Header />
      <AnnouncementBanner />  {/* Banners appear here */}
      <main>{children}</main>
    </div>
  );
}
```

### Creating an Announcement (Admin UI)

1. Navigate to **Announcements** in the sidebar
2. Click **"Create Announcement"**
3. Fill in the form:
   - **Title**: Brief heading
   - **Content**: Full message (Markdown supported)
   - **Type**: Info, Warning, Success, or Error
   - **Start Date**: When to start showing (optional)
   - **End Date**: When to stop showing (optional)
   - **Target Roles**: Leave empty for all users
   - **Dismissable**: Allow users to dismiss
   - **Priority**: Lower = higher priority (1-10)
4. Click **Save**

### Creating an Announcement (API)

```typescript
// Create a scheduled maintenance announcement
const response = await api.post('/announcements', {
  title: 'Scheduled Maintenance',
  content: 'The system will be undergoing maintenance on **December 20th** from 2:00 AM to 4:00 AM UTC.',
  type: 'WARNING',
  startsAt: '2024-12-18T00:00:00Z',
  endsAt: '2024-12-20T04:00:00Z',
  targetRoles: [],  // All users
  dismissable: false,  // Important - can't dismiss
  priority: 1,  // Highest priority
});
```

---

## Announcement Types & Styling

| Type | Icon | Color | Use Case |
|------|------|-------|----------|
| `INFO` | Info | Blue | General information, features |
| `WARNING` | AlertTriangle | Yellow | Maintenance, alerts |
| `SUCCESS` | CheckCircle | Green | Positive news, completed actions |
| `ERROR` | XCircle | Red | Critical issues, outages |

```tsx
// Type styling configuration
const typeConfig = {
  INFO: {
    icon: Info,
    bgClass: 'bg-blue-50 dark:bg-blue-950 border-blue-200',
    textClass: 'text-blue-800 dark:text-blue-200',
    iconClass: 'text-blue-500',
  },
  WARNING: {
    icon: AlertTriangle,
    bgClass: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200',
    textClass: 'text-yellow-800 dark:text-yellow-200',
    iconClass: 'text-yellow-500',
  },
  SUCCESS: {
    icon: CheckCircle,
    bgClass: 'bg-green-50 dark:bg-green-950 border-green-200',
    textClass: 'text-green-800 dark:text-green-200',
    iconClass: 'text-green-500',
  },
  ERROR: {
    icon: XCircle,
    bgClass: 'bg-red-50 dark:bg-red-950 border-red-200',
    textClass: 'text-red-800 dark:text-red-200',
    iconClass: 'text-red-500',
  },
};
```

---

## Targeting Options

### All Users
```typescript
{
  targetRoles: [],  // Empty array = all users
}
```

### Specific Roles
```typescript
{
  targetRoles: ['admin', 'manager'],  // Only admins and managers see this
}
```

### Time-Based Visibility

```typescript
// Show only during a specific period
{
  startsAt: '2024-12-01T00:00:00Z',  // Start showing Dec 1
  endsAt: '2024-12-31T23:59:59Z',    // Stop showing Dec 31
}

// Show immediately, end on specific date
{
  startsAt: null,                     // Show immediately
  endsAt: '2024-12-20T04:00:00Z',    // Until Dec 20
}

// Show starting from a date, no end
{
  startsAt: '2024-12-01T00:00:00Z',
  endsAt: null,                       // Show indefinitely
}
```

### Page-Specific (Future Feature)
```typescript
{
  showOnPages: ['/dashboard', '/orders'],  // Only show on these pages
}
```

---

## Real-World Examples

### Example 1: System Maintenance Notice

```typescript
// Create 3 days before maintenance
await api.post('/announcements', {
  title: 'Scheduled System Maintenance',
  content: `
## Planned Downtime

We will be performing scheduled maintenance on **Saturday, December 20th, 2024**.

**Duration:** 2:00 AM - 4:00 AM UTC (approximately 2 hours)

**Impact:** The system will be unavailable during this time.

Please save your work before the maintenance window begins.
  `.trim(),
  type: 'WARNING',
  startsAt: '2024-12-17T00:00:00Z',  // Show 3 days before
  endsAt: '2024-12-20T04:00:00Z',    // Hide after maintenance
  targetRoles: [],
  dismissable: false,  // Important - don't allow dismissal
  priority: 1,
});
```

### Example 2: New Feature Announcement

```typescript
await api.post('/announcements', {
  title: '🎉 New Feature: Dark Mode',
  content: `
We've added dark mode support!

Go to **Settings → Appearance** to try it out.
  `.trim(),
  type: 'SUCCESS',
  startsAt: null,  // Show immediately
  endsAt: '2024-12-31T23:59:59Z',  // Show for 2 weeks
  targetRoles: [],
  dismissable: true,
  priority: 5,
});
```

### Example 3: Admin-Only Notice

```typescript
await api.post('/announcements', {
  title: 'Admin Notice: New User Verification Required',
  content: `
There are **15 new users** pending verification.

Please review and approve new user accounts in the Users section.
  `.trim(),
  type: 'INFO',
  startsAt: null,
  endsAt: null,  // Show until dismissed
  targetRoles: ['admin', 'super_admin'],  // Only admins
  dismissable: true,
  priority: 3,
});
```

### Example 4: Critical System Alert

```typescript
await api.post('/announcements', {
  title: '🚨 Critical: Payment Processing Issue',
  content: `
We are currently experiencing issues with payment processing.

Our team is actively working on a fix. Please do not retry failed payments.

**Status:** Investigating
**Last Updated:** ${new Date().toISOString()}
  `.trim(),
  type: 'ERROR',
  startsAt: null,
  endsAt: null,  // Manual removal when fixed
  targetRoles: [],
  dismissable: false,  // Can't dismiss critical alerts
  priority: 1,
});
```

---

## Frontend Implementation

### AnnouncementBanner Component

```tsx
// apps/web/src/components/layout/AnnouncementBanner.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, AlertTriangle, CheckCircle, XCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
  dismissable: boolean;
}

const typeConfig = {
  INFO: {
    icon: Info,
    bgClass: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-800 dark:text-blue-200',
    iconClass: 'text-blue-500',
  },
  WARNING: {
    icon: AlertTriangle,
    bgClass: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800',
    textClass: 'text-yellow-800 dark:text-yellow-200',
    iconClass: 'text-yellow-500',
  },
  SUCCESS: {
    icon: CheckCircle,
    bgClass: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
    textClass: 'text-green-800 dark:text-green-200',
    iconClass: 'text-green-500',
  },
  ERROR: {
    icon: XCircle,
    bgClass: 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800',
    textClass: 'text-red-800 dark:text-red-200',
    iconClass: 'text-red-500',
  },
};

export function AnnouncementBanner() {
  const queryClient = useQueryClient();

  // Fetch active announcements
  const { data: announcements = [] } = useQuery({
    queryKey: ['active-announcements'],
    queryFn: async () => {
      const response = await api.get('/announcements/active');
      return response.data.data as Announcement[];
    },
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/announcements/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
    },
  });

  if (announcements.length === 0) return null;

  return (
    <div className="space-y-0">
      {announcements.map((announcement) => {
        const config = typeConfig[announcement.type];
        const Icon = config.icon;

        return (
          <div
            key={announcement.id}
            className={cn(
              'flex items-center gap-3 px-4 py-2 border-b',
              config.bgClass
            )}
          >
            <Icon className={cn('h-5 w-5 flex-shrink-0', config.iconClass)} />

            <div className={cn('flex-1', config.textClass)}>
              <span className="font-semibold">{announcement.title}</span>
              {announcement.content && (
                <span className="ml-2">{announcement.content}</span>
              )}
            </div>

            {announcement.dismissable && (
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-6 w-6 p-0', config.textClass)}
                onClick={() => dismissMutation.mutate(announcement.id)}
                disabled={dismissMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### Announcements Management Page

```tsx
// apps/web/src/pages/announcements/AnnouncementsPage.tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { usePermission } from '@/hooks/useAuth';
import { DataTable } from '@/components/data-table/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export function AnnouncementsPage() {
  const canCreate = usePermission('announcements:create');
  const canEdit = usePermission('announcements:edit');
  const canDelete = usePermission('announcements:delete');

  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const res = await api.get('/announcements');
      return res.data.data;
    },
  });

  const columns = [
    {
      accessorKey: 'title',
      header: 'Title',
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('type');
        const colors = {
          INFO: 'bg-blue-100 text-blue-800',
          WARNING: 'bg-yellow-100 text-yellow-800',
          SUCCESS: 'bg-green-100 text-green-800',
          ERROR: 'bg-red-100 text-red-800',
        };
        return <Badge className={colors[type]}>{type}</Badge>;
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.getValue('isActive') ? 'default' : 'secondary'}>
          {row.getValue('isActive') ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'targetRoles',
      header: 'Target',
      cell: ({ row }) => {
        const roles = row.getValue('targetRoles') as string[];
        return roles.length === 0 ? 'All Users' : roles.join(', ');
      },
    },
    {
      accessorKey: 'startsAt',
      header: 'Start Date',
      cell: ({ row }) => row.getValue('startsAt')
        ? formatDate(row.getValue('startsAt'))
        : 'Immediate',
    },
    {
      accessorKey: 'endsAt',
      header: 'End Date',
      cell: ({ row }) => row.getValue('endsAt')
        ? formatDate(row.getValue('endsAt'))
        : 'No End',
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => handleEdit(row.original)}>
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" onClick={() => handleDelete(row.original.id)}>
              <Trash className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Announcements</h1>
        {canCreate && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Announcement
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data || []}
        isLoading={isLoading}
      />
    </div>
  );
}
```

---

## Backend Implementation

### Active Announcements Query

```typescript
// apps/api/src/modules/announcements/announcements.routes.ts
app.get('/active', {
  preHandler: [app.authenticate],
}, async (request) => {
  const userId = request.user.sub;
  const now = new Date();

  // Get user's role for targeting
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });

  // Get dismissed announcements for this user
  const dismissals = await prisma.announcementDismissal.findMany({
    where: { userId },
    select: { announcementId: true },
  });
  const dismissedIds = dismissals.map((d) => d.announcementId);

  // Query active announcements
  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      // Time-based filtering
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      // Exclude dismissed (only if dismissable)
      NOT: {
        AND: [
          { dismissable: true },
          { id: { in: dismissedIds } },
        ],
      },
    },
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'desc' },
    ],
  });

  // Filter by user's role
  const filtered = announcements.filter((a) => {
    if (a.targetRoles.length === 0) return true;
    return a.targetRoles.includes(user.role.name);
  });

  return { data: filtered };
});
```

### Dismissal Endpoint

```typescript
app.post('/:id/dismiss', {
  preHandler: [app.authenticate],
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const userId = request.user.sub;

  const announcement = await prisma.announcement.findUnique({
    where: { id },
  });

  if (!announcement) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Announcement not found' },
    });
  }

  if (!announcement.dismissable) {
    return reply.status(400).send({
      error: { code: 'NOT_DISMISSABLE', message: 'This announcement cannot be dismissed' },
    });
  }

  // Upsert to handle duplicate dismissals gracefully
  await prisma.announcementDismissal.upsert({
    where: {
      userId_announcementId: { userId, announcementId: id },
    },
    create: { userId, announcementId: id },
    update: {},
  });

  return { data: { success: true } };
});
```

---

## Best Practices

### 1. Set Appropriate Priority
```typescript
// Priority 1: Critical issues, outages
// Priority 2-3: Important notices
// Priority 4-6: General announcements
// Priority 7-10: Minor updates, tips

// System outage
{ type: 'ERROR', priority: 1, dismissable: false }

// Maintenance notice
{ type: 'WARNING', priority: 2, dismissable: false }

// New feature
{ type: 'SUCCESS', priority: 5, dismissable: true }

// Helpful tip
{ type: 'INFO', priority: 8, dismissable: true }
```

### 2. Use Time Boundaries
```typescript
// Don't show indefinitely - set end dates
{
  startsAt: '2024-12-01T00:00:00Z',
  endsAt: '2024-12-15T23:59:59Z',  // 2 weeks max
}
```

### 3. Keep Content Concise
```typescript
// Good: Brief and actionable
{
  title: 'System Update',
  content: 'New features available. [Learn more](/changelog)',
}

// Bad: Too much text
{
  title: 'System Update',
  content: 'We have just released a major system update that includes...' // 500 words
}
```

### 4. Target Appropriately
```typescript
// Admin-only issues should target admins
{
  title: 'Server capacity alert',
  targetRoles: ['admin', 'devops'],
}

// User-facing features for everyone
{
  title: 'New checkout process',
  targetRoles: [],
}
```

---

## Troubleshooting

### Announcement Not Showing
1. Check `isActive` is true
2. Verify current time is within `startsAt` and `endsAt`
3. Check user's role matches `targetRoles`
4. Verify user hasn't dismissed it (if `dismissable`)

### Can't Dismiss Announcement
- Check `dismissable` is set to `true`
- Verify API endpoint is returning 200

### Old Announcements Still Showing
- Set `endsAt` date when creating
- Manually toggle `isActive` to false
- Delete old announcements

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/announcements/announcements.routes.ts` | API endpoints |
| `apps/api/prisma/schema.prisma` | Database models |
| `apps/web/src/components/layout/AnnouncementBanner.tsx` | Display component |
| `apps/web/src/pages/announcements/AnnouncementsPage.tsx` | Management page |
| `apps/web/src/components/layout/AppShell.tsx` | Layout integration |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/32
