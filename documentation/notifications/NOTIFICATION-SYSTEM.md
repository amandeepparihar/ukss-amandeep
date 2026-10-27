# Multi-Channel Notification System

## Overview

The notification system provides a unified way to send notifications across multiple channels (Email, SMS, Push, Slack, and In-App). It supports user preferences, event-based notifications, and detailed logging.

## Architecture

### Components

1. **Notification Channels** - Individual channel providers (Email, SMS, Push, Slack, In-App)
2. **Notification Service** - Central service that manages all channels and preferences
3. **Template System** - Templates for each event type and channel
4. **API Routes** - REST endpoints for managing notifications and preferences
5. **Frontend Components** - UI for viewing and managing notifications

### Directory Structure

```
apps/api/src/lib/notifications/
├── channels/
│   ├── email.channel.ts       # Email notifications via SMTP/SendGrid
│   ├── sms.channel.ts         # SMS via Twilio
│   ├── push.channel.ts        # Web Push API
│   ├── slack.channel.ts       # Slack webhooks
│   └── inapp.channel.ts       # In-app database notifications
├── notification.service.ts     # Main notification service
├── template-compiler.ts        # Template variable substitution
├── templates.ts                # Notification templates
├── types.ts                    # TypeScript interfaces
└── index.ts                    # Exports

apps/api/src/modules/notifications/
└── notifications.routes.ts     # API endpoints

apps/web/src/components/notifications/
├── NotificationBell.tsx        # Bell icon with dropdown
└── NotificationPanel.tsx       # Toast notifications

apps/web/src/pages/
└── NotificationPreferencesPage.tsx  # Preferences management UI
```

## Notification Channels

### 1. Email Channel

**Provider**: SMTP, SendGrid, or Console (for development)
**Configuration**:
```env
EMAIL_PROVIDER=smtp  # or 'sendgrid' or 'console'
EMAIL_FROM=noreply@example.com
EMAIL_FROM_NAME=Admin Panel

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password

# SendGrid Configuration (alternative)
SENDGRID_API_KEY=your-sendgrid-api-key
```

**Features**:
- HTML and plain text support
- Attachments
- CC/BCC support
- Rich email templates

### 2. SMS Channel

**Provider**: Twilio
**Configuration**:
```env
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

**Features**:
- E.164 phone number validation
- Character limit handling
- Delivery status tracking
- Cost-effective for urgent notifications

**Phone Number Format**: Must be in E.164 format (e.g., +1234567890)

### 3. Push Notification Channel

**Provider**: Web Push API
**Configuration**:
```env
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:admin@example.com
```

**Generating VAPID Keys**:
```bash
# In Node.js REPL or script
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('Public Key:', keys.publicKey);
console.log('Private Key:', keys.privateKey);
```

**Features**:
- Browser push notifications
- Works when app is closed
- Subscription management
- Icon and badge support

### 4. Slack Channel

**Provider**: Slack Incoming Webhooks
**Configuration**:
```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Setting up Slack Webhook**:
1. Go to https://api.slack.com/apps
2. Create a new app or select existing
3. Enable "Incoming Webhooks"
4. Add a new webhook to your workspace
5. Copy the webhook URL

**Features**:
- Rich message formatting
- Action buttons
- Color-coded messages
- Team notifications

### 5. In-App Channel

**Provider**: Database + Optional WebSocket
**Configuration**: None required (always available)

**Features**:
- Persistent storage in database
- Unread count tracking
- Read/unread status
- Pagination support
- Automatic cleanup of old notifications

## Event Types

The system supports the following event types:

| Event Type | Description | Default Channels |
|------------|-------------|------------------|
| `login` | New login detected | Email, In-App |
| `passwordReset` | Password reset requested | Email, In-App |
| `roleChange` | User role changed | Email, In-App |
| `systemAlert` | System-wide alerts | Email, In-App, Slack |
| `exportComplete` | Export job finished | Email, In-App |
| `importComplete` | Import job finished | Email, In-App |
| `accountLocked` | Account locked due to failed logins | Email, SMS, In-App |
| `twoFactorEnabled` | 2FA enabled/disabled | Email, In-App |
| `profileUpdated` | Profile information changed | Email, In-App |
| `userCreated` | New user account created | Email, Slack |
| `userDeleted` | User account deleted | Slack |

