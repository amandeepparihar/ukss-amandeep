# Activity Dashboard with Real-time WebSocket Updates

## Overview

This feature implements a comprehensive real-time activity monitoring dashboard using WebSocket connections for instant updates. It provides administrators with live insights into system activities, user actions, and performance metrics.

## Architecture

### Backend Components

#### 1. WebSocket Plugin (`apps/api/src/plugins/websocket.ts`)

The WebSocket plugin provides:
- JWT-based authentication (via query parameter or first message)
- Room-based subscription system
- Connection management and tracking
- Auto-reconnection support
- Ping/pong keep-alive mechanism

**Key Methods:**
```typescript
app.broadcastToRoom(room: string, event: string, data: any): void
app.sendToUser(userId: string, event: string, data: any): void
app.getConnectedUsers(): string[]
app.getRoomClients(room: string): number
```

**WebSocket Endpoint:** `ws://host:port/ws?token=YOUR_JWT_TOKEN`

**Events:**
- `authenticate` - Authenticate with JWT token
- `subscribe` - Subscribe to a room
- `unsubscribe` - Unsubscribe from a room
- `ping` - Keep-alive ping

#### 2. RealtimeService (`apps/api/src/lib/realtime.ts`)

Manages real-time event broadcasting and user tracking:
```typescript
class RealtimeService {
  broadcast(room: string, event: string, data: any): void
  sendToUser(userId: string, event: string, data: any): void
  getConnectedUsers(): string[]
  getRoomClientCount(room: string): number

  // High-level event emitters
  emitUserLogin(userId, userName, metadata): Promise<void>
  emitAction(action, resource, userId, userName, metadata): Promise<void>
  emitUserLogout(userId, userName): Promise<void>
  emitError(error, userId?): void
}
```

#### 3. ActivityService (`apps/api/src/modules/dashboard/activity.service.ts`)

Handles activity aggregation using Redis for real-time counters:

**Redis Keys:**
- `activity:actions:minute:{timestamp}` - Actions per minute (5 min TTL)
- `activity:actions:hour:{timestamp}` - Actions per hour (2 hour TTL)
- `activity:action_types:{timestamp}` - Action type breakdown (2 hour TTL)
- `activity:active_users` - Active users sorted set (1 hour TTL)

**Methods:**
```typescript
getRealtimeStats(): Promise<RealtimeStats>
getHourlyTrend(hours: number): Promise<HourlyTrend[]>
getDailyTrend(days: number): Promise<DailyTrend[]>
getActivityHeatmap(days: number): Promise<ActivityHeatmap[]>
getRecentActivity(limit: number): Promise<Activity[]>
trackAction(action: string, userId?: string): Promise<void>
```

#### 4. Dashboard WebSocket Handler (`apps/api/src/modules/dashboard/dashboard.ws.ts`)

Orchestrates real-time dashboard updates:
- Broadcasts stats every 10 seconds to dashboard room
- Handles user login/logout events
- Tracks action broadcasts
- Provides initial state on connection

**Integration Points:**
- Auth service emits login/logout events
- Audit log creation triggers action broadcasts

#### 5. REST API Endpoints

```
GET /api/dashboard/realtime/stats
GET /api/dashboard/realtime/hourly-trend?hours=24
GET /api/dashboard/realtime/daily-trend?days=7
GET /api/dashboard/realtime/heatmap?days=7
GET /api/dashboard/realtime/activity-feed?limit=50
GET /api/dashboard/realtime/top-actions?limit=10
```

### Frontend Components

#### 1. useWebSocket Hook (`apps/web/src/hooks/useWebSocket.ts`)

Custom hook for WebSocket connections:
```typescript
const { connected, send, subscribe, unsubscribe, reconnect } = useWebSocket({
  room: 'dashboard',
  onMessage: (event, data) => {
    // Handle messages
  },
  autoReconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
});
```

