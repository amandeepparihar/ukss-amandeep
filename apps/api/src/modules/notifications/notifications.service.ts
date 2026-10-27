import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { emailService } from '../../lib/email';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { config } from '../../config';

const logger = createLogger('notifications');

// Channel provider interfaces
interface ChannelProvider {
  send(notification: {
    to: string;
    subject?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; externalId?: string; error?: string }>;
}

// Email channel provider
class EmailChannelProvider implements ChannelProvider {
  async send(notification: { to: string; subject?: string; content: string }) {
    try {
      await emailService.send({
        to: notification.to,
        subject: notification.subject || 'Notification',
        html: notification.content,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Email send failed',
      };
    }
  }
}

// SMS channel provider (stub - would integrate with Twilio/etc)
class SMSChannelProvider implements ChannelProvider {
  async send(notification: { to: string; content: string }) {
    // TODO: Integrate with Twilio or other SMS provider
    logger.info({ to: notification.to }, 'SMS notification (stub)');
    return { success: true, externalId: `sms-${Date.now()}` };
  }
}

// Push notification provider (stub - would integrate with Web Push)
class PushChannelProvider implements ChannelProvider {
  async send(notification: { to: string; subject?: string; content: string }) {
    // TODO: Integrate with Web Push API
    logger.info({ to: notification.to }, 'Push notification (stub)');
    return { success: true, externalId: `push-${Date.now()}` };
  }
}

// WhatsApp provider (stub)
class WhatsAppChannelProvider implements ChannelProvider {
  async send(notification: { to: string; content: string }) {
    // TODO: Integrate with WhatsApp Business API
    logger.info({ to: notification.to }, 'WhatsApp notification (stub)');
    return { success: true, externalId: `wa-${Date.now()}` };
  }
}

// Channel provider registry
const providers: Record<NotificationChannel, ChannelProvider> = {
  EMAIL: new EmailChannelProvider(),
  SMS: new SMSChannelProvider(),
  PUSH: new PushChannelProvider(),
  WHATSAPP: new WhatsAppChannelProvider(),
};

export interface SendNotificationInput {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  templateCode?: string;
  channel: NotificationChannel;
  subject?: string;
  content?: string;
  variables?: Record<string, unknown>;
  scheduledFor?: Date;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  notificationId: string;
  status: NotificationStatus;
  error?: string;
}

export class NotificationsService {
  /**
   * Send a notification through the specified channel
   */
  async send(input: SendNotificationInput): Promise<NotificationResult> {
    // If using a template, fetch and render it
    let subject = input.subject;
    let content = input.content || '';

    if (input.templateCode) {
      const template = await this.getTemplate(input.templateCode, input.channel);
      if (template) {
        subject = subject || this.renderTemplate(template.subject || '', input.variables || {});
        content = this.renderTemplate(template.content, input.variables || {});
      }
    }

    // Get recipient contact based on channel
    let recipientContact: string | undefined;
    if (input.userId) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });
      recipientContact = user?.email;
    } else {
      recipientContact = input.email || input.phone || input.deviceToken;
    }

    // Check user preferences
    if (input.userId) {
      const canSend = await this.checkUserPreferences(input.userId, input.channel);
      if (!canSend) {
        logger.info({ userId: input.userId, channel: input.channel }, 'Notification blocked by user preferences');
        return {
          notificationId: '',
          status: 'CANCELLED',
          error: 'Blocked by user preferences',
        };
      }
    }

