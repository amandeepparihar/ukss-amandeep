# Roles & Permissions Module

## Overview

The Roles & Permissions module implements Role-Based Access Control (RBAC) for the admin panel. It allows you to:
- Create and manage roles
- Assign granular permissions to roles
- Protect routes and components based on permissions
- Check permissions programmatically

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    RBAC ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User ──► Role ──► Permissions[]                                │
│                                                                  │
│  Permission Format: "resource:action"                           │
│  Examples: "users:view", "users:create", "orders:delete"        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Models

```prisma
model Role {
  id          String       @id @default(cuid())
  name        String       @unique
  description String?
  isSystem    Boolean      @default(false)  // Protected from deletion
  permissions Permission[]
  users       User[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Permission {
  id       String @id @default(cuid())
  resource String  // e.g., "users", "orders", "reports"
  action   String  // e.g., "view", "create", "edit", "delete"
  roleId   String
  role     Role   @relation(fields: [roleId], references: [id])

  @@unique([roleId, resource, action])
}
```

## API Endpoints

| Method | Endpoint | Description | Permission Required |
|--------|----------|-------------|---------------------|
| GET | `/api/roles` | List all roles | `roles:view` |
| GET | `/api/roles/:id` | Get role details | `roles:view` |
| POST | `/api/roles` | Create new role | `roles:create` |
| PUT | `/api/roles/:id` | Update role | `roles:edit` |
| DELETE | `/api/roles/:id` | Delete role | `roles:delete` |
| PUT | `/api/roles/:id/permissions` | Update permissions | `roles:edit` |

---

## Quick Start Guide

### 1. Creating a New Role (Admin UI)

1. Navigate to **Roles** in the sidebar
2. Click **"Add Role"** button
3. Fill in:
   - **Name**: Unique role name (e.g., "Sales Manager")
   - **Description**: What this role is for
4. Click **Save**
5. Click the **permissions icon** on the role card
6. Check the permissions you want to grant
7. Click **Save Permissions**

### 2. Creating a New Role (Programmatically)

```typescript
// Backend: apps/api/src/modules/roles/roles.service.ts
const newRole = await prisma.role.create({
  data: {
    name: 'Sales Manager',
    description: 'Can manage sales and view reports',
    permissions: {
      create: [
        { resource: 'orders', action: 'view' },
        { resource: 'orders', action: 'create' },
        { resource: 'orders', action: 'edit' },
        { resource: 'reports', action: 'view' },
      ]
    }
  }
});
```

---

## Adding New Permission Types

### Step 1: Define the Resource in Shared Package

Edit `packages/shared/src/constants/permissions.ts`:

```typescript
export const RESOURCES = {
  USERS: 'users',
  ROLES: 'roles',
  AUDIT_LOGS: 'audit-logs',
  SETTINGS: 'settings',
  // Add your new resource
  REPORTS: 'reports',
  INVENTORY: 'inventory',
} as const;

export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  // Add custom actions
  EXPORT: 'export',
  APPROVE: 'approve',
} as const;

// All available permissions
export const ALL_PERMISSIONS = [
  // Existing
  'users:view', 'users:create', 'users:edit', 'users:delete',
  'roles:view', 'roles:create', 'roles:edit', 'roles:delete',
  // Your new permissions
  'reports:view', 'reports:export',
  'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:delete',
];
```

### Step 2: Update Permission Groups for UI

Edit `apps/web/src/pages/roles/PermissionsDialog.tsx`:

```typescript
const PERMISSION_GROUPS = [
  {
    name: 'Users',
    resource: 'users',
    permissions: ['view', 'create', 'edit', 'delete'],
  },
  {
    name: 'Roles',
    resource: 'roles',
    permissions: ['view', 'create', 'edit', 'delete'],
  },
  // Add your new group
  {
    name: 'Reports',
    resource: 'reports',
    permissions: ['view', 'export'],
  },
  {
    name: 'Inventory',
    resource: 'inventory',
    permissions: ['view', 'create', 'edit', 'delete'],
  },
];
```

---

## Protecting Routes

### Backend Route Protection

```typescript
// apps/api/src/modules/reports/reports.routes.ts
import { FastifyInstance } from 'fastify';

export async function reportsRoutes(app: FastifyInstance) {
  // Require authentication + specific permission
  app.get('/reports', {
    preHandler: [
      app.authenticate,  // Must be logged in
      app.requirePermission('reports:view')  // Must have this permission
    ]
  }, async (request, reply) => {
    // Only users with reports:view permission reach here
    const reports = await getReports();
    return { data: reports };
  });

  app.post('/reports/export', {
    preHandler: [
      app.authenticate,
      app.requirePermission('reports:export')
    ]
  }, async (request, reply) => {
    // Only users with reports:export permission reach here
    const file = await exportReports();
    return reply.send(file);
  });
}
```

