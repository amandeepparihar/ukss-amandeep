import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';

const logger = createLogger('activity');

export interface DashboardStats {
  activeSessions: number;
  totalUsers: number;
  activeUsers: number; // Users with active sessions
  loginsToday: number;
  loginsTrend: number; // percentage change from yesterday
  actionsToday: number;
  actionsTrend: number;
  failedLoginsToday: number;
  systemHealth: 'healthy' | 'degraded' | 'critical';
}

export interface LoginsByHour {
  hour: string;
  count: number;
  failed: number;
}

export interface ActionsByResource {
  resource: string;
  count: number;
}

export interface RecentActivity {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  createdAt: Date;
}

export class ActivityService {
  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const [
      activeSessions,
      totalUsers,
      activeUsers,
      loginsToday,
      loginsYesterday,
      actionsToday,
      actionsYesterday,
      failedLoginsToday,
    ] = await Promise.all([
      // Active sessions (not expired)
      prisma.session.count({
        where: {
          expiresAt: { gt: now },
        },
      }),
      // Total users
      prisma.user.count({
        where: { deletedAt: null },
      }),
      // Users with active sessions
      prisma.session.groupBy({
        by: ['userId'],
        where: {
          expiresAt: { gt: now },
        },
      }).then(groups => groups.length),
      // Logins today
      prisma.loginHistory.count({
        where: {
          createdAt: { gte: todayStart },
          success: true,
        },
      }),
      // Logins yesterday
      prisma.loginHistory.count({
        where: {
          createdAt: { gte: yesterdayStart, lt: todayStart },
          success: true,
        },
      }),
      // Actions today
      prisma.auditLog.count({
        where: {
          createdAt: { gte: todayStart },
        },
      }),
      // Actions yesterday
      prisma.auditLog.count({
        where: {
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      // Failed logins today
      prisma.loginHistory.count({
        where: {
          createdAt: { gte: todayStart },
          success: false,
        },
      }),
    ]);

    // Calculate trends
    const loginsTrend = loginsYesterday > 0
      ? Math.round(((loginsToday - loginsYesterday) / loginsYesterday) * 100)
      : 0;
    const actionsTrend = actionsYesterday > 0
      ? Math.round(((actionsToday - actionsYesterday) / actionsYesterday) * 100)
      : 0;

    // Determine system health based on error rate
    let systemHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (failedLoginsToday > loginsToday * 0.2) {
      systemHealth = 'critical';
    } else if (failedLoginsToday > loginsToday * 0.1) {
      systemHealth = 'degraded';
    }

    return {
      activeSessions,
      totalUsers,
      activeUsers,
      loginsToday,
      loginsTrend,
      actionsToday,
      actionsTrend,
      failedLoginsToday,
      systemHealth,
    };
  }

  /**
   * Get logins by hour for the last 24 hours
   */
  async getLoginsByHour(): Promise<LoginsByHour[]> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const logins = await prisma.loginHistory.findMany({
      where: {
        createdAt: { gte: twentyFourHoursAgo },
      },
      select: {
        createdAt: true,
        success: true,
      },
    });

    // Group by hour
    const hourlyData: Record<string, { count: number; failed: number }> = {};

    // Initialize all 24 hours
    for (let i = 0; i < 24; i++) {
      const hour = new Date(twentyFourHoursAgo.getTime() + i * 60 * 60 * 1000);
      const hourStr = hour.toISOString().slice(0, 13);
      hourlyData[hourStr] = { count: 0, failed: 0 };
    }

    // Count logins
    for (const login of logins) {
      const hourStr = login.createdAt.toISOString().slice(0, 13);
      if (hourlyData[hourStr]) {
        if (login.success) {
          hourlyData[hourStr].count++;
        } else {
          hourlyData[hourStr].failed++;
        }
      }
    }

    return Object.entries(hourlyData).map(([hour, data]) => ({
      hour: new Date(hour).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      count: data.count,
      failed: data.failed,
    }));
  }

  /**
   * Get actions grouped by resource
   */
  async getActionsByResource(): Promise<ActionsByResource[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const actions = await prisma.auditLog.groupBy({
      by: ['resource'],
      where: {
        createdAt: { gte: todayStart },
      },
      _count: {
        resource: true,
      },
      orderBy: {
        _count: {
          resource: 'desc',
        },
      },
      take: 10,
    });

    return actions.map(a => ({
      resource: a.resource,
      count: a._count.resource,
    }));
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(limit: number = 20): Promise<RecentActivity[]> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return logs.map(log => ({
      id: log.id,
      userId: log.userId,
      userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : null,
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId,
      createdAt: log.createdAt,
    }));
  }

  /**
   * Get online users
   */
  async getOnlineUsers(): Promise<Array<{
    userId: string;
    email: string;
    name: string;
    lastActive: Date;
  }>> {
    const now = new Date();

    const activeSessions = await prisma.session.findMany({
      where: {
        expiresAt: { gt: now },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { lastActiveAt: 'desc' },
      distinct: ['userId'],
    });

    return activeSessions.map(session => ({
      userId: session.user.id,
      email: session.user.email,
      name: `${session.user.firstName} ${session.user.lastName}`,
      lastActive: session.lastActiveAt,
    }));
  }
}

export const activityService = new ActivityService();
