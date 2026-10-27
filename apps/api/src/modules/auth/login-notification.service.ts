import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import {
  generateDeviceFingerprint,
  getDeviceName,
} from '../../lib/device-detection.js';
import {
  getLocationFromIP,
  formatLocation,
  getClientIP,
} from '../../lib/geoip.js';
import { emailService } from '../../lib/email.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('login-notification');

export interface LoginContext {
  ip?: string;
  userAgent?: string;
  acceptHeaders?: string;
  clientFingerprint?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export class LoginNotificationService {
  constructor(private app: FastifyInstance) {}

  async recordLogin(
    userId: string,
    context: LoginContext,
    success: boolean = true,
    failureReason?: string
  ): Promise<{ isNewDevice: boolean; isSuspicious: boolean }> {
    try {
      const ipAddress = context.headers
        ? getClientIP({ headers: context.headers, ip: context.ip })
        : context.ip || '127.0.0.1';

      const { fingerprint, info } = generateDeviceFingerprint(
        context.userAgent,
        context.acceptHeaders,
        context.clientFingerprint
      );

      const location = await getLocationFromIP(ipAddress);
      const locationString = formatLocation(location);

      const trustedDevice = await prisma.trustedDevice.findUnique({
        where: {
          userId_fingerprint: {
            userId,
            fingerprint,
          },
        },
      });

      const isTrusted = !!trustedDevice;
      const isNewDevice = !isTrusted && success;

      await prisma.loginHistory.create({
        data: {
          userId,
          ipAddress,
          userAgent: context.userAgent || 'Unknown',
          fingerprint,
          location: locationString,
          browser: info.browser,
          os: info.os,
          deviceType: info.deviceType,
          isTrusted,
          success,
          failureReason,
        },
      });

      if (trustedDevice && success) {
        await prisma.trustedDevice.update({
          where: { id: trustedDevice.id },
          data: { lastUsedAt: new Date() },
        });
      }

      if (isNewDevice) {
        await this.sendNewDeviceAlert(userId, {
          fingerprint,
          deviceInfo: info,
          location: locationString,
          ipAddress,
        });
      }

      return { isNewDevice, isSuspicious: false };
    } catch (error) {
      console.error('Error recording login:', error);
      return { isNewDevice: false, isSuspicious: false };
    }
  }

  async sendNewDeviceAlert(
    userId: string,
    loginInfo: {
      fingerprint: string;
      deviceInfo: any;
      location: string;
      ipAddress: string;
    }
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      });

      if (!user) return;

      const deviceName = getDeviceName(loginInfo.deviceInfo);
      const loginTime = new Date().toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
      });

      // Create notification record
      await prisma.notification.create({
        data: {
          userId,
          channel: 'EMAIL',
          subject: 'New device login to your account',
          content: `
            <h2>New Device Login</h2>
            <p>Hello ${user.firstName},</p>
            <p>We detected a login to your account from a device we don't recognize:</p>
            <ul>
              <li><strong>Device:</strong> ${deviceName}</li>
              <li><strong>Location:</strong> ${loginInfo.location}</li>
              <li><strong>IP Address:</strong> ${loginInfo.ipAddress}</li>
              <li><strong>Time:</strong> ${loginTime}</li>
            </ul>
            <p>If this was you, you can trust this device in your security settings.</p>
            <p>If you don't recognize this activity, please secure your account immediately.</p>
          `,
          priority: 3,
          status: 'PENDING',
          metadata: {
            type: 'new_device_login',
            fingerprint: loginInfo.fingerprint,
          },
        },
      });

      // Actually send the email
      try {
        await emailService.sendLoginNotification(user.email, {
          browser: loginInfo.deviceInfo.browser,
          os: loginInfo.deviceInfo.os,
          ip: loginInfo.ipAddress,
          location: loginInfo.location,
        });

        // Update notification status to SENT
        await prisma.notification.updateMany({
          where: {
            userId,
            channel: 'EMAIL',
            status: 'PENDING',
            metadata: {
              path: ['type'],
              equals: 'new_device_login',
            },
          },
          data: {
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        logger.info({ userId, email: user.email }, 'New device login notification sent');
      } catch (emailError) {
        // Update notification status to FAILED
        await prisma.notification.updateMany({
          where: {
            userId,
            channel: 'EMAIL',
            status: 'PENDING',
            metadata: {
              path: ['type'],
              equals: 'new_device_login',
            },
          },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            error: emailError instanceof Error ? emailError.message : 'Unknown error',
          },
        });
        logger.warn({ userId, error: emailError }, 'Failed to send login notification email');
      }
    } catch (error) {
      logger.error({ error, userId }, 'Error sending new device alert');
    }
  }

  async trustDevice(
    userId: string,
    fingerprint: string,
    name?: string,
    deviceInfo?: any
  ): Promise<void> {
    await prisma.trustedDevice.upsert({
      where: {
        userId_fingerprint: {
          userId,
          fingerprint,
        },
      },
      create: {
        userId,
        fingerprint,
        name: name || (deviceInfo ? getDeviceName(deviceInfo) : 'Trusted Device'),
        browser: deviceInfo?.browser,
        os: deviceInfo?.os,
        deviceType: deviceInfo?.deviceType,
        lastUsedAt: new Date(),
      },
      update: {
        name: name || (deviceInfo ? getDeviceName(deviceInfo) : undefined),
        lastUsedAt: new Date(),
      },
    });
  }

  async getTrustedDevices(userId: string) {
    return prisma.trustedDevice.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await prisma.trustedDevice.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.userId !== userId) {
      throw new Error('Device not found or unauthorized');
    }

    await prisma.trustedDevice.delete({
      where: { id: deviceId },
    });
  }

  async getLoginHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      successOnly?: boolean;
    } = {}
  ) {
    const { limit = 50, offset = 0, successOnly = false } = options;

    const where = {
      userId,
      ...(successOnly && { success: true }),
    };

    const [history, total] = await Promise.all([
      prisma.loginHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.loginHistory.count({ where }),
    ]);

    return {
      data: history,
      total,
      limit,
      offset,
    };
  }
}