### Frontend Route Protection

```tsx
// apps/web/src/routes/index.tsx
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const routes = [
  {
    path: '/reports',
    element: (
      <ProtectedRoute permission="reports:view">
        <ReportsPage />
      </ProtectedRoute>
    ),
  },
];
```

### Frontend Component Protection

```tsx
// apps/web/src/pages/reports/ReportsPage.tsx
import { usePermission } from '@/hooks/useAuth';

export function ReportsPage() {
  const canExport = usePermission('reports:export');
  const canEdit = usePermission('reports:edit');

  return (
    <div>
      <h1>Reports</h1>

      {/* Show export button only if user has permission */}
      {canExport && (
        <Button onClick={handleExport}>
          Export Reports
        </Button>
      )}

      {/* Conditionally render edit actions */}
      {canEdit && (
        <Button onClick={handleEdit}>
          Edit Report
        </Button>
      )}
    </div>
  );
}
```

### Using PermissionGate Component

```tsx
import { PermissionGate } from '@/components/auth/PermissionGate';

function Dashboard() {
  return (
    <div>
      {/* Only renders children if user has permission */}
      <PermissionGate permission="reports:view">
        <ReportWidget />
      </PermissionGate>

      {/* With fallback content */}
      <PermissionGate
        permission="admin:view"
        fallback={<p>You don't have admin access</p>}
      >
        <AdminPanel />
      </PermissionGate>

      {/* Multiple permissions (requires ALL) */}
      <PermissionGate permissions={['orders:view', 'orders:edit']}>
        <OrderEditor />
      </PermissionGate>
    </div>
  );
}
```

---

## Real-World Example: Adding "Reports" Module

### Step 1: Define Permissions

```typescript
// packages/shared/src/constants/permissions.ts
export const REPORT_PERMISSIONS = [
  'reports:view',      // View reports list
  'reports:create',    // Create new reports
  'reports:edit',      // Edit existing reports
  'reports:delete',    // Delete reports
  'reports:export',    // Export reports to CSV/PDF
  'reports:schedule',  // Schedule automated reports
];
```

### Step 2: Create Backend Routes with Protection

```typescript
// apps/api/src/modules/reports/reports.routes.ts
import { FastifyInstance } from 'fastify';
import { reportsService } from './reports.service';

export async function reportsRoutes(app: FastifyInstance) {
  // List reports - requires view permission
  app.get('/', {
    preHandler: [app.authenticate, app.requirePermission('reports:view')]
  }, async (request, reply) => {
    const reports = await reportsService.findAll(request.query);
    return { data: reports };
  });

  // Create report - requires create permission
  app.post('/', {
    preHandler: [app.authenticate, app.requirePermission('reports:create')]
  }, async (request, reply) => {
    const report = await reportsService.create(request.body);
    return { data: report };
  });

  // Export report - requires export permission
  app.post('/:id/export', {
    preHandler: [app.authenticate, app.requirePermission('reports:export')]
  }, async (request, reply) => {
    const file = await reportsService.export(request.params.id);
    return reply
      .header('Content-Disposition', 'attachment; filename=report.pdf')
      .send(file);
  });

  // Schedule report - requires schedule permission
  app.post('/:id/schedule', {
    preHandler: [app.authenticate, app.requirePermission('reports:schedule')]
  }, async (request, reply) => {
    const schedule = await reportsService.schedule(request.params.id, request.body);
    return { data: schedule };
  });
}
```

### Step 3: Register Routes in App

```typescript
// apps/api/src/app.ts
import { reportsRoutes } from './modules/reports/reports.routes';

// Register with prefix
app.register(reportsRoutes, { prefix: '/api/reports' });
```

### Step 4: Create Frontend Page with Permission Checks

```tsx
// apps/web/src/pages/reports/ReportsPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermission } from '@/hooks/useAuth';
import { DataTable } from '@/components/data-table/DataTable';
import { Button } from '@/components/ui/button';
import { Plus, Download, Calendar } from 'lucide-react';

export function ReportsPage() {
  // Check permissions
  const canCreate = usePermission('reports:create');
  const canExport = usePermission('reports:export');
  const canSchedule = usePermission('reports:schedule');
  const canDelete = usePermission('reports:delete');

  // Fetch reports
  const { data, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => api.get('/reports'),
  });

  // Define columns with permission-based actions
  const columns = [
    { accessorKey: 'name', header: 'Report Name' },
    { accessorKey: 'createdAt', header: 'Created' },
    { accessorKey: 'status', header: 'Status' },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          {canExport && (
            <Button size="sm" variant="outline" onClick={() => handleExport(row.id)}>
              <Download className="h-4 w-4" />
            </Button>
          )}
          {canSchedule && (
            <Button size="sm" variant="outline" onClick={() => handleSchedule(row.id)}>
              <Calendar className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="destructive" onClick={() => handleDelete(row.id)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Reports</h1>

        {canCreate && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Report
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        isLoading={isLoading}
      />
    </div>
  );
}
```