## Usage

### Backend - Sending Notifications

#### Basic Usage

```typescript
import { notificationService } from '@/lib/notifications';

// Send notification based on user preferences
await notificationService.notify(
  userId,
  'exportComplete',
  {
    userName: 'John Doe',
    resourceType: 'users',
    rowCount: 1500,
    fileSize: '2.3 MB',
    downloadLink: 'https://example.com/download/abc123',
    expiryHours: 24,
  }
);
```

#### Force Specific Channels

```typescript
// Send to specific channels regardless of preferences
await notificationService.notify(
  userId,
  'systemAlert',
  {
    alertType: 'Maintenance',
    message: 'System will be down for maintenance at 2 AM',
    severity: 'high',
    alertTime: new Date().toLocaleString(),
  },
  {
    forceChannels: ['email', 'slack', 'inApp'],
    priority: 1, // High priority
  }
);
```

#### Send to Specific Channel

```typescript
// Send to a single channel
await notificationService.sendToChannel(
  userId,
  'email',
  'login',
  {
    userName: 'John Doe',
    device: 'Chrome on Windows',
    location: 'San Francisco, CA',
    ipAddress: '192.168.1.1',
    loginTime: new Date().toLocaleString(),
  }
);
```

### Frontend - Notification Bell

Add the NotificationBell component to your layout:

```tsx
import { NotificationBell } from '@/components/notifications';

function Header() {
  return (
    <header>
      {/* Other header content */}
      <NotificationBell />
    </header>
  );
}
```

### Frontend - Preferences Page

Add route to your router:

```tsx
import NotificationPreferencesPage from '@/pages/NotificationPreferencesPage';

// In your router configuration
{
  path: '/notifications/preferences',
  element: <NotificationPreferencesPage />,
}
```

## API Endpoints

### Get Available Channels

```http
GET /api/notifications/channels
```

Response:
```json
{
  "channels": [
    { "name": "email", "configured": true },
    { "name": "sms", "configured": false },
    { "name": "push", "configured": true },
    { "name": "slack", "configured": true },
    { "name": "inApp", "configured": true }
  ]
}
```

### Get User Preferences

```http
GET /api/notifications/preferences?eventType=login
```

Response:
```json
{
  "preferences": [
    {
      "userId": "user123",
      "channel": "email",
      "eventType": "login",
      "enabled": true
    }
  ]
}
```

### Update Preference

```http
PUT /api/notifications/preferences
Content-Type: application/json

{
  "channel": "email",
  "eventType": "login",
  "enabled": true
}
```

### Update Bulk Preferences

```http
POST /api/notifications/preferences/bulk
Content-Type: application/json

{
  "preferences": [
    { "channel": "email", "eventType": "login", "enabled": true },
    { "channel": "sms", "eventType": "login", "enabled": false }
  ]
}
```

### Get In-App Notifications

```http
GET /api/notifications/in-app?page=1&limit=20&unreadOnly=true
```

Response:
```json
{
  "notifications": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  },
  "unreadCount": 12
}
```

### Mark Notification as Read

```http
POST /api/notifications/in-app/:id/read
```

### Mark All as Read

```http
POST /api/notifications/in-app/read-all
```

### Get Notification History

```http
GET /api/notifications/history?page=1&limit=20&channel=email&status=sent
```

### Send Test Notification

```http
POST /api/notifications/test
Content-Type: application/json

{
  "channel": "email",
  "eventType": "login"
}
```

## Adding New Event Types

1. **Add to type definition** (`types.ts`):
```typescript
export type NotificationEventType =
  | 'login'
  | 'myNewEvent' // Add your event
  | '...';
```

2. **Create templates** (`templates.ts`):
```typescript
export const templates: TemplateMap = {
  myNewEvent: {
    email: {
      subject: 'New Event Occurred',
      title: 'Something Happened',
      body: 'Details about {{variableName}}...',
    },
    sms: {
      title: 'Event',
      body: 'Short message about {{variableName}}',
    },
    inApp: {
      title: 'Event Notification',
      body: 'Detailed message about {{variableName}}',
    },
  },
};
```

