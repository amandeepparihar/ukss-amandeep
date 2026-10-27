# Audit Logs Module

## Overview

The Audit Logs module provides comprehensive activity tracking including:
- User actions (CRUD operations)
- Authentication events (login, logout, 2FA)
- Resource changes with before/after values
- Metadata capture (IP, user agent)
- Searchable, filterable log viewer

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUDIT LOG SYSTEM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Services create audit logs directly after operations:          │
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │ AuthService  │     │ UsersService │     │ RolesService │    │
│  │              │     │              │     │              │    │
│  │  - login     │     │  - create    │     │  - create    │    │
│  │  - logout    │     │  - update    │     │  - update    │    │
│  │  - 2FA       │     │  - delete    │     │  - delete    │    │
│  │  - password  │     │              │     │              │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                    │             │
│         └────────────────────┴────────────────────┘             │
│                              │                                   │
│                              ▼                                   │
│                    ┌──────────────────┐                         │
│                    │   AuditLog DB    │                         │
│                    │                  │                         │
│                    │  - userId        │                         │
│                    │  - action        │                         │
│                    │  - resource      │                         │
│                    │  - oldValues     │                         │
│                    │  - newValues     │                         │
│                    │  - metadata      │                         │
│                    └──────────────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  action     String   // "login", "logout", "create", "update", "delete"
  resource   String   // "user", "role", "session", "menu_item"
  resourceId String?  // ID of affected resource

  oldValues  Json?    // Previous state (for updates/deletes)
  newValues  Json?    // New state (for creates/updates)
  metadata   Json?    // Additional context (IP, user agent)

  createdAt  DateTime @default(now())

  @@index([userId])
  @@index([action])
  @@index([resource])
  @@index([resourceId])
  @@index([createdAt])
}
```

## API Endpoints

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/audit-logs` | List logs with filters | `audit-logs:view` |
| GET | `/api/audit-logs/:id` | Get single log | `audit-logs:view` |
| GET | `/api/audit-logs/stats` | Get statistics | `audit-logs:view` |

---

## Logged Events

### Authentication Events

| Action | Resource | When |
|--------|----------|------|
| `login` | session | User logs in |
| `logout` | session | User logs out |
| `password_reset` | user | Password reset via token |
| `password_change` | user | Password changed |
| `2fa_enabled` | user | 2FA enabled |
| `2fa_disabled` | user | 2FA disabled |
| `2fa_backup_codes_regenerated` | user | Backup codes regenerated |
| `revoke_session` | session | Session terminated |

### User Management Events

| Action | Resource | When |
|--------|----------|------|
| `create` | user | New user created |
| `update` | user | User details updated |
| `delete` | user | User deleted |

### Role Management Events

| Action | Resource | When |
|--------|----------|------|
| `create` | role | New role created |
| `update` | role | Role updated |
| `delete` | role | Role deleted |
| `update_permissions` | role | Role permissions changed |

### Menu Management Events

| Action | Resource | When |
|--------|----------|------|
| `create` | menu_item | Menu item created |
| `update` | menu_item | Menu item updated |
| `delete` | menu_item | Menu item deleted |
| `reorder` | menu_item | Menu order changed |

---

## Quick Start

### Viewing Audit Logs

The audit logs page is available at `/audit-logs` for users with the `audit-logs:view` permission.

```tsx
// Access audit logs page
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AuditLogsPage } from '@/pages/audit/AuditLogsPage';

// In your router
{
  path: '/audit-logs',
  element: (
    <ProtectedRoute permission="audit-logs:view">
      <AuditLogsPage />
    </ProtectedRoute>
  ),
}
```

### Fetching Audit Logs via API

```typescript
// Fetch audit logs with filters
const response = await api.get('/audit-logs', {
  params: {
    page: 1,
    pageSize: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    action: 'login',           // Filter by action
    resource: 'session',       // Filter by resource
    userId: 'user_123',        // Filter by user
    search: 'admin@example',   // Search in email, action, resource
    dateFrom: '2024-01-01',    // Filter by date range
    dateTo: '2024-12-31',
  },
});

// Response
{
  "data": [
    {
      "id": "audit_abc123",
      "userId": "user_123",
      "user": {
        "id": "user_123",
        "email": "admin@example.com",
        "name": "Admin User"
      },
      "action": "login",
      "resource": "session",
      "resourceId": null,
      "oldValues": null,
      "newValues": null,
      "metadata": {
        "ip": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      },
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "total": 1000,
    "page": 1,
    "pageSize": 20,
    "totalPages": 50
  }
}
```

---

## Creating Audit Logs

### In Service Methods

Audit logs are created directly in service methods after the primary operation succeeds:

