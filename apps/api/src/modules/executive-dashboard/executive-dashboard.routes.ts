import type { FastifyPluginAsync } from 'fastify';
import { executiveDashboardQuerySchema } from './executive-dashboard.schema';
import {
  getExecutiveTrends,
  getExecutiveKPIs,
  getExecutiveMarketplaceBreakdown,
} from './executive-dashboard.service';

function parseStores(stores?: string): number[] | undefined {
  return stores ? stores.split(',').map(Number) : undefined;
}

export const executiveDashboardRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication + executive-dashboard:view permission
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('executive-dashboard', 'view'));

  app.get('/trends', async (request) => {
    const query = executiveDashboardQuerySchema.parse(request.query);
    const data = await getExecutiveTrends(query.startDate, query.endDate, parseStores(query.stores), query.comparePrevious, query.noCache);
    return { data };
  });

  app.get('/kpi', async (request) => {
    const query = executiveDashboardQuerySchema.parse(request.query);
    const data = await getExecutiveKPIs(query.startDate, query.endDate, parseStores(query.stores), query.noCache);
    return { data };
  });

  app.get('/marketplace-breakdown', async (request) => {
    const query = executiveDashboardQuerySchema.parse(request.query);
    const data = await getExecutiveMarketplaceBreakdown(query.startDate, query.endDate, query.noCache);
    return { data };
  });
};
