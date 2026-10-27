import type { FastifyPluginAsync } from 'fastify';
import { LoginNotificationService } from './login-notification.service.js';
import { generateDeviceFingerprint } from '../../lib/device-detection.js';

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  const loginNotificationService = new LoginNotificationService(app);

  app.get(
    '/devices',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const devices = await loginNotificationService.getTrustedDevices(
        request.user.sub
      );
      return { data: devices };
    }
  );

  app.delete(
    '/devices/:id',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const { id } = request.params as { id: string };
      await loginNotificationService.removeDevice(request.user.sub, id);
      return { data: { success: true } };
    }
  );

  app.post(
    '/devices/trust',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const { name, clientFingerprint } = request.body as {
        name?: string;
        clientFingerprint?: string;
      };

      const { fingerprint, info } = generateDeviceFingerprint(
        request.headers['user-agent'],
        request.headers.accept as string,
        clientFingerprint
      );

      await loginNotificationService.trustDevice(
        request.user.sub,
        fingerprint,
        name,
        info
      );

      return { data: { success: true, fingerprint } };
    }
  );

  app.get(
    '/login-history',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const query = request.query as {
        limit?: string;
        offset?: string;
        successOnly?: string;
      };

      const limit = query.limit ? parseInt(query.limit) : 50;
      const offset = query.offset ? parseInt(query.offset) : 0;
      const successOnly = query.successOnly === 'true';

      const history = await loginNotificationService.getLoginHistory(
        request.user.sub,
        { limit, offset, successOnly }
      );

      return { data: history };
    }
  );

  app.get(
    '/devices/current',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      const { fingerprint, info } = generateDeviceFingerprint(
        request.headers['user-agent'],
        request.headers.accept as string
      );

      return {
        data: {
          fingerprint,
          info,
        },
      };
    }
  );
};