**Features:**
- Automatic authentication
- Room subscription management
- Auto-reconnect with exponential backoff
- Ping/pong keep-alive
- Connection state tracking

#### 2. useDashboardStats Hook (`apps/web/src/hooks/useDashboardStats.ts`)

Combines WebSocket real-time updates with HTTP fallback:
```typescript
const { stats, connected, loading, error, refresh } = useDashboardStats();
```

**Behavior:**
- WebSocket connected: Real-time updates via WebSocket
- WebSocket disconnected: HTTP polling every 10 seconds

#### 3. Components

**RealtimeStatsCard** (`apps/web/src/components/dashboard/RealtimeStatsCard.tsx`)
- Animated number updates
- Color-coded status indicators
- Trend indicators
- Loading states

**LiveActivityChart** (`apps/web/src/components/dashboard/LiveActivityChart.tsx`)
- 24-hour activity trend
- Multiple data series (actions, logins, errors)
- Auto-refresh every minute
- Responsive design

**ActivityFeed** (`apps/web/src/components/dashboard/ActivityFeed.tsx`)
- Live activity stream
- WebSocket-powered real-time updates
- Virtual scrolling support
- Action icons and color coding
- Relative timestamps

**ActivityDashboardPage** (`apps/web/src/pages/ActivityDashboardPage.tsx`)
- Complete dashboard layout
- Real-time stats cards
- Activity chart
- Activity feed
- Connection status indicators

## Usage

### Accessing the Dashboard

Navigate to `/activity` in the admin panel to view the real-time activity dashboard.

### WebSocket Events

#### Broadcasted Events

**stats:update**
```json
{
  "event": "stats:update",
  "data": {
    "activeUsers": 5,
    "actionsPerMinute": 12,
    "actionsThisHour": 450,
    "loginsToday": 23,
    "errorRate": 1.2,
    "connectedClients": 3
  },
  "timestamp": 1234567890
}
```

**user:login**
```json
{
  "event": "user:login",
  "data": {
    "userId": "abc123",
    "userName": "John Doe",
    "email": "john@example.com",
    "ip": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "timestamp": 1234567890
  }
}
```

**user:logout**
```json
{
  "event": "user:logout",
  "data": {
    "userId": "abc123",
    "userName": "John Doe",
    "timestamp": 1234567890
  }
}
```

**action:new**
```json
{
  "event": "action:new",
  "data": {
    "action": "user_update",
    "resource": "users",
    "userId": "abc123",
    "userName": "John Doe",
    "resourceId": "user-456",
    "timestamp": 1234567890
  }
}
```

### Subscribing to Custom Rooms

```typescript
const { subscribe, unsubscribe } = useWebSocket({
  onMessage: (event, data) => {
    console.log('Received:', event, data);
  }
});

// Subscribe to a custom room
subscribe('notifications');

// Unsubscribe
unsubscribe('notifications');
```

### Emitting Custom Events (Backend)

```typescript
// In your service
const realtimeService = createRealtimeService(app);

// Broadcast to a room
realtimeService.broadcast('dashboard', 'custom:event', {
  message: 'Something happened',
});

// Send to specific user
realtimeService.sendToUser('user-123', 'notification', {
  title: 'New Message',
  body: 'You have a new message',
});
```

## Configuration

### WebSocket URL

The WebSocket URL is automatically constructed from the current window location:
- Protocol: `wss://` for HTTPS, `ws://` for HTTP
- Host: Current hostname
- Port: From `VITE_API_PORT` environment variable (default: 3001)

### Environment Variables

**.env (Frontend)**
```bash
VITE_API_PORT=3001
```

**.env (Backend)**
```bash
PORT=3001
HOST=0.0.0.0
```

## Performance Considerations

### Redis Data Cleanup

The ActivityService includes a `cleanupOldData()` method that should be run periodically:
```typescript
// Run daily via cron job
await activityService.cleanupOldData();
```