```typescript
// apps/api/src/modules/users/users.service.ts
export const usersService = {
  async create(data: CreateUserData, createdBy: string) {
    // 1. Perform the operation
    const user = await prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        roleId: data.roleId,
        passwordHash: await hashPassword(data.password),
      },
    });

    // 2. Create audit log
    await prisma.auditLog.create({
      data: {
        userId: createdBy,
        action: 'create',
        resource: 'user',
        resourceId: user.id,
        newValues: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleId: user.roleId,
        },
      },
    });

    return user;
  },

  async update(id: string, data: UpdateUserData, updatedBy: string) {
    // 1. Get existing state for oldValues
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new Error('User not found');

    // 2. Perform the update
    const updated = await prisma.user.update({
      where: { id },
      data,
    });

    // 3. Create audit log with old and new values
    await prisma.auditLog.create({
      data: {
        userId: updatedBy,
        action: 'update',
        resource: 'user',
        resourceId: id,
        oldValues: {
          email: existing.email,
          firstName: existing.firstName,
          lastName: existing.lastName,
          roleId: existing.roleId,
          isActive: existing.isActive,
        },
        newValues: data,
      },
    });

    return updated;
  },

  async delete(id: string, deletedBy: string) {
    // 1. Get existing state
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error('User not found');

    // 2. Perform delete
    await prisma.user.delete({ where: { id } });

    // 3. Create audit log
    await prisma.auditLog.create({
      data: {
        userId: deletedBy,
        action: 'delete',
        resource: 'user',
        resourceId: id,
        oldValues: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
    });
  },
};
```

### Authentication Logging

```typescript
// apps/api/src/modules/auth/auth.service.ts
class AuthService {
  private async createAuditLog(
    userId: string,
    action: string,
    resource: string,
    resourceId: string | null,
    metadata: Record<string, unknown>
  ) {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resource,
        resourceId,
        metadata,
      },
    });
  }

  async login(email: string, password: string, request: FastifyRequest) {
    // ... authentication logic ...

    // Log successful login with metadata
    await this.createAuditLog(user.id, 'login', 'session', null, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      method: '2fa_authenticator', // or 'password', '2fa_email'
    });

    return { accessToken, refreshToken };
  }

  async logout(userId: string) {
    // ... logout logic ...

    await this.createAuditLog(userId, 'logout', 'session', null, {});
  }
}
```

---

## Adding Audit Logging to a New Module

### Step 1: Identify Events to Log

```typescript
// For a new "orders" module, log these events:
// - create: New order placed
// - update: Order details changed
// - delete: Order deleted
// - status_change: Order status changed (custom action)
```

### Step 2: Add Logging to Service

```typescript
// apps/api/src/modules/orders/orders.service.ts
export const ordersService = {
  async create(data: CreateOrderData, userId: string) {
    const order = await prisma.order.create({ data });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'create',
        resource: 'order',
        resourceId: order.id,
        newValues: {
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          status: order.status,
          customerId: order.customerId,
        },
      },
    });

    return order;
  },

  async updateStatus(id: string, newStatus: string, userId: string) {
    const order = await prisma.order.findUnique({ where: { id } });

    const updated = await prisma.order.update({
      where: { id },
      data: { status: newStatus },
    });

    // Custom action for status changes
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'status_change',
        resource: 'order',
        resourceId: id,
        oldValues: { status: order.status },
        newValues: { status: newStatus },
        metadata: {
          orderNumber: order.orderNumber,
        },
      },
    });

    return updated;
  },
};
```

### Step 3: Update Filter Options in UI

```tsx
// apps/web/src/pages/audit/AuditLogsPage.tsx
const filterableColumns: FilterableColumn[] = [
  {
    id: 'action',
    title: 'Action',
    options: [
      { label: 'Create', value: 'create' },
      { label: 'Update', value: 'update' },
      { label: 'Delete', value: 'delete' },
      { label: 'Login', value: 'login' },
      { label: 'Logout', value: 'logout' },
      { label: 'Status Change', value: 'status_change' }, // New action
    ],
  },
  {
    id: 'resource',
    title: 'Resource',
    options: [
      { label: 'User', value: 'user' },
      { label: 'Role', value: 'role' },
      { label: 'Session', value: 'session' },
      { label: 'Order', value: 'order' }, // New resource
    ],
  },
];
```

---

## Real-World Example: Complete Order Module with Audit Logging

### Order Service

