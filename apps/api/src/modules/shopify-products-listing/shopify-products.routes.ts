import type { FastifyPluginAsync } from 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { createLogger } from '../../lib/logger';
import { enforceInventoryPolicyChange, flagStockChange, purgeAllRecords, refreshPrice, stageNewProducts, stageNewSizes, updateTagsAndLabel } from './shopify-products-staging.service';
import { runWithExecution } from '../../lib/logger-context';
import { StoreIdNumericParamSchema, StoreIdAndLimitParams } from './shopify-product.schema';
import { createProductsShopify, syncSortOrderOnShopify, updateInventoryOnShopify, updatePriceOnShopify, updateProductMetafieldsOnShopify, updateProductsDetailOnShopify } from './shopify-products-push.service';

const logger = createLogger('shopify-orders');

export const shopifyProductsRoutes: FastifyPluginAsync = async (app) => {

  // ===========================================
  // Shopify products Routes
  // ===========================================

  // Job1 
  app.get('/stage_products/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id } = StoreIdNumericParamSchema.parse(request.params);
        await stageNewProducts(id);

        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to Stage Products';
        logger.error({ error }, `Failed to stage orders - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }

        throw error;
      }
    })
  });

  // Job 7
  // Create Products on Shopify
  app.get('/create_products_on_shopify/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id } = StoreIdNumericParamSchema.parse(request.params);
        const response = await createProductsShopify(id);

        return reply.status(200).send({ success: true, data: response });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to Create Products on Shopify';
        logger.error({ error }, `Failed to Create Products on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });

  // Job 3 refresh price for shopify tables
  app.get('/refresh_price_in_shopify_tables', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        await refreshPrice();

        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to Refresh Product price for Shopify tables';
        logger.error({ error }, `Failed to Refresh Product price for Shopify tables - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }

        throw error;
      }
    })
  });

  // Job 8 Update Details on Shopify 
  app.get('/update_product_detail_on_shopify/:id/:all', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id, all } = StoreIdAndLimitParams.parse(request.params);
        const response = await updateProductsDetailOnShopify(id, all);

        return reply.status(200).send({ success: true, data: response });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update product details on Shopify';
        logger.error({ error }, `Failed to product details on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });

  // Job 9 push price updates
  app.get('/update_price_on_shopify/:id/:all', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id, all } = StoreIdAndLimitParams.parse(request.params);
        const response = await updatePriceOnShopify(id, all);

        return reply.status(200).send({ success: true, data: response });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update price on Shopify';
        logger.error({ error }, `Failed to update price on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });


  // Job 10 push stock updates
  app.get('/update_inventory_on_shopify/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id } = StoreIdNumericParamSchema.parse(request.params)
        const result = await updateInventoryOnShopify(id);

        return reply.status(200).send(result);

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update stocks on Shopify';
        logger.error({ error }, `Failed to update stocks on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });

  // Job 12  Sync collection sort order 
  app.get('/sync_sort_order_on_shopify/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id } = StoreIdNumericParamSchema.parse(request.params)
        await syncSortOrderOnShopify(id);

        return reply.status(200).send({ success: true });

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to sync collection sort order on Shopify';
        logger.error({ error }, `Failed to sync collection sort order on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });

  // Job 11 push metafields on shopify
  app.get('/update_metafields_on_shopify/:id/:all', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        const { id, all } = StoreIdAndLimitParams.parse(request.params);
        await updateProductMetafieldsOnShopify(id, all);

        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update stocks on Shopify';
        logger.error({ error }, `Failed to update stocks on Shopify - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });



  // Job 4 Flag Stock Change 

  app.get('/flag_stock_change', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        await flagStockChange();

        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to flag stock change ';
        logger.error({ error }, `Failed to flag stock change - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }

        throw error;
      }
    })
  });

  // Job 6 Enforce inventory policy on dead sizes 
  app.get('/enforce_inventory_policy_on_dead_size/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {

        const { id } = StoreIdNumericParamSchema.parse(request.params);
        await enforceInventoryPolicyChange(id);

        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to enforce inventory policy on dead sizes ';
        logger.error({ error }, `Failed to enforce inventory policy on dead sizes - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });




  // Job 5 -Recompute tags and google labels 
  app.get('/update_tags_label_on_shopify_able/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {

        const { id } = StoreIdNumericParamSchema.parse(request.params);
        await updateTagsAndLabel(id);
        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update tags and google labels on Shopify Table';
        logger.error({ error }, `Failed to update tags and google labels on Shopify Table - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }

        throw error;
      }
    })
  });



  // Job 2 -Stage new sizes
  app.get('/stage_new_size/:id', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {

        const { id } = StoreIdNumericParamSchema.parse(request.params);
        await stageNewSizes(id);
        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add new sizes on Shopify Table';
        logger.error({ error }, `Failed to add new sizes on Shopify Table - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });

  // Job 13 — Purge old logs
  app.get('/purge_all_records', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return runWithExecution('shopify-products', async () => {
      try {
        await purgeAllRecords();
        return reply.status(200).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove old logs';
        logger.error({ error }, `Failed to remove old logs - message: ${message}`);

        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
          });
        }
        throw error;
      }
    })
  });


}