    // Create notification record
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        email: input.email,
        phone: input.phone,
        deviceToken: input.deviceToken,
        templateId: input.templateCode ? (await this.findTemplateId(input.templateCode)) : undefined,
        channel: input.channel,
        subject,
        content,
        priority: input.priority ?? 5,
        scheduledFor: input.scheduledFor,
        metadata: input.metadata as object,
        status: input.scheduledFor && input.scheduledFor > new Date() ? 'PENDING' : 'QUEUED',
      },
    });

    // If scheduled for later, don't send now
    if (input.scheduledFor && input.scheduledFor > new Date()) {
      return {
        notificationId: notification.id,
        status: 'PENDING',
      };
    }

    // Send immediately
    const result = await this.processNotification(notification.id);
    return result;
  }

  /**
   * Send notification to multiple recipients
   */
  async sendBulk(
    userIds: string[],
    templateCode: string,
    variables: Record<string, unknown>,
    channels?: NotificationChannel[]
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      const channelsToUse = channels || ['EMAIL' as NotificationChannel];

      for (const channel of channelsToUse) {
        try {
          const result = await this.send({
            userId,
            templateCode,
            channel,
            variables,
          });

          if (result.status === 'SENT' || result.status === 'DELIVERED') {
            sent++;
          } else {
            failed++;
          }
        } catch (error) {
          logger.error({ userId, channel, error }, 'Bulk notification failed');
          failed++;
        }
      }
    }

    return { sent, failed };
  }

  /**
   * Process a pending notification
   */
  async processNotification(notificationId: string): Promise<NotificationResult> {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: true },
    });

    if (!notification) {
      return {
        notificationId,
        status: 'FAILED',
        error: 'Notification not found',
      };
    }

    // Determine recipient
    let to: string;
    switch (notification.channel) {
      case 'EMAIL':
        to = notification.email || notification.user?.email || '';
        break;
      case 'SMS':
      case 'WHATSAPP':
        to = notification.phone || '';
        break;
      case 'PUSH':
        to = notification.deviceToken || '';
        break;
      default:
        to = '';
    }

    if (!to) {
      await this.markFailed(notificationId, 'No recipient contact');
      return {
        notificationId,
        status: 'FAILED',
        error: 'No recipient contact',
      };
    }

    // Send through channel provider
    const provider = providers[notification.channel];
    const result = await provider.send({
      to,
      subject: notification.subject || undefined,
      content: notification.content,
      metadata: notification.metadata as Record<string, unknown>,
    });

    if (result.success) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      return {
        notificationId,
        status: 'SENT',
      };
    } else {
      const updatedNotification = await prisma.notification.findUnique({
        where: { id: notificationId },
      });

      const attempts = (updatedNotification?.attempts || 0) + 1;
      const maxAttempts = updatedNotification?.maxAttempts || 3;

      if (attempts >= maxAttempts) {
        await this.markFailed(notificationId, result.error);
        return {
          notificationId,
          status: 'FAILED',
          error: result.error,
        };
      }

      // Schedule retry
      const nextRetry = new Date();
      nextRetry.setMinutes(nextRetry.getMinutes() + Math.pow(2, attempts)); // Exponential backoff

      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          attempts: { increment: 1 },
          nextRetryAt: nextRetry,
          error: result.error,
        },
      });

      return {
        notificationId,
        status: 'QUEUED',
        error: result.error,
      };
    }
  }

  /**
   * Process scheduled and retry notifications
   */
  async processPending(): Promise<{ processed: number; failed: number }> {
    const now = new Date();

    // Find pending scheduled notifications
    const pending = await prisma.notification.findMany({
      where: {
        OR: [
          {
            status: 'PENDING',
            scheduledFor: { lte: now },
          },
          {
            status: 'QUEUED',
            nextRetryAt: { lte: now },
          },
        ],
      },
      take: 100, // Process in batches
    });

    let processed = 0;
    let failed = 0;

    for (const notification of pending) {
      const result = await this.processNotification(notification.id);
      if (result.status === 'SENT' || result.status === 'DELIVERED') {
        processed++;
      } else if (result.status === 'FAILED') {
        failed++;
      }
    }

    return { processed, failed };
  }

  /**
   * Mark notification as delivered (for push/webhook confirmations)
   */
  async markDelivered(notificationId: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: string) {
    const preferences = await prisma.userNotificationPreference.findMany({
      where: { userId },
    });

    // Return all channels with defaults
    const allChannels: NotificationChannel[] = ['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'];
    return allChannels.map(channel => {
      const pref = preferences.find(p => p.channel === channel);
      return {
        channel,
        enabled: pref?.enabled ?? (channel === 'EMAIL'), // Email enabled by default
        quietHoursStart: pref?.quietHoursStart || null,
        quietHoursEnd: pref?.quietHoursEnd || null,
        timezone: pref?.timezone || null,
      };
    });
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: string,
    channel: NotificationChannel,
    preferences: {
      enabled?: boolean;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      timezone?: string | null;
    }
  ) {
    return prisma.userNotificationPreference.upsert({
      where: {
        userId_channel: { userId, channel },
      },
      update: preferences,
      create: {
        userId,
        channel,
        enabled: preferences.enabled ?? true,
        quietHoursStart: preferences.quietHoursStart,
        quietHoursEnd: preferences.quietHoursEnd,
        timezone: preferences.timezone,
      },
    });
  }

  /**
   * Get notification templates
   */
  async getTemplates() {
    return prisma.notificationTemplate.findMany({
      include: { channels: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create or update notification template
   */
  async upsertTemplate(
    code: string,
    data: {
      name: string;
      description?: string;
      variables?: string[];
      channels: Array<{
        channel: NotificationChannel;
        subject?: string;
        content: string;
      }>;
    }
  ) {
    return prisma.$transaction(async (tx) => {
      // Upsert template
      const template = await tx.notificationTemplate.upsert({
        where: { code },
        update: {
          name: data.name,
          description: data.description,
          variables: data.variables || [],
        },
        create: {
          code,
          name: data.name,
          description: data.description,
          variables: data.variables || [],
        },
      });

      // Delete existing channels
      await tx.notificationTemplateChannel.deleteMany({
        where: { templateId: template.id },
      });

      // Create new channels
      for (const channel of data.channels) {
        await tx.notificationTemplateChannel.create({
          data: {
            templateId: template.id,
            channel: channel.channel,
            subject: channel.subject,
            content: channel.content,
          },
        });
      }

      return template;
    });
  }

  /**
   * Get notification history for a user
   */
  async getUserNotifications(
    userId: string,
    options?: { limit?: number; channel?: NotificationChannel }
  ) {
    return prisma.notification.findMany({
      where: {
        userId,
        channel: options?.channel,
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }

  /**
   * Get notification statistics
   */
  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, sentToday, failedToday, byChannel, byStatus] = await Promise.all([
      prisma.notification.count(),
      prisma.notification.count({
        where: { sentAt: { gte: todayStart }, status: 'SENT' },
      }),
      prisma.notification.count({
        where: { createdAt: { gte: todayStart }, status: 'FAILED' },
      }),
      prisma.notification.groupBy({
        by: ['channel'],
        _count: { channel: true },
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.notification.groupBy({
        by: ['status'],
        _count: { status: true },
        where: { createdAt: { gte: todayStart } },
      }),
    ]);

    return {
      total,
      sentToday,
      failedToday,
      byChannel: byChannel.map(c => ({ channel: c.channel, count: c._count.channel })),
      byStatus: byStatus.map(s => ({ status: s.status, count: s._count.status })),
    };
  }

  // Private helpers

  private async getTemplate(code: string, channel: NotificationChannel) {
    const template = await prisma.notificationTemplate.findUnique({
      where: { code },
      include: { channels: true },
    });

    if (!template) return null;

    return template.channels.find(c => c.channel === channel) || null;
  }

  private async findTemplateId(code: string): Promise<string | undefined> {
    const template = await prisma.notificationTemplate.findUnique({
      where: { code },
      select: { id: true },
    });
    return template?.id;
  }

  private renderTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(variables[key] ?? '');
    });
  }

  private async checkUserPreferences(userId: string, channel: NotificationChannel): Promise<boolean> {
    const pref = await prisma.userNotificationPreference.findUnique({
      where: { userId_channel: { userId, channel } },
    });

    // If no preference, default to enabled for email, disabled for others
    if (!pref) {
      return channel === 'EMAIL';
    }

    if (!pref.enabled) return false;

    // Check quiet hours
    if (pref.quietHoursStart && pref.quietHoursEnd) {
      const now = new Date();
      const [startHour, startMin] = pref.quietHoursStart.split(':').map(Number);
      const [endHour, endMin] = pref.quietHoursEnd.split(':').map(Number);

      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (startMinutes < endMinutes) {
        // Normal case: quiet hours within same day
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return false;
        }
      } else {
        // Overnight case: e.g., 22:00 to 08:00
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return false;
        }
      }
    }

    return true;
  }

  private async markFailed(notificationId: string, error?: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        error,
      },
    });
  }
}

export const notificationsService = new NotificationsService();

// Convenience function for simple notifications
export async function notify(
  userId: string,
  templateCode: string,
  variables: Record<string, unknown>,
  channels: NotificationChannel[] = ['EMAIL']
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  for (const channel of channels) {
    const result = await notificationsService.send({
      userId,
      templateCode,
      channel,
      variables,
    });
    results.push(result);
  }

  return results;
}
