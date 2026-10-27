/**
 * Stock Home Grid module routes.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import { addMysteryProduct, checkRemapAllowed, checkSupplierBarcodeUnique, getSupplierBarcodeData, getTeamLetters, saveSupplierBarcode, remapSize, validateRemapSize, RemapError } from './stock-home-grid.service';
import { MysteryProductSchema, RemapCheckQuerySchema, RemapSizeBodySchema, RemapValidateSizeQuerySchema, SupplierBarcodeFetchQuerySchema, SupplierBarcodeSaveSchema, SupplierBarcodeUniqueQuerySchema } from './stock-home-grid.schema';

export const stockHomeGridRoutes: FastifyPluginAsync = async (app) => {

    // gets the teams first letter
    app.get('/team-letters', {
        preHandler: [app.requirePermission('deliveries:view')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const result = await getTeamLetters();
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid query parameters',
                        details: error.errors,
                    });
                }
                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Failed to fetch teams Letter for Stock Grid');
                request.log.error(error, 'Failed to fetch teams Letter for Stock Grid');
                return reply.status(500).send({ status: 'error', message: 'Failed to fetch teams Letter for Stock Grid' });
            }
        })
    });

    // Add products to Mystery Product List
    app.post('/mystery_product', {
        preHandler: [app.requirePermission('deliveries:mystery_list')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {

                const productBody = MysteryProductSchema.parse(request.body);
                const result = await addMysteryProduct(productBody);
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid request body',
                        details: error.errors,
                    });
                }
                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Failed to add product to mystery list');
                request.log.error(error, 'Failed to add product to mystery list');
                return reply.status(500).send({ status: 'error', message: 'Failed to add product to mystery list' });
            }
        })
    });

    // Fetch supplier barcode data for a product/grid-size
    app.get('/supplier-barcode', {
        preHandler: [app.requirePermission('deliveries:supplier_barcode')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const query = SupplierBarcodeFetchQuerySchema.parse(request.query);
                const result = await getSupplierBarcodeData(query);
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid request query',
                        details: error.errors,
                    });
                }
                getLogger().error({ error, params: request.params }, 'Failed to fetch supplier barcode data');
                request.log.error(error, 'Failed to fetch supplier barcode data');
                return reply.status(500).send({ status: 'error', message: 'Failed to fetch supplier barcode data' });
            }
        })
    });

    // Check whether a supplier barcode is already in use
    app.get('/supplier-barcode/check-unique', {
        preHandler: [app.requirePermission('deliveries:supplier_barcode')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const query = SupplierBarcodeUniqueQuerySchema.parse(request.query);
                const result = await checkSupplierBarcodeUnique(query);
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid request query',
                        details: error.errors,
                    });
                }
                getLogger().error({ error, params: request.params }, 'Failed to check supplier barcode uniqueness');
                request.log.error(error, 'Failed to check supplier barcode uniqueness');
                return reply.status(500).send({ status: 'error', message: 'Failed to check supplier barcode uniqueness' });
            }
        })
    });

    // Save supplier barcode
    app.post('/supplier-barcode', {
        preHandler: [app.requirePermission('deliveries:supplier_barcode')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const query = SupplierBarcodeSaveSchema.parse(request.body);
                const result = await saveSupplierBarcode(query);
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid request query',
                        details: error.errors,
                    });
                }
                getLogger().error({ error, params: request.params }, 'Failed to save supplier barcode');
                request.log.error(error, 'Failed to save supplier barcode');
                return reply.status(500).send({ status: 'error', message: 'Failed to save supplier barcode' });
            }
        })
    });

    // Check if remap is allowed for a given product/size/box
    app.get('/remap-check', {
        preHandler: [app.requirePermission('deliveries:map_products')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const query = RemapCheckQuerySchema.parse(request.query);
                const result = await checkRemapAllowed({
                    productListsId: query.productListsId,
                    sizeId: query.sizeId,
                    boxCode: query.boxCode,
                });
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid query parameters',
                        details: error.errors,
                    });
                }
                getLogger().error({ error }, 'Remap check failed');
                request.log.error(error, 'Remap check failed');
                return reply.status(500).send({ status: 'error', message: 'Remap check failed' });
            }
        })
    });

    // Remap a barcode to a new size_id
    app.post('/remap-size', {
        preHandler: [app.requirePermission('deliveries:map_products')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {


                const body = RemapSizeBodySchema.parse(request.body);
                const result = await remapSize({
                    productListsId: body.productListsId,
                    barcode: body.barcode,
                    targetSizeId: body.targetSizeId,
                    targetSizeGroupId: body.targetSizeGroupId,
                });
                return result;
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({
                        status: 'error',
                        message: 'Invalid request body',
                        details: error.errors,
                    });
                }
                if (error instanceof RemapError) {
                    const status = error.code === 'NOT_FOUND' ? 404 : 409;
                    return reply.status(status).send({
                        status: 'error',
                        message: error.message,
                        code: error.code,
                    });
                }
                getLogger().error({ error }, 'Remap size failed');
                request.log.error(error, 'Remap size failed');
                return reply.status(500).send({ status: 'error', message: 'Remap size failed' });
            }
        })
    });

    // Read-only validation of a candidate target size (inline warning source)
    app.get('/remap-validate-size', {
        preHandler: [app.requirePermission('deliveries:map_products')],
    }, async (request, reply) => {
        return runWithExecution('stock-home-grid', async () => {
            try {
                const query = RemapValidateSizeQuerySchema.parse(request.query);
                return await validateRemapSize({
                    productListsId: query.productListsId,
                    barcode: query.barcode,
                    targetSizeId: query.targetSizeId,
                });
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return reply.status(400).send({ status: 'error', message: 'Invalid query parameters', details: error.errors });
                }
                getLogger().error({ error }, 'Remap validate-size failed');
                request.log.error(error, 'Remap validate-size failed');
                return reply.status(500).send({ status: 'error', message: 'Remap validate-size failed' });
            }
        })
    });

};
