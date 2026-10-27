import { useState, useEffect } from 'react';
import {
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Send,
  Settings,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface NotificationStats {
  total: number;
  sentToday: number;
  failedToday: number;
  byChannel: Array<{ channel: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
}

interface UserPreference {
  channel: string;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
}

interface NotificationTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  variables: string[];
  channels: Array<{
    channel: string;
    subject: string | null;
    content: string;
  }>;
}

interface NotificationHistory {
  id: string;
  channel: string;
  subject: string | null;
  content: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
}

const channelIcons: Record<string, React.ReactNode> = {
  EMAIL: <Mail className="h-4 w-4" />,
  SMS: <MessageSquare className="h-4 w-4" />,
  PUSH: <Smartphone className="h-4 w-4" />,
  WHATSAPP: <MessageSquare className="h-4 w-4" />,
};

const channelLabels: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  PUSH: 'Push Notification',
  WHATSAPP: 'WhatsApp',
};

export function NotificationChannelsDemo() {
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [history, setHistory] = useState<NotificationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [prefsDialogOpen, setPrefsDialogOpen] = useState(false);
  const [sendingNotification, setSendingNotification] = useState(false);
  const [selectedPreference, setSelectedPreference] = useState<UserPreference | null>(null);

  // Send form state
  const [sendForm, setSendForm] = useState({
    channel: 'EMAIL',
    email: '',
    subject: '',
    content: '',
  });

  // Fetch data
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, prefsRes, templatesRes, historyRes] = await Promise.all([
        api.get('/notifications/stats'),
        api.get('/notifications/preferences'),
        api.get('/notifications/templates'),
        api.get('/notifications/history'),
      ]);
      setStats(statsRes.data.data);
      setPreferences(prefsRes.data.data);
      setTemplates(templatesRes.data.data);
      setHistory(historyRes.data.data);
    } catch (error) {
      console.error('Failed to fetch notifications data:', error);
      // Set defaults if API fails
      setPreferences([
        { channel: 'EMAIL', enabled: true, quietHoursStart: null, quietHoursEnd: null, timezone: null },
        { channel: 'SMS', enabled: false, quietHoursStart: null, quietHoursEnd: null, timezone: null },
        { channel: 'PUSH', enabled: false, quietHoursStart: null, quietHoursEnd: null, timezone: null },
        { channel: 'WHATSAPP', enabled: false, quietHoursStart: null, quietHoursEnd: null, timezone: null },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Update preference
  const updatePreference = async (channel: string, updates: Partial<UserPreference>) => {
    try {
      await api.put('/notifications/preferences', {
        channel,
        ...updates,
      });
      setPreferences((prev) =>
        prev.map((p) => (p.channel === channel ? { ...p, ...updates } : p))
      );
      toast.success(`${channelLabels[channel]} settings saved`);
    } catch (error) {
      toast.error('Failed to update preference');
    }
  };

  // Send notification
  const sendNotification = async () => {
    if (!sendForm.email || !sendForm.content) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSendingNotification(true);
    try {
      await api.post('/notifications/send', {
        channel: sendForm.channel,
        email: sendForm.email,
        subject: sendForm.subject,
        content: sendForm.content,
      });
      toast.success('The notification has been queued for delivery');
      setSendDialogOpen(false);
      setSendForm({ channel: 'EMAIL', email: '', subject: '', content: '' });
      fetchData(); // Refresh stats
    } catch (error) {
      toast.error('Failed to send notification');
    } finally {
      setSendingNotification(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
      case 'DELIVERED':
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'PENDING':
      case 'QUEUED':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notification Channels</h1>
          <p className="text-muted-foreground">
            Multi-channel notification system with Email, SMS, Push, and WhatsApp support.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setSendDialogOpen(true)} size="sm">
            <Send className="h-4 w-4 mr-2" />
            Send Test
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="preferences">My Preferences</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Stats */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Notifications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold">{stats.total}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Sent Today
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="text-2xl font-bold">{stats.sentToday}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Failed Today
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-red-500" />
                      <span className="text-2xl font-bold">{stats.failedToday}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Channels
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold">4</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Channel Stats */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>By Channel (Today)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'] as const).map((channel) => {
                        const stat = stats.byChannel.find((c) => c.channel === channel);
                        return (
                          <div key={channel} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {channelIcons[channel]}
                              <span>{channelLabels[channel]}</span>
                            </div>
                            <Badge variant="secondary">{stat?.count || 0}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>By Status (Today)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {stats.byStatus.map((s) => (
                        <div key={s.status} className="flex items-center justify-between">
                          {getStatusBadge(s.status)}
                          <Badge variant="secondary">{s.count}</Badge>
                        </div>
                      ))}
                      {stats.byStatus.length === 0 && (
                        <p className="text-muted-foreground text-sm">No notifications today</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Unable to load statistics
              </CardContent>
            </Card>
          )}

          {/* Channel Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Supported Channels</CardTitle>
              <CardDescription>
                Multi-channel notification delivery with provider abstraction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                        <Mail className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                      </div>
                      <div>
                        <h4 className="font-semibold">Email</h4>
                        <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      SMTP/SendGrid integration
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                        <MessageSquare className="h-5 w-5 text-green-600 dark:text-green-300" />
                      </div>
                      <div>
                        <h4 className="font-semibold">SMS</h4>
                        <Badge variant="outline" className="text-xs">Stub</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Twilio integration ready
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                        <Smartphone className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                      </div>
                      <div>
                        <h4 className="font-semibold">Push</h4>
                        <Badge variant="outline" className="text-xs">Stub</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Web Push API ready
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                        <MessageSquare className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                      </div>
                      <div>
                        <h4 className="font-semibold">WhatsApp</h4>
                        <Badge variant="outline" className="text-xs">Stub</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Business API ready
                    </p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Configure how you receive notifications across different channels
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {preferences.map((pref) => (
                  <div
                    key={pref.channel}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        {channelIcons[pref.channel]}
                      </div>
                      <div>
                        <h4 className="font-medium">{channelLabels[pref.channel]}</h4>
                        <p className="text-sm text-muted-foreground">
                          {pref.enabled ? 'Enabled' : 'Disabled'}
                          {pref.quietHoursStart && pref.quietHoursEnd && (
                            <span className="ml-2">
                              | Quiet: {pref.quietHoursStart} - {pref.quietHoursEnd}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedPreference(pref);
                          setPrefsDialogOpen(true);
                        }}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={pref.enabled}
                        onCheckedChange={(enabled) =>
                          updatePreference(pref.channel, { enabled })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Templates</CardTitle>
              <CardDescription>
                Pre-defined notification templates with variable support
              </CardDescription>
            </CardHeader>
            <CardContent>
              {templates.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No templates configured. Create templates via the API.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Variables</TableHead>
                      <TableHead>Channels</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {template.code}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{template.name}</p>
                            {template.description && (
                              <p className="text-xs text-muted-foreground">
                                {template.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {template.variables.map((v) => (
                              <Badge key={v} variant="outline" className="text-xs">
                                {`{{${v}}}`}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {template.channels.map((c) => (
                              <Badge key={c.channel} variant="secondary" className="text-xs">
                                {channelIcons[c.channel]}
                              </Badge>
                            ))}
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

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Notification History</CardTitle>
              <CardDescription>
                Recent notifications sent to your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No notifications yet
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {channelIcons[item.channel]}
                            {channelLabels[item.channel]}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.subject || item.content.substring(0, 50)}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-sm">
                          {formatDate(item.sentAt || item.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notifications API Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`# Get notification statistics (admin)
GET /api/notifications/stats

# Get all templates (admin)
GET /api/notifications/templates

# Create/update template (admin)
POST /api/notifications/templates
Body: {
  "code": "welcome-email",
  "name": "Welcome Email",
  "description": "Sent to new users",
  "variables": ["firstName", "loginUrl"],
  "channels": [
    {
      "channel": "EMAIL",
      "subject": "Welcome, {{firstName}}!",
      "content": "Welcome to our platform! Login at {{loginUrl}}"
    }
  ]
}

# Send a notification (admin)
POST /api/notifications/send
Body: {
  "userId": "user-id",        // or
  "email": "user@example.com",
  "channel": "EMAIL",
  "templateCode": "welcome-email",
  "variables": { "firstName": "John", "loginUrl": "https://..." }
}

# Send bulk notifications (admin)
POST /api/notifications/send-bulk
Body: {
  "userIds": ["user1", "user2"],
  "templateCode": "announcement",
  "variables": { "message": "New feature!" },
  "channels": ["EMAIL", "PUSH"]
}

# Get user preferences
GET /api/notifications/preferences

# Update user preferences
PUT /api/notifications/preferences
Body: {
  "channel": "EMAIL",
  "enabled": true,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "08:00",
  "timezone": "America/New_York"
}

# Get notification history
GET /api/notifications/history?limit=50&channel=EMAIL`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Using Templates in Code</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Import the notify helper
import { notify } from '@/modules/notifications/notifications.service';

// Send a notification using a template
await notify(
  userId,
  'password-reset',
  { resetUrl: 'https://app.com/reset?token=xyz' },
  ['EMAIL']  // channels to use
);

// Or use the service directly
await notificationsService.send({
  userId: 'user-123',
  templateCode: 'order-confirmation',
  channel: 'EMAIL',
  variables: {
    orderNumber: 'ORD-12345',
    total: '$99.99',
    items: ['Widget', 'Gadget'],
  },
  priority: 8,
  scheduledFor: new Date('2024-12-25T09:00:00Z'), // optional
});

// Send without template (custom content)
await notificationsService.send({
  email: 'user@example.com',
  channel: 'EMAIL',
  subject: 'Custom Subject',
  content: '<h1>Hello!</h1><p>This is custom HTML content.</p>',
});`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Send Test Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Notification</DialogTitle>
            <DialogDescription>
              Send a test notification to verify channel configuration
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={sendForm.channel}
                onValueChange={(value) => setSendForm((prev) => ({ ...prev, channel: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="SMS">SMS (Stub)</SelectItem>
                  <SelectItem value="PUSH">Push (Stub)</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp (Stub)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={sendForm.email}
                onChange={(e) => setSendForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            {sendForm.channel === 'EMAIL' && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  placeholder="Test Notification"
                  value={sendForm.subject}
                  onChange={(e) => setSendForm((prev) => ({ ...prev, subject: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                placeholder="Your notification message..."
                rows={4}
                value={sendForm.content}
                onChange={(e) => setSendForm((prev) => ({ ...prev, content: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendNotification} disabled={sendingNotification}>
              {sendingNotification ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preferences Dialog */}
      <Dialog open={prefsDialogOpen} onOpenChange={setPrefsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedPreference && channelLabels[selectedPreference.channel]} Settings
            </DialogTitle>
            <DialogDescription>
              Configure quiet hours and timezone for this channel
            </DialogDescription>
          </DialogHeader>
          {selectedPreference && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={selectedPreference.enabled}
                  onCheckedChange={(enabled) => {
                    setSelectedPreference((prev) => prev && { ...prev, enabled });
                    updatePreference(selectedPreference.channel, { enabled });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Moon className="h-4 w-4" />
                  Quiet Hours
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input
                      type="time"
                      value={selectedPreference.quietHoursStart || ''}
                      onChange={(e) =>
                        setSelectedPreference((prev) =>
                          prev && { ...prev, quietHoursStart: e.target.value || null }
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <Input
                      type="time"
                      value={selectedPreference.quietHoursEnd || ''}
                      onChange={(e) =>
                        setSelectedPreference((prev) =>
                          prev && { ...prev, quietHoursEnd: e.target.value || null }
                        )
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Notifications will be held during quiet hours
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrefsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedPreference) {
                  updatePreference(selectedPreference.channel, {
                    quietHoursStart: selectedPreference.quietHoursStart,
                    quietHoursEnd: selectedPreference.quietHoursEnd,
                  });
                }
                setPrefsDialogOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