This removes:
- Minute counters older than 10 minutes
- Hour counters older than 48 hours
- Active users older than 1 hour

### Debouncing

High-frequency updates are debounced:
- Stats broadcasts: Every 10 seconds
- Chart updates: Every 60 seconds
- Active user tracking: 30-minute window

### Limiting Data Points

- Activity feed: Limited to 50 most recent items
- Chart data: Limited to 24 hours (24 data points)
- Heatmap: Limited to 7 days

## Security

### Authentication

- WebSocket connections require valid JWT tokens
- Tokens can be provided via:
  1. Query parameter: `?token=YOUR_JWT`
  2. First message: `{ event: 'authenticate', data: { token: 'YOUR_JWT' } }`

### Authorization

- All WebSocket routes require authentication
- Room subscriptions are validated
- User data is filtered based on permissions

## Testing

### Manual Testing

1. **Login to admin panel**
2. **Navigate to `/activity`**
3. **Check WebSocket connection status** (green = connected)
4. **Open another browser/incognito window**
5. **Login with another user**
6. **Observe real-time updates** in the first window

### WebSocket Connection Testing

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?token=YOUR_JWT');

ws.onopen = () => {
  console.log('Connected');
  ws.send(JSON.stringify({ event: 'subscribe', data: { room: 'dashboard' } }));
};

ws.onmessage = (event) => {
  console.log('Message:', JSON.parse(event.data));
};
```

## Troubleshooting

### WebSocket Not Connecting

1. **Check CORS settings** - Ensure API allows WebSocket connections
2. **Verify JWT token** - Token must be valid and not expired
3. **Check firewall** - Port 3001 must be accessible
4. **Browser console** - Check for WebSocket errors

### Stats Not Updating

1. **Check Redis connection** - Ensure Redis is running
2. **Verify WebSocket handler initialization** - Should log "Stats broadcast started"
3. **Check room subscription** - Client must subscribe to 'dashboard' room

### High Memory Usage

1. **Run cleanup** - Execute `activityService.cleanupOldData()`
2. **Reduce data retention** - Adjust TTL values in ActivityService
3. **Limit connected clients** - Implement connection limits if needed

## Future Enhancements

- User activity heatmap visualization
- Custom alert thresholds
- Export activity data
- Historical trend comparison
- Performance metrics graphs
- Real-time log streaming
- Custom dashboard widgets

## Related Files

**Backend:**
- `/apps/api/src/plugins/websocket.ts`
- `/apps/api/src/lib/realtime.ts`
- `/apps/api/src/modules/dashboard/activity.service.ts`
- `/apps/api/src/modules/dashboard/dashboard.ws.ts`
- `/apps/api/src/modules/dashboard/dashboard.routes.ts`
- `/apps/api/src/app.ts`

**Frontend:**
- `/apps/web/src/hooks/useWebSocket.ts`
- `/apps/web/src/hooks/useDashboardStats.ts`
- `/apps/web/src/components/dashboard/RealtimeStatsCard.tsx`
- `/apps/web/src/components/dashboard/LiveActivityChart.tsx`
- `/apps/web/src/components/dashboard/ActivityFeed.tsx`
- `/apps/web/src/pages/ActivityDashboardPage.tsx`
- `/apps/web/src/App.tsx`

## Dependencies

**Backend:**
- `@fastify/websocket`: WebSocket support
- `ioredis`: Redis client
- `date-fns`: Date utilities

**Frontend:**
- `recharts`: Chart library
- `date-fns`: Date utilities
- `lucide-react`: Icons

## Deployment Notes

1. **Redis required** - Ensure Redis is running and accessible
2. **WebSocket support** - Reverse proxy must support WebSocket upgrades
3. **Port configuration** - Ensure WebSocket port is accessible
4. **Environment variables** - Set VITE_API_PORT correctly

### Nginx Configuration

```nginx
location /ws {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
```

## License

This feature is part of the Admin Panel Framework.
