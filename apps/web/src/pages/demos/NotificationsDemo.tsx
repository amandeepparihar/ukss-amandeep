import { Bell, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationStore } from '@/stores/notificationStore';

export function NotificationsDemo() {
  const { notify, success, error, warning, info, addNotification } = useNotifications();
  const { notifications, unreadCount, clearAll, markAllAsRead } = useNotificationStore();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notifications System</h1>
        <p className="text-muted-foreground">
          Toast notifications and persistent notification panel for user feedback.
        </p>
      </div>

      <Tabs defaultValue="demo" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demo">Demo</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="space-y-4">
          {/* Toast Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Toast Notifications</CardTitle>
              <CardDescription>
                Temporary notifications that appear and auto-dismiss
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => info('Info Toast', { message: 'This is an informational message' })}
                  variant="outline"
                >
                  <Info className="h-4 w-4 mr-2 text-blue-500" />
                  Info Toast
                </Button>
                <Button
                  onClick={() => success('Success!', { message: 'Operation completed successfully' })}
                  variant="outline"
                >
                  <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                  Success Toast
                </Button>
                <Button
                  onClick={() => warning('Warning', { message: 'Please review before proceeding' })}
                  variant="outline"
                >
                  <AlertTriangle className="h-4 w-4 mr-2 text-yellow-500" />
                  Warning Toast
                </Button>
                <Button
                  onClick={() => error('Error!', { message: 'Something went wrong' })}
                  variant="outline"
                >
                  <XCircle className="h-4 w-4 mr-2 text-red-500" />
                  Error Toast
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Persistent Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Persistent Notifications</CardTitle>
              <CardDescription>
                Notifications saved to the notification panel (bell icon in header)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() =>
                    success('New User Registered', {
                      message: 'John Doe just created an account',
                      persist: true,
                      link: '/users',
                    })
                  }
                  variant="outline"
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Add with Link
                </Button>
                <Button
                  onClick={() =>
                    warning('Low Stock Alert', {
                      message: 'Product "Wireless Headphones" is running low',
                      persist: true,
                    })
                  }
                  variant="outline"
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Add Warning
                </Button>
                <Button
                  onClick={() =>
                    error('Payment Failed', {
                      message: 'Order #1234 payment was declined',
                      persist: true,
                    })
                  }
                  variant="outline"
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Add Error
                </Button>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {unreadCount} unread notifications, {notifications.length} total
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={markAllAsRead}>
                    Mark All Read
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearAll}>
                    Clear All
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Custom Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Custom Notifications</CardTitle>
              <CardDescription>
                Create notifications with custom options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() =>
                    notify({
                      title: 'Long Duration Toast',
                      message: 'This toast stays for 10 seconds',
                      type: 'info',
                      duration: 10000,
                    })
                  }
                  variant="outline"
                >
                  Long Duration (10s)
                </Button>
                <Button
                  onClick={() =>
                    notify({
                      title: 'No Description',
                      type: 'success',
                    })
                  }
                  variant="outline"
                >
                  Title Only
                </Button>
                <Button
                  onClick={() => {
                    addNotification({
                      title: 'Direct Add',
                      message: 'Added directly to notification panel without toast',
                      type: 'info',
                    });
                  }}
                  variant="outline"
                >
                  Add Without Toast
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Toast Notifications</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Temporary notifications using Sonner. Auto-dismiss with configurable duration.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notification Panel</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Persistent notifications stored in the header bell icon. Survives page refreshes.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">4 Notification Types</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Info (blue), Success (green), Warning (yellow), Error (red) with matching icons.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Unread Badge</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Shows unread count on the bell icon. Automatically updates as you interact.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Click Actions</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Notifications can include links to navigate when clicked.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Local Storage</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Persisted in localStorage using Zustand. Survives browser refresh.
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Using the Hook</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const { success, error, warning, info, notify } = useNotifications();

  // Simple toast notifications
  success('Saved!', { message: 'Your changes have been saved' });
  error('Error!', { message: 'Something went wrong' });
  warning('Warning', { message: 'Please review' });
  info('Info', { message: 'FYI...' });

  // With persistence to notification panel
  success('New Order', {
    message: 'Order #1234 received',
    persist: true,         // Save to notification panel
    link: '/orders/1234',  // Navigate on click
  });

  // Custom notification
  notify({
    title: 'Custom',
    message: 'With all options',
    type: 'info',
    duration: 5000,        // Toast duration in ms
    persist: true,         // Save to panel
    link: '/page',         // Navigation link
  });
}`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Direct Store Access</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { useNotificationStore } from '@/stores/notificationStore';

function MyComponent() {
  const {
    notifications,     // Array of all notifications
    unreadCount,       // Number of unread
    addNotification,   // Add without toast
    markAsRead,        // Mark one as read
    markAllAsRead,     // Mark all as read
    removeNotification,// Remove one
    clearAll,          // Remove all
  } = useNotificationStore();

  // Add directly to panel (no toast)
  addNotification({
    title: 'Background Update',
    message: 'Data synced from server',
    type: 'info',
    link: '/dashboard',
  });
}`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Error Handler</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const { apiError } = useNotifications();

  const handleSubmit = async () => {
    try {
      await api.post('/users', data);
      success('User created!');
    } catch (err) {
      apiError(err, 'Failed to create user');
    }
  };
}`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
