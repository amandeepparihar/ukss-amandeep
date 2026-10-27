# Notifications Module

## Overview

The Notifications module provides a complete notification system including:
- Toast notifications (auto-dismiss or persistent)
- Notification panel with history
- Read/unread tracking
- Action buttons on notifications
- Metadata support for linking to resources

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐       ┌─────────────────────┐             │
│  │   Toast (sonner)│       │  Notification Panel │             │
│  │                 │       │                     │             │
│  │  Auto-dismiss   │       │  History (50 items) │             │
│  │  or persistent  │       │  Read/unread        │             │
│  │                 │       │  Mark all as read   │             │
│  └────────┬────────┘       └──────────┬──────────┘             │
│           │                           │                         │
│           ▼                           ▼                         │
│  ┌──────────────────────────────────────────────┐              │
│  │         notificationStore (Zustand)           │              │
│  │                                               │              │
│  │  - notifications[]                            │              │
│  │  - unreadCount                                │              │
│  │  - addNotification()                          │              │
│  │  - markAsRead()                               │              │
│  │  - markAllAsRead()                            │              │
│  └──────────────────────────────────────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files Overview

| File | Purpose |
|------|---------|
| `stores/notificationStore.ts` | Zustand store for notifications |
| `hooks/useNotifications.ts` | Hook for sending notifications |
| `components/NotificationPanel.tsx` | Side panel for history |
| `components/NotificationBell.tsx` | Header bell icon with count |

---

## Quick Start

### Sending a Toast Notification

```tsx
import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const { success, error, info, warning, toast } = useNotifications();

  return (
    <div>
      {/* Simple toasts */}
      <Button onClick={() => success('Changes saved!')}>
        Success
      </Button>

      <Button onClick={() => error('Something went wrong')}>
        Error
      </Button>

      <Button onClick={() => info('New version available')}>
        Info
      </Button>

      <Button onClick={() => warning('Your session will expire soon')}>
        Warning
      </Button>

      {/* Custom toast */}
      <Button onClick={() => toast('Custom message', { duration: 10000 })}>
        Long Toast
      </Button>
    </div>
  );
}
```

### Persistent Notification (Doesn't Auto-Dismiss)

```tsx
import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const { success } = useNotifications();

  const handleImportantAction = () => {
    success('File uploaded successfully', {
      persistent: true,  // Won't auto-dismiss
      actionLabel: 'View File',
      onAction: () => navigateTo('/files'),
    });
  };

  return <Button onClick={handleImportantAction}>Upload</Button>;
}
```

### Adding to Notification Panel

```tsx
import { useNotificationStore } from '@/stores/notificationStore';

function MyComponent() {
  const addNotification = useNotificationStore((s) => s.addNotification);

  const handleOrderCreated = (order) => {
    addNotification({
      title: 'New Order',
      message: `Order #${order.number} has been placed`,
      type: 'success',
      link: `/orders/${order.id}`,  // Click to navigate
      metadata: { orderId: order.id },
    });
  };
}
```

---

## useNotifications Hook

### API Reference

```typescript
interface NotificationOptions {
  // Toast options
  duration?: number;      // Default: 4000ms
  persistent?: boolean;   // If true, won't auto-dismiss

  // Action button
  actionLabel?: string;   // Button text
  onAction?: () => void;  // Button callback

  // For notification panel
  addToPanel?: boolean;   // Default: true for non-toast
  link?: string;          // URL to navigate on click
  metadata?: Record<string, unknown>;
}

interface UseNotifications {
  // Typed toast functions
  success(message: string, options?: NotificationOptions): void;
  error(message: string, options?: NotificationOptions): void;
  info(message: string, options?: NotificationOptions): void;
  warning(message: string, options?: NotificationOptions): void;

  // Generic toast
  toast(message: string, options?: NotificationOptions): void;

  // Dismiss toasts
  dismiss(toastId?: string): void;
  dismissAll(): void;
}
```

### Examples

```tsx
const { success, error, info, warning, toast, dismiss } = useNotifications();

// Basic toasts
success('Profile updated');
error('Failed to save changes');
info('You have new messages');
warning('Storage almost full');

// With duration
info('Processing...', { duration: 10000 });

// Persistent (requires manual dismiss)
const toastId = success('Uploading file...', { persistent: true });
// Later: dismiss(toastId);

// With action button
success('Email sent', {
  actionLabel: 'Undo',
  onAction: () => undoSendEmail(),
});

// Add to panel with link
success('Order shipped', {
  addToPanel: true,
  link: '/orders/123',
  metadata: { orderId: '123' },
});
```

---

## Notification Store

### Store Structure

```typescript
interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: Date;
  link?: string;
  metadata?: Record<string, unknown>;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;

  addNotification(notification: Omit<Notification, 'id' | 'read' | 'createdAt'>): void;
  markAsRead(id: string): void;
  markAllAsRead(): void;
  removeNotification(id: string): void;
  clearAll(): void;
  setIsOpen(open: boolean): void;
}
```

### Direct Store Usage

```tsx
import { useNotificationStore } from '@/stores/notificationStore';

function NotificationBell() {
  const { unreadCount, isOpen, setIsOpen } = useNotificationStore();

  return (
    <Button variant="ghost" onClick={() => setIsOpen(!isOpen)}>
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge className="absolute -top-1 -right-1">
          {unreadCount}
        </Badge>
      )}
    </Button>
  );
}
```

```tsx
function NotificationPanel() {
  const {
    notifications,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
  } = useNotificationStore();

  return (
    <div className="notification-panel">
      <div className="flex justify-between">
        <h3>Notifications</h3>
        <Button variant="ghost" size="sm" onClick={markAllAsRead}>
          Mark all read
        </Button>
      </div>

      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={cn('notification', !notification.read && 'unread')}
          onClick={() => {
            markAsRead(notification.id);
            if (notification.link) {
              navigate(notification.link);
            }
          }}
        >
          <div className="notification-icon">
            {getIcon(notification.type)}
          </div>
          <div className="notification-content">
            <strong>{notification.title}</strong>
            <p>{notification.message}</p>
            <small>{formatDate(notification.createdAt)}</small>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              removeNotification(notification.id);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {notifications.length === 0 && (
        <p className="text-center text-muted-foreground">No notifications</p>
      )}

      {notifications.length > 0 && (
        <Button variant="ghost" onClick={clearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
```

---

## Real-World Examples

### Example 1: Order Status Update

```tsx
// When order status changes
async function updateOrderStatus(orderId: string, newStatus: string) {
  const { success, error } = useNotifications();
  const addNotification = useNotificationStore((s) => s.addNotification);

  try {
    await api.patch(`/orders/${orderId}`, { status: newStatus });

    // Show toast
    success(`Order marked as ${newStatus}`);

    // Add to notification panel
    addNotification({
      title: 'Order Updated',
      message: `Order #${orderId} is now ${newStatus}`,
      type: 'success',
      link: `/orders/${orderId}`,
    });

  } catch (err) {
    error('Failed to update order status');
  }
}
```

### Example 2: Background Task Completion

```tsx
// Start background task
function startExport(filters) {
  const { info, success, error } = useNotifications();
  const addNotification = useNotificationStore((s) => s.addNotification);

  // Show processing toast
  info('Export started. We\'ll notify you when ready.', {
    persistent: true,
  });

  // Start async task
  api.post('/exports', filters)
    .then((result) => {
      // Dismiss processing toast
      dismissAll();

      // Show completion
      success('Export ready!', {
        persistent: true,
        actionLabel: 'Download',
        onAction: () => downloadFile(result.downloadUrl),
      });

      // Add to panel
      addNotification({
        title: 'Export Ready',
        message: 'Your export file is ready for download',
        type: 'success',
        link: result.downloadUrl,
        metadata: { exportId: result.id },
      });
    })
    .catch((err) => {
      dismissAll();
      error('Export failed. Please try again.');
    });
}
```

### Example 3: Real-Time Notifications via WebSocket

```tsx
// apps/web/src/hooks/useRealtimeNotifications.ts
import { useEffect } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';
import { useNotifications } from '@/hooks/useNotifications';

export function useRealtimeNotifications() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const { info, success, warning, error } = useNotifications();

  useEffect(() => {
    const ws = new WebSocket(process.env.WS_URL);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'NEW_ORDER':
          success(`New order #${data.orderNumber}!`);
          addNotification({
            title: 'New Order',
            message: `Order #${data.orderNumber} - $${data.total}`,
            type: 'success',
            link: `/orders/${data.orderId}`,
          });
          break;

        case 'LOW_STOCK':
          warning(`${data.productName} is running low`);
          addNotification({
            title: 'Low Stock Alert',
            message: `${data.productName}: ${data.remaining} left`,
            type: 'warning',
            link: `/products/${data.productId}`,
          });
          break;

        case 'SYSTEM_ALERT':
          error(data.message, { persistent: true });
          addNotification({
            title: 'System Alert',
            message: data.message,
            type: 'error',
          });
          break;
      }
    };

    return () => ws.close();
  }, []);
}

// Use in App.tsx
function App() {
  useRealtimeNotifications();
  return <RouterProvider router={router} />;
}
```

### Example 4: Form Submission Feedback

```tsx
function UserForm({ onSuccess }) {
  const { success, error } = useNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data) => {
    setIsSubmitting(true);

    try {
      const user = await api.post('/users', data);

      success('User created successfully', {
        actionLabel: 'View Profile',
        onAction: () => navigate(`/users/${user.id}`),
      });

      onSuccess?.(user);

    } catch (err) {
      if (err.response?.status === 409) {
        error('A user with this email already exists');
      } else if (err.response?.status === 400) {
        error(err.response.data.message || 'Invalid form data');
      } else {
        error('Failed to create user. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### Example 5: Confirmation with Undo

```tsx
function DeleteButton({ itemId, onDelete }) {
  const { success } = useNotifications();
  const queryClient = useQueryClient();

  const handleDelete = async () => {
    // Optimistic update
    const previousData = queryClient.getQueryData(['items']);
    queryClient.setQueryData(['items'], (old) =>
      old.filter(item => item.id !== itemId)
    );

    // Show toast with undo
    success('Item deleted', {
      duration: 5000,  // 5 seconds to undo
      actionLabel: 'Undo',
      onAction: async () => {
        // Restore optimistic update
        queryClient.setQueryData(['items'], previousData);
        // Don't call actual delete
      },
    });

    // Wait for toast duration, then actually delete
    setTimeout(async () => {
      try {
        await api.delete(`/items/${itemId}`);
        onDelete?.(itemId);
      } catch (err) {
        // Restore on failure
        queryClient.setQueryData(['items'], previousData);
        error('Failed to delete item');
      }
    }, 5000);
  };

  return (
    <Button variant="destructive" onClick={handleDelete}>
      Delete
    </Button>
  );
}
```

---

## Notification Types & Styling

| Type | Icon | Color | Use Case |
|------|------|-------|----------|
| `success` | CheckCircle | Green | Successful actions |
| `error` | XCircle | Red | Failures, errors |
| `warning` | AlertTriangle | Yellow/Orange | Warnings, alerts |
| `info` | Info | Blue | Informational |

### Custom Styling

```tsx
// Using Tailwind classes with sonner
<Toaster
  toastOptions={{
    classNames: {
      toast: 'bg-background border',
      title: 'text-foreground',
      description: 'text-muted-foreground',
      actionButton: 'bg-primary text-primary-foreground',
      cancelButton: 'bg-muted text-muted-foreground',
      success: 'border-green-500',
      error: 'border-red-500',
      warning: 'border-yellow-500',
      info: 'border-blue-500',
    },
  }}
/>
```

---

## Configuration

### Toaster Setup

```tsx
// apps/web/src/App.tsx
import { Toaster } from 'sonner';

function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        richColors
        expand={false}
        closeButton
        duration={4000}
      />
    </>
  );
}
```

### Available Toaster Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | string | 'top-right' | Toast position |
| `richColors` | boolean | false | Use colored backgrounds |
| `expand` | boolean | false | Expand toasts on hover |
| `closeButton` | boolean | false | Show close button |
| `duration` | number | 4000 | Default duration (ms) |
| `visibleToasts` | number | 3 | Max visible toasts |

---

## Best Practices

### 1. Be Concise
```typescript
// Good
success('Changes saved');

// Bad
success('Your changes have been successfully saved to the database');
```

### 2. Use Appropriate Types
```typescript
// Good
success('Profile updated');  // Action completed
error('Failed to save');     // Action failed
warning('Low storage');      // Needs attention
info('New features');        // Informational

// Bad
success('Error occurred');   // Confusing!
```

### 3. Provide Actions When Helpful
```typescript
// Good: actionable notification
success('File deleted', {
  actionLabel: 'Undo',
  onAction: undoDelete,
});

// Good: link to relevant page
addNotification({
  title: 'New Comment',
  message: 'John commented on your post',
  link: '/posts/123#comments',
});
```

### 4. Don't Spam Notifications
```typescript
// Bad: notification for every item
items.forEach(item => success(`${item.name} saved`));

// Good: single summary notification
success(`${items.length} items saved`);
```

### 5. Use Persistent for Critical Messages
```typescript
// Important: payment failure
error('Payment failed. Please update your card.', {
  persistent: true,
  actionLabel: 'Update Card',
  onAction: () => navigate('/billing'),
});
```

---

## Troubleshooting

### Toasts Not Showing
1. Check `<Toaster />` is in your app
2. Verify sonner is installed
3. Check for CSS conflicts

### Notifications Not Persisting
1. Check notificationStore is properly imported
2. Verify `addNotification` is being called
3. Check max history limit (50 by default)

### Actions Not Working
1. Ensure `onAction` is a function
2. Check for errors in the callback
3. Verify the action is not being prevented

---

## Related Files

| File | Description |
|------|-------------|
| `stores/notificationStore.ts` | Zustand store |
| `hooks/useNotifications.ts` | Notification hook |
| `components/NotificationPanel.tsx` | Panel component |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/27