### Step 5: Add Menu Item with Permission Check

```typescript
// apps/web/src/config/menu.ts
export const menuItems = [
  // ... other items
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart,
    permission: 'reports:view',  // Only show if user has this permission
  },
];
```

### Step 6: Add Route to Router

```tsx
// apps/web/src/routes/index.tsx
import { ReportsPage } from '@/pages/reports/ReportsPage';

const routes = [
  // ... other routes
  {
    path: '/reports',
    element: (
      <ProtectedRoute permission="reports:view">
        <ReportsPage />
      </ProtectedRoute>
    ),
  },
];
```

### Step 7: Update Permission Groups in UI

```typescript
// apps/web/src/pages/roles/PermissionsDialog.tsx
const PERMISSION_GROUPS = [
  // ... existing groups
  {
    name: 'Reports',
    resource: 'reports',
    permissions: [
      { action: 'view', label: 'View Reports' },
      { action: 'create', label: 'Create Reports' },
      { action: 'edit', label: 'Edit Reports' },
      { action: 'delete', label: 'Delete Reports' },
      { action: 'export', label: 'Export Reports' },
      { action: 'schedule', label: 'Schedule Reports' },
    ],
  },
];
```

---

## Permission Middleware Implementation

The `requirePermission` middleware is implemented as a Fastify decorator:

```typescript
// apps/api/src/plugins/auth.ts
fastify.decorate('requirePermission', (permission: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // User must be authenticated first
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Get user's permissions from their role
    const userPermissions = request.user.role?.permissions || [];

    // Check if user has the required permission
    const hasPermission = userPermissions.some(
      (p) => `${p.resource}:${p.action}` === permission
    );

    if (!hasPermission) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: `Missing permission: ${permission}`
      });
    }
  };
});
```

---

## System Roles

System roles (`isSystem: true`) cannot be deleted. By default, the following system roles are seeded:

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| Super Admin | Full access | All permissions |
| Admin | Administrative access | Most permissions except system |
| User | Basic user access | View own profile, limited access |

To protect a role from deletion:

```typescript
await prisma.role.create({
  data: {
    name: 'Critical Role',
    isSystem: true,  // This prevents deletion
    permissions: { ... }
  }
});
```

---

## Best Practices

### 1. Use Consistent Naming
```
resource:action
✓ users:view
✓ orders:create
✓ reports:export
✗ viewUsers
✗ create_orders
```

### 2. Group Related Permissions
```typescript
// Good: Grouped by resource
'orders:view', 'orders:create', 'orders:edit', 'orders:delete'

// Bad: Mixed resources
'view-orders', 'edit-users', 'delete-orders'
```

### 3. Check Permissions at Both Layers
- **Backend**: Always use `requirePermission` middleware
- **Frontend**: Use `usePermission` to hide UI elements

### 4. Don't Hardcode Permission Checks
```typescript
// Bad
if (user.role.name === 'Admin') { ... }

// Good
if (usePermission('reports:view')) { ... }
```

### 5. Provide Fallback UI
```tsx
<PermissionGate
  permission="admin:view"
  fallback={<AccessDenied />}
>
  <AdminPanel />
</PermissionGate>
```

---

## Troubleshooting

### Permission Not Working

1. **Check role has permission assigned**
   ```sql
   SELECT * FROM Permission WHERE roleId = 'role-id';
   ```

2. **Verify user has correct role**
   ```sql
   SELECT * FROM User WHERE id = 'user-id';
   ```

3. **Check permission format**
   - Must be `resource:action` format
   - Case-sensitive

### 403 Forbidden Error

1. Check the error response for which permission is missing
2. Verify the permission exists in the database
3. Ensure the user's session is valid and not expired

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/roles/` | Backend role management |
| `apps/api/src/plugins/auth.ts` | Permission middleware |
| `apps/web/src/pages/roles/` | Frontend role management |
| `apps/web/src/hooks/useAuth.ts` | `usePermission` hook |
| `packages/shared/src/constants/` | Permission constants |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/24
