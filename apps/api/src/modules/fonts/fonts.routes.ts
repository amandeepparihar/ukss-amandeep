import { listQuerySchema } from '@admin/shared';
import type { FastifyPluginAsync } from 'fastify';
import { createFont, deleteFont, getFontById, listAllFonts, updateFont } from './fonts.service';
import { createFontSchema, updateFontSchema } from './fonts.schema';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import z from 'zod';

const FONT_UPLOAD_LIMITS = {
    fileSize: 10 * 1024 * 1024, // 10 MB 
    files: 1,
    fields: 10,
};

export const fontsRoutes: FastifyPluginAsync = async (app) => {
    // Core CRUD Endpoints
    // -----------------------------------------------------------------------

    /**
     * REQ-FONT-001: Get all fonts.
     * Returns a list of all active font records for the listing view table.
     */
    app.get('/', {
        preHandler: [app.requirePermission('fonts:view')],
    }, async (request, reply) => {
        return runWithExecution('fonts', async () => {
            try {
                const query = listQuerySchema.parse(request.query);
                const result = await listAllFonts({
                    page: query.page || 1,
                    pageSize: query.pageSize || 20,
                    search: query.search || undefined,
                    sortBy: query.sortBy || 'migration_date_added',
                    sortOrder: query.sortOrder || 'desc',
                });

                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Fetch all fonts failed');

                // Return appropriate status: 400 for validation errors, 500 for sync errors
                const statusCode = error instanceof z.ZodError ? 400 : 500;
                reply.type('text/plain').status(statusCode);
                return `Fetch all fonts failed\nError: ${errorMessage}`;
            }
        })
    });

    /**
     * REQ-FONT-001: Get font by ID.
     * Fetches metadata for one specific font to populate the Edit Form.
     */
    app.get('/:id', {
        preHandler: [app.requirePermission('fonts:view')],
    }, async (request, reply) => {
        return runWithExecution('fonts', async () => {
            try {
                const { id } = request.params as { id: string };
                const numericId = Number(id);

                if (isNaN(numericId)) {
                    return reply.status(400).send({ error: 'Invalid fontId' });
                }
                const font = await getFontById(Number(id));

                if (!font) {
                    return reply.status(404).send({ error: 'Font not found' });
                }
                return { data: font };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Fetch font failed');

                // Return appropriate status: 400 for validation errors, 500 for sync errors
                const statusCode = error instanceof z.ZodError ? 400 : 500;
                ('statuscode', error instanceof z.ZodError);
                reply.type('text/plain').status(statusCode);
                return `Fetch font failed\nError: ${errorMessage}`;
            }
        })
    });

    /**
     * REQ-FONT-001: Add new font.
     * Validates payload and inserts a new font configuration record.
     */
    app.post('/', {
        preHandler: [app.requirePermission('fonts:create')],
    }, async (request, reply) => {
        return runWithExecution('fonts', async () => {
            try {
                const parts = await request.file({
                    limits: FONT_UPLOAD_LIMITS
                });
                if (!parts) {
                    return reply.status(400).send({ error: 'No form payload data received.' });
                }

                const rawBody = {
                    fontName: (parts.fields.fontName as any)?.value,
                    fontDescription: (parts.fields.fontDescription as any)?.value,
                    textCase: (parts.fields.textCase as any)?.value,
                    fontStyle: (parts.fields.fontStyle as any)?.value,
                    fontZipFile: {
                        filename: parts.filename,
                        mimetype: parts.mimetype,
                        buffer: await parts.toBuffer(),
                    },
                };

                const fontData = createFontSchema.parse(rawBody);
                const newFont = await createFont(fontData);
                return reply.status(201).send({ data: newFont });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Failed to create font');

                // Return appropriate status: 400 for validation errors, 500 for sync errors
                const statusCode = error instanceof z.ZodError ? 400 : 500;
                reply.type('text/plain').status(statusCode);
                return `Failed to create font \nError: ${errorMessage}`;
            }
        })
    });

    /**
     * REQ-FONT-001: Update font by ID.
     * Modifies existing font configuration details via the Edit Form submit action.
     */
    app.put('/:id', {
        preHandler: [app.requirePermission('fonts:edit')]
    }, async (request, reply) => {
        return runWithExecution('fonts', async () => {
            try {
                const { id } = request.params as { id: string };
                const numericId = Number(id);
                if (isNaN(numericId)) {

                    return reply.status(400).send({
                        error: 'Invalid font ID format'
                    });
                }
                const parts = request.parts({
                    limits: FONT_UPLOAD_LIMITS
                });

                const rawBody: any = {};

                for await (const part of parts) {
                    if (part.type === 'file') {
                        if (!part.filename) {
                            await part.toBuffer();
                            continue;
                        }
                        rawBody.fontZipFile = {
                            filename: part.filename,
                            mimetype: part.mimetype,
                            buffer: await part.toBuffer(),
                        };
                    } else {
                        rawBody[part.fieldname] = part.value;
                    }
                }

                const fontData =
                    updateFontSchema.parse(rawBody);

                await updateFont(numericId, fontData);

                return { data: { success: true } };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Update font failed');

                // Return appropriate status: 400 for validation errors, 500 for sync errors
                const statusCode = error instanceof z.ZodError ? 400 : 500;
                reply.type('text/plain').status(statusCode);
                return `Update font failed\nError: ${errorMessage}`;
            }
        })

    });

    /**
     * REQ-FONT-002: Delete font by ID .
     */
    app.delete('/:id', {
        preHandler: [app.requirePermission('fonts:delete')],
    }, async (request,reply) => {
        return runWithExecution('fonts', async () => {
            try {
                const { id } = request.params as { id: string };
                const numericId = Number(id);

                if (isNaN(numericId)) {
                    throw new Error('Invalid font ID');
                }
                await deleteFont(numericId);

                return { success: true, message: 'Deleted Successfully' };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Log ALL errors (including validation) with executionId from context
                getLogger().error({ error, params: request.params }, 'Delete font failed');

                // Return appropriate status: 400 for validation errors, 500 for sync errors
                const statusCode = error instanceof z.ZodError ? 400 : 500;
                reply.type('text/plain').status(statusCode);
                return `Delete font failed\nError: ${errorMessage}`;
            }
        })
    });
};