3. **Use in your code**:
```typescript
await notificationService.notify(userId, 'myNewEvent', {
  variableName: 'some value',
});
```

## Adding New Notification Channels

1. **Create channel provider** (`channels/my-channel.channel.ts`):
```typescript
import type { NotificationChannel, NotificationMessage, NotificationResult } from '../types';

export class MyChannelProvider implements NotificationChannel {
  name = 'myChannel' as const;

  async send(recipient: string, message: NotificationMessage): Promise<NotificationResult> {
    // Implementation
  }

  isConfigured(): boolean {
    // Check if channel is configured
    return !!process.env.MY_CHANNEL_API_KEY;
  }

  validateRecipient(recipient: string): boolean {
    // Validate recipient format
    return true;
  }
}
```

2. **Register in NotificationService**:
```typescript
// In notification.service.ts constructor
try {
  this.channels.set('myChannel', new MyChannelProvider());
} catch (error) {
  logger.warn({ error }, 'My channel initialization failed');
}
```

3. **Add templates** for the new channel in `templates.ts`

## Database Schema

### NotificationEventPreference
```prisma
model NotificationEventPreference {
  id        String   @id @default(cuid())
  userId    String
  channel   String   // email, sms, push, slack, inApp
  eventType String   // login, passwordReset, etc.
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, channel, eventType])
  @@index([userId])
  @@index([eventType])
}
```

### NotificationLog
```prisma
model NotificationLog {
  id        String    @id @default(cuid())
  userId    String?
  channel   String
  eventType String
  recipient String
  subject   String?
  content   String    @db.Text
  status    String    @default("pending")
  error     String?   @db.Text
  attempts  Int       @default(0)
  sentAt    DateTime?
  metadata  Json?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([channel])
  @@index([eventType])
  @@index([status])
  @@index([createdAt])
}
```

### InAppNotification
```prisma
model InAppNotification {
  id        String    @id @default(cuid())
  userId    String
  title     String
  message   String    @db.Text
  type      String    @default("info")
  eventType String?
  link      String?
  icon      String?
  isRead    Boolean   @default(false)
  readAt    DateTime?
  metadata  Json?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([isRead])
  @@index([createdAt])
  @@index([eventType])
}
```

## Best Practices

1. **Always provide template data**: Ensure all variables in templates have values
2. **Use appropriate channels**: SMS for urgent, Email for detailed, In-App for informational
3. **Respect user preferences**: Use `notify()` instead of forcing channels
4. **Handle errors gracefully**: Check notification results and log failures
5. **Test notifications**: Use the test endpoint during development
6. **Monitor costs**: SMS and some push services have costs per notification
7. **Cleanup old data**: Schedule regular cleanup of old notification logs

## Troubleshooting

### Email notifications not sending
- Check EMAIL_PROVIDER env variable
- Verify SMTP credentials
- Test with 'console' provider first
- Check email logs in NotificationLog table

### SMS not working
- Verify Twilio credentials
- Ensure phone number is in E.164 format
- Check Twilio account balance
- Review Twilio console for errors

### Push notifications not received
- Verify VAPID keys are correctly set
- Check browser push permission
- Ensure service worker is registered
- Test subscription validity

### Slack notifications not appearing
- Verify webhook URL is correct
- Check webhook is not disabled in Slack
- Test webhook with curl

## Security Considerations

1. **Sensitive Data**: Never include passwords or sensitive tokens in notifications
2. **Rate Limiting**: Implement rate limiting for notification endpoints
3. **Webhook Security**: Validate Slack webhook URLs before storing
4. **User Privacy**: Respect user preferences and opt-out requests
5. **Data Retention**: Implement automatic cleanup of old notification logs

## Future Enhancements

- [ ] WebSocket support for real-time in-app notifications
- [ ] Notification batching (daily digests)
- [ ] Rich media support (images in notifications)
- [ ] Notification scheduling
- [ ] A/B testing for notification templates
- [ ] WhatsApp channel integration
- [ ] Discord channel integration
- [ ] Notification analytics dashboard
