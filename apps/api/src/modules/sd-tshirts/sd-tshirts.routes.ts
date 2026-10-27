import type { FastifyPluginAsync } from 'fastify';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import * as service from './sd-tshirts.service';
import { getTshirtsQuerySchema, approveProductsSchema } from './sd-tshirts.schema';
import * as cronService from './sd-tshirts.cron';

export const sdTshirtsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/seller-dynamics-listing
  app.get(
    '/',
    {
      preHandler: [app.requirePermission('sd-tshirts:view')],
    },
    async (request, reply) => {
      return runWithExecution('sd-tshirts', async () => {
        getLogger('sd-tshirts-request').info(
          { method: 'GET', url: request.url, query: request.query },
          'incoming request'
        );

        try {
          const query = getTshirtsQuerySchema.parse(request.query);
          const result = await service.getTshirts(query);

          getLogger('sd-tshirts-response').info(
            { status: 200, total: result.total },
            'tshirts fetched successfully'
          );

          return reply.send({
            success: true,
            data: result.data,
            meta: {
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              totalPages: result.totalPages,
            },
          });
        } catch (err) {
          getLogger('sd-tshirts-response').error({ err }, 'failed to fetch tshirts');
          throw err;
        }
      });
    }
  );

  // PATCH /api/seller-dynamics/approve
  app.patch(
    '/approve',
    {
      preHandler: [app.requirePermission('sd-tshirts:approve')],
    },
    async (request, reply) => {
      return runWithExecution('sd-tshirts', async () => {
        getLogger('sd-tshirts-request').info(
          { method: 'PATCH', url: request.url, body: request.body },
          'incoming request'
        );

        try {
          const input = approveProductsSchema.parse(request.body);
          const userId = request.user.sub;

          const result = await service.approveProducts(input, userId);

          getLogger('sd-tshirts-response').info(
            { status: 200, inserted: result.inserted },
            'products approved successfully'
          );

          return reply.send({ success: true, data: result });
        } catch (err) {
          getLogger('sd-tshirts-response').error({ err }, 'failed to approve products');
          throw err;
        }
      });
    }
  );

  // GET /api/seller-dynamics-listing/pending
  app.get(
    '/pending',
    {
      preHandler: [app.requirePermission('sd-tshirts:view')],
    },
    async (request, reply) => {
      return runWithExecution('sd-tshirts', async () => {
        getLogger('sd-tshirts-request').info(
          { method: 'GET', url: request.url },
          'incoming request'
        );
        try {
          const result = await service.getPendingListings();
          getLogger('sd-tshirts-response').info(
            { status: 200, count: result.length },
            'pending listings fetched successfully'
          );
          return reply.send({ success: true, data: result });
        } catch (err) {
          getLogger('sd-tshirts-response').error({ err }, 'failed to fetch pending listings');
          throw err;
        }
      });
    }
  );

  // GET /api/seller-dynamics-listing/run-bulk-upload
  app.post(
    '/run-bulk-upload',
    {
      preHandler: [app.requirePermission('sd-tshirts:sync')],
    },
    async (request, reply) => {
      return runWithExecution('sd-tshirts', async () => {
        getLogger('sd-tshirts-request').info(
          { method: 'POST', url: '/api/seller-dynamics-listing/test-cron' },
          'incoming request'
        );
        try {
          await cronService.runDailyBulkUpload();
          return reply.send({ success: true, data: { message: 'cron executed' } });
        } catch (err) {
          getLogger('sd-tshirts-response').error({ err }, 'cron failed');
          throw err;
        }
      });
    }
  );

  // GET /api/seller-dynamics-listing/run-sku-check
  app.post(
    '/run-sku-check',
    {
      preHandler: [app.requirePermission('sd-tshirts:sync')],
    },
    async (request, reply) => {
      return runWithExecution('sd-tshirts', async () => {
        getLogger('sd-tshirts-request').info(
          { method: 'POST', url: request.url },
          'incoming request'
        );
        try {
          await cronService.runHourlySkuCheck();
          return reply.send({ success: true, data: { message: 'cron executed' } });
        } catch (err) {
          getLogger('sd-tshirts-response').error({ err }, 'cron failed');
          throw err;
        }
      });
    }
  );
};
