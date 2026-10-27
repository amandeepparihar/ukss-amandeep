import type { FastifyPluginAsync } from 'fastify';
import {
  GetBarcodeLookupParamsSchema,
  GetBarcodeLookupQuerySchema,
  GetProductsSearchQuerySchema,
} from './fc-scan.schema';
import { lookupBarcodeByBox, searchProducts } from './fc-scan.service';

export const fcScanRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @taskId #164991
   * GET /api/fc-scan/barcode/:barcode?boxCode=FC2023
   * Look up barcode in product_quantities filtered by boxCode.
   * Returns enriched product variation details or null if not found.
   */
  app.get<{
    Params: { barcode: string };
    Querystring: { boxCode?: string };
  }>('/barcode/:barcode', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const params = GetBarcodeLookupParamsSchema.safeParse(request.params);
      const query = GetBarcodeLookupQuerySchema.safeParse(request.query);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: params.error.errors.map((e) => e.message).join('; '),
          },
        });
      }
      if (!query.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: query.error.errors.map((e) => e.message).join('; '),
          },
        });
      }

      const result = await lookupBarcodeByBox(params.data.barcode, query.data.boxCode);

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      request.log.error({ error }, 'Barcode lookup failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message:
            error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      });
    }
  });

  /**
   * @taskId #164991
   * GET /api/fc-scan/products/search?query=MU
   * Search product codes by partial match on product code or product name.
   * Returns up to 20 results. Requires logged-in user.
   */
  app.get<{
    Querystring: { query?: string };
  }>('/products/search', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const parsed = GetProductsSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join('; '),
          },
        });
      }
      const results = await searchProducts(parsed.data.query);
      return reply.status(200).send({
        success: true,
        data: results,
      });
    } catch (error) {
      request.log.error({ error }, 'Products search failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message:
            error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      });
    }
  });
};
