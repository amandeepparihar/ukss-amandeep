import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { activityService } from './activity.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger('activity-routes');

// Store connected WebSocket clients
const connectedClients = new Set<WebSocket>();

// Broadcast interval (10 seconds)
const BROADCAST_INTERVAL = 10000;

let broadcastTimer: NodeJS.Timeout | null = null;

/**
 * Broadcast stats to all connected clients
 */
async function broadcastStats() {
  if (connectedClients.size === 0) return;

  try {
    const stats = await activityService.getDashboardStats();
    const message = JSON.stringify({ type: 'stats', data: stats });

    for (const client of connectedClients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to broadcast stats');
  }
}

/**
 * Start broadcasting stats to connected clients
 */
function startBroadcasting() {
  if (broadcastTimer) return;

  broadcastTimer = setInterval(broadcastStats, BROADCAST_INTERVAL);
  logger.info('Activity broadcast started');
}

/**
 * Stop broadcasting when no clients are connected
 */
function stopBroadcasting() {
  if (broadcastTimer && connectedClients.size === 0) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
    logger.info('Activity broadcast stopped');
  }
}

export const activityRoutes: FastifyPluginAsync = async (app) => {
  // REST endpoints for initial data load

  // GET /api/activity/stats - Dashboard statistics
  app.get('/stats', {
    preHandler: [app.authenticate],
  }, async () => {
    const stats = await activityService.getDashboardStats();
    return { data: stats };
  });

  // GET /api/activity/logins-by-hour - Logins chart data
  app.get('/logins-by-hour', {
    preHandler: [app.authenticate],
  }, async () => {
    const data = await activityService.getLoginsByHour();
    return { data };
  });

  // GET /api/activity/actions-by-resource - Actions breakdown
  app.get('/actions-by-resource', {
    preHandler: [app.authenticate],
  }, async () => {
    const data = await activityService.getActionsByResource();
    return { data };
  });

  // GET /api/activity/recent - Recent activity feed
  app.get<{
    Querystring: { limit?: number };
  }>('/recent', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const limit = request.query.limit ?? 20;
    const data = await activityService.getRecentActivity(limit);
    return { data };
  });

  // GET /api/activity/online-users - Currently online users
  app.get('/online-users', {
    preHandler: [app.authenticate],
  }, async () => {
    const data = await activityService.getOnlineUsers();
    return { data };
  });

  // WebSocket endpoint for real-time updates
  app.get('/ws', {
    websocket: true,
  }, async (connection, request) => {
    const socket = connection.socket;

    // Verify authentication via query parameter (token)
    const token = (request.query as Record<string, string>).token;
    if (!token) {
      socket.close(4001, 'Authentication required');
      return;
    }

    try {
      // Verify JWT token
      await app.jwt.verify(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    logger.info({ clientCount: connectedClients.size + 1 }, 'WebSocket client connected');

    // Add to connected clients
    connectedClients.add(socket);

    // Start broadcasting if this is the first client
    if (connectedClients.size === 1) {
      startBroadcasting();
    }

    // Send initial stats immediately
    try {
      const stats = await activityService.getDashboardStats();
      socket.send(JSON.stringify({ type: 'stats', data: stats }));
    } catch (error) {
      logger.error({ error }, 'Failed to send initial stats');
    }

    // Handle client messages
    socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Handle ping-pong for keepalive
        if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Handle data requests
        if (data.type === 'get-stats') {
          const stats = await activityService.getDashboardStats();
          socket.send(JSON.stringify({ type: 'stats', data: stats }));
        }

        if (data.type === 'get-logins') {
          const logins = await activityService.getLoginsByHour();
          socket.send(JSON.stringify({ type: 'logins', data: logins }));
        }

        if (data.type === 'get-recent') {
          const recent = await activityService.getRecentActivity(data.limit ?? 20);
          socket.send(JSON.stringify({ type: 'recent', data: recent }));
        }
      } catch (error) {
        logger.error({ error }, 'Failed to handle WebSocket message');
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      connectedClients.delete(socket);
      logger.info({ clientCount: connectedClients.size }, 'WebSocket client disconnected');

      // Stop broadcasting if no clients
      stopBroadcasting();
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
      connectedClients.delete(socket);
    });
  });
};

/**
 * Broadcast an activity event to all connected clients
 * Call this from other services when events occur
 */
export function broadcastActivityEvent(event: {
  type: 'login' | 'logout' | 'action' | 'error';
  data: Record<string, unknown>;
}) {
  if (connectedClients.size === 0) return;

  const message = JSON.stringify({ type: 'event', event });

  for (const client of connectedClients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}
