import type { FastifyPluginAsync } from 'fastify';
import { getDashboardData } from './marketplace-dashboard.service';

export const marketplaceDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard', {
    preHandler: [app.requirePermission('marketplaces:read')],
    handler: async () => {
      const marketplaces = await getDashboardData();
      return { data: { marketplaces } };
    },
  });
};