```typescript
// apps/api/src/modules/orders/orders.service.ts
import { prisma } from '@/lib/prisma';

interface AuditContext {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export const ordersService = {
  async create(data: CreateOrderData, ctx: AuditContext) {
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: data.customerId,
        items: data.items,
        subtotal: data.subtotal,
        tax: data.tax,
        totalAmount: data.subtotal + data.tax,
        status: 'PENDING',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'create',
        resource: 'order',
        resourceId: order.id,
        newValues: {
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          itemCount: data.items.length,
        },
        metadata: {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      },
    });

    return order;
  },

  async update(id: string, data: UpdateOrderData, ctx: AuditContext) {
    const existing = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) throw new Error('Order not found');

    const updated = await prisma.order.update({
      where: { id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'update',
        resource: 'order',
        resourceId: id,
        oldValues: {
          customerId: existing.customerId,
          totalAmount: existing.totalAmount,
          shippingAddress: existing.shippingAddress,
          notes: existing.notes,
        },
        newValues: data,
        metadata: {
          orderNumber: existing.orderNumber,
          ip: ctx.ip,
        },
      },
    });

    return updated;
  },

  async cancel(id: string, reason: string, ctx: AuditContext) {
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) throw new Error('Order not found');
    if (order.status === 'SHIPPED') {
      throw new Error('Cannot cancel shipped orders');
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: reason },
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'cancel',
        resource: 'order',
        resourceId: id,
        oldValues: { status: order.status },
        newValues: { status: 'CANCELLED', cancelReason: reason },
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          ip: ctx.ip,
        },
      },
    });

    return updated;
  },

  async updateStatus(id: string, newStatus: string, ctx: AuditContext) {
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) throw new Error('Order not found');

    const updated = await prisma.order.update({
      where: { id },
      data: { status: newStatus },
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'status_change',
        resource: 'order',
        resourceId: id,
        oldValues: { status: order.status },
        newValues: { status: newStatus },
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
        },
      },
    });

    return updated;
  },

  async delete(id: string, ctx: AuditContext) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) throw new Error('Order not found');

    await prisma.order.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'delete',
        resource: 'order',
        resourceId: id,
        oldValues: {
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          status: order.status,
          itemCount: order.items.length,
        },
        metadata: {
          ip: ctx.ip,
        },
      },
    });
  },
};
```

### Order Routes

```typescript
// apps/api/src/modules/orders/orders.routes.ts
import { FastifyInstance } from 'fastify';
import { ordersService } from './orders.service';

export async function ordersRoutes(app: FastifyInstance) {
  app.post('/', {
    preHandler: [app.authenticate, app.requirePermission('orders:create')],
  }, async (request) => {
    const order = await ordersService.create(request.body, {
      userId: request.user.sub,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { data: order };
  });

  app.put('/:id/status', {
    preHandler: [app.authenticate, app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const order = await ordersService.updateStatus(id, status, {
      userId: request.user.sub,
      ip: request.ip,
    });

    return { data: order };
  });

  app.post('/:id/cancel', {
    preHandler: [app.authenticate, app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason: string };

    const order = await ordersService.cancel(id, reason, {
      userId: request.user.sub,
      ip: request.ip,
    });

    return { data: order };
  });
}
```

---

## Audit Log Statistics

```typescript
// GET /api/audit-logs/stats
{
  "totalLogs": 5000,
  "actionStats": [
    { "action": "login", "count": 3000 },
    { "action": "create", "count": 800 },
    { "action": "update", "count": 900 },
    { "action": "delete", "count": 300 }
  ],
  "resourceStats": [
    { "resource": "session", "count": 3000 },
    { "resource": "user", "count": 1500 },
    { "resource": "role", "count": 500 }
  ],
  "recentActivity": [
    {
      "id": "audit_abc",
      "action": "login",
      "resource": "session",
      "user": "John Doe",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Best Practices

### 1. Log After Success
```typescript
// Good: Log after operation succeeds
const user = await prisma.user.create({ data });
await prisma.auditLog.create({ data: auditData });

// Bad: Log before operation
await prisma.auditLog.create({ data: auditData });
const user = await prisma.user.create({ data }); // Might fail!
```

### 2. Include Context in Metadata
```typescript
// Good: Include useful context
await prisma.auditLog.create({
  data: {
    // ...
    metadata: {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      orderNumber: order.orderNumber,
      previousStatus: order.status,
    },
  },
});
```

### 3. Store Meaningful oldValues/newValues
```typescript
// Good: Store only relevant fields
oldValues: {
  email: existing.email,
  roleId: existing.roleId,
},

// Bad: Store entire object including internal fields
oldValues: existing,
```

### 4. Use Consistent Action Names
```typescript
// Good: Consistent naming
'create', 'update', 'delete', 'status_change'

// Bad: Inconsistent naming
'created', 'modify', 'remove', 'changeStatus'
```

---

## Troubleshooting

### Audit Logs Not Created
1. Check audit log creation is after successful operation
2. Verify no errors in the create call
3. Check database constraints aren't failing

### Missing User Information
1. Ensure userId is captured from request
2. For system operations, userId can be null
3. Check user relation is included in queries

### Large oldValues/newValues
1. Filter to only include relevant fields
2. Avoid storing binary data
3. Consider truncating long text fields

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/prisma/schema.prisma` | AuditLog model |
| `apps/api/src/modules/audit/audit.routes.ts` | API endpoints |
| `apps/web/src/pages/audit/AuditLogsPage.tsx` | Log viewer UI |
| `apps/api/src/modules/auth/auth.service.ts` | Auth audit logging |
| `apps/api/src/modules/users/users.service.ts` | User audit logging |
| `apps/api/src/modules/roles/roles.service.ts` | Role audit logging |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/31
