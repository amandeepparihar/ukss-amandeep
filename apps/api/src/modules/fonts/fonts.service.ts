import { prisma } from '../../lib/prisma';
import * as path from 'path';
import * as fs from 'fs';
import { saveAndExtractZip } from './utils/saveFontFile.util';
import { Prisma } from '@prisma/client';
import { ApiError, NotFoundError, ConflictError } from '../../lib/errors';

import { getLogger } from '../../lib/logger-context';

export interface FontRow {
    font_id: number;
    font_name: string;
    font_image_1: string | null;
    font_image_2: string | null;
    text_case: string | null;
    font_description: string | null;
    font_style: string | null;
    font_image_directory: string | null;
    spey_software_font_name_adult: string | null;
    spey_software_font_name_kids: string | null;
    migration_date_added: string | Date;
    migration_date_modified: string | Date;
}

export interface CreateFontInput {
    fontName: string;
    fontDescription: string;
    textCase: string;
    fontStyle: 'Straight' | 'Curve';
    fontZipFile: {
        filename: string;
        mimetype: string;
        buffer: Buffer;
    };
}

export interface UpdateFontInput {
    fontName: string;
    fontDescription: string;
    textCase: string;
    fontStyle: 'Straight' | 'Curve';
    fontZipFile?: {
        filename: string;
        mimetype: string;
        buffer: Buffer;
    };
}

export async function listAllFonts(params: {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}) {

    const logger = getLogger();

    const { page, pageSize, search, sortBy = 'fonts_id', sortOrder = 'desc' } = params;
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions
    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];

    if (search) {
        conditions.push('(f.font_name LIKE ? OR f.font_description LIKE ? OR f.spey_software_font_name_adult LIKE ?)');
        const like = `%${search}%`;
        values.push(like, like, like);
    }


    const whereClause = conditions.join(' AND ');

    // Allowed sort columns
    const allowedSorts: Record<string, string> = {
        font_id: 'f.font_id',
        font_name: 'f.font_name',
        font_style: 'f.font_style',
        migration_date_added: 'f.migration_date_added',
        migration_date_modified: 'f.migration_date_modified',
    };
    const sortColumn = allowedSorts[sortBy] || 'f.migration_date_added';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countQuery = `SELECT COUNT(*) as total FROM fonts f WHERE ${whereClause}`;
    const dataQuery = `
    SELECT f.*
    FROM fonts f
    WHERE ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT ? OFFSET ?
  `;

    try {
        const [countResult, fonts] = await Promise.all([
            prisma.$queryRawUnsafe(countQuery, ...values) as Promise<[{ total: bigint }]>,
            prisma.$queryRawUnsafe(dataQuery, ...values, pageSize, offset) as Promise<FontRow[]>,
        ]);

        const total = Number(countResult[0].total);

        logger.info({ page, pageSize, search, sortBy, sortOrder }, 'Successfully fetched fonts list');
        return {
            data: fonts.map((f: FontRow) => ({
                fontId: f.font_id,
                fontName: f.font_name,
                textCase: f.text_case,
                fontDescription: f.font_description,
                fontStyle: f.font_style,
            })),
            meta: {
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        };
    } catch (error) {
        logger.error({ err: error, page, pageSize, search, sortBy, sortOrder }, 'Failed to list fonts');
        throw new Error("Internal Server Error");
    }
}


export async function getFontById(id: number) {
    const logger = getLogger();
    const query = ` SELECT f.* FROM fonts f WHERE f.font_id = ? LIMIT 1`;
    try {
        const result = await prisma.$queryRawUnsafe(query, id) as FontRow[];
        if (!result || result.length === 0) {
            throw new NotFoundError('Font');
        }
        const f = result[0];
        logger.info({ fontId: id }, 'Successfully fetched font details');
        return {
            fontId: f.font_id,
            fontName: f.font_name,
            fontImage1: f.font_image_1,
            fontImage2: f.font_image_2,
            textCase: f.text_case,
            fontDescription: f.font_description,
            fontStyle: f.font_style,
            fontImageDirectory: f.font_image_directory,
            speySoftwareFontNameAdult: f.spey_software_font_name_adult,
            speySoftwareFontNameKids: f.spey_software_font_name_kids,
            migrationDateAdded: f.migration_date_added || null,
            migrationDateModified: f.migration_date_modified || null,
        };
    } catch (error) {
        if (error instanceof NotFoundError) {
            logger.error({ error: error, fontId: id }, `Font retrieval failed: Font with ID ${id} not found.`);
            throw error
        } else {
            logger.error({ error: error, fontId: id }, `Internal Server error while fetching font with ID ${id}:`);
            throw new Error("Internal Server Error")
        }

    }
}

const UPLOAD_ROOT = process.env.FONTS_DIR ? path.resolve(process.env.FONTS_DIR) : path.join(process.cwd(), 'fonts');
// app/fonts

export async function createFont(data: CreateFontInput) {
    const logger = getLogger();
    const folder_path = `fonts`;
    let savedDiskPath: string | null = null;
    let zipFileName: string | null = null;
    try {
        const fontCheckQuery = `SELECT font_id FROM fonts WHERE font_name = ? LIMIT 1`;
        const fontIdResult = await prisma.$queryRawUnsafe(fontCheckQuery, data.fontName.trim());
        if (fontIdResult.length > 0) {
            throw new ConflictError('Font with this name already exists');
        }

        const ZipResult = await saveAndExtractZip(data.fontZipFile.buffer, data.fontZipFile.filename, data.textCase);
        savedDiskPath = path.join(folder_path, ZipResult.extractedFolderName);
        zipFileName = ZipResult.zipFileName;

        const query = `INSERT INTO fonts (font_name,font_image_1, font_description, text_case, font_style, font_image_directory, migration_date_added, migration_date_modified    ) VALUES (?,?, ?, ?, ?, ?, NOW(), NOW())`;

        const newId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const result = await tx.$executeRawUnsafe(query, data.fontName.trim(), zipFileName, data.fontDescription || null, data.textCase.trim(), data.fontStyle, savedDiskPath);
            if (result > 0) {
                const lastIdResult = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() as id') as [{ id: bigint }];
                return Number(lastIdResult[0].id);
            }
            throw new Error('Failed to insert font row record.');
        });

        logger.info({ fontId: newId, fontName: data.fontName.trim(), diskPath: savedDiskPath }, 'Font record and assets successfully created');

        return await getFontById(newId);
    } catch (error) {
        if (savedDiskPath) {
            await Promise.all([
                fs.promises.rm(path.join(UPLOAD_ROOT, "../", savedDiskPath), { recursive: true, force: true }).catch((err) => logger.warn({ error: err, savedDiskPath: savedDiskPath }, 'Failed to rollback extracted folder')
                ),
                fs.promises.rm(path.join(UPLOAD_ROOT, "zipfiles_to_download", zipFileName), { recursive: true, force: true }).catch((err) =>
                    logger.warn({ error: err, zipFileName: zipFileName }, 'Failed to rollback zip file')
                )
            ]);
        }
        logger.error({ error: error, fontName: data.fontName }, 'Failed processing create Font operations');

        if (error instanceof ApiError) {
            throw error;
        }
        throw new Error("Failed to create font");
    }
}

export async function updateFont(id: number, data: UpdateFontInput) {
    const logger = getLogger();

    try {
        // check if font exists
        const existingFont = await getFontById(id);
        if (!existingFont) {
            throw new NotFoundError('Font');
        }

        if (existingFont.fontName.trim() != data.fontName) {
            const fontCheckQuery = `SELECT font_id FROM fonts WHERE font_name = ? LIMIT 1`;
            const fontIdResult = await prisma.$queryRawUnsafe(fontCheckQuery, data.fontName.trim());
            if (fontIdResult.length > 0) {
                throw new ConflictError('Font with this name already exists');
            }
        }
        const oldPath = existingFont.fontImageDirectory;
        const oldZipFileName = existingFont.fontImage1;

        let filename = existingFont.fontImage1;
        let savedDiskPath = oldPath;

        if (data.fontZipFile) {
            const folder_path = `fonts`;

            const ZipResult = await saveAndExtractZip(data.fontZipFile.buffer, data.fontZipFile.filename, data.textCase);

            savedDiskPath = path.join(folder_path, ZipResult.extractedFolderName);
            filename = ZipResult.zipFileName;
        }

        const query = `UPDATE fonts  SET font_name = ?,font_image_1=?, font_description = ?, text_case = ?, font_style = ?, font_image_directory = ?,migration_date_modified = NOW() WHERE font_id = ? `;

        await prisma.$executeRawUnsafe(query, data.fontName.trim(), filename, data.fontDescription, data.textCase, data.fontStyle, savedDiskPath, id);

        if (oldPath && data.fontZipFile && oldPath !== savedDiskPath) {
            logger.info({ fontId: id, oldPath: oldPath }, "Deleting old font folder and files");
            await Promise.all([
                fs.promises.rm(path.join(UPLOAD_ROOT, '../', oldPath), { recursive: true, force: true }).catch((err) => {
                    logger.warn({ error: err, oldPath: oldPath }, "Failed to delete old folder")
                }),
                fs.promises.rm(path.join(UPLOAD_ROOT, "zipfiles_to_download", oldZipFileName), { recursive: true, force: true }).catch((err) => {
                    logger.warn({ error: err, zipfile: oldZipFileName }, "Failed to delete old zip file")
                })
            ]);
        }
        logger.info({ fontID: id }, "Successfully updated font record")
        return { success: true }
    } catch (error) {
        logger.error({ error: error, fontName: data.fontName, fontId: id }, 'Failed processing updateFont operations');
        if (error instanceof ApiError) {
            throw error;
        }
        throw new Error("Failed to update font");
    }
}

export async function deleteFont(id: number) {
    const logger = getLogger();

    try {
        // check if font exists
        const existingFont = await getFontById(id);
        if (!existingFont) {
            throw new NotFoundError('Font');
        }

        const filePath = existingFont.fontImageDirectory;
        const zipFileName = existingFont.fontImage1;

        await prisma.$executeRawUnsafe('DELETE FROM fonts WHERE font_id = ?', id);
        logger.info({ fontId: id }, "Successfully Deleted font")

        if (filePath) {
            logger.info({ fontId: id }, "Deleting font files")

            await Promise.all([
                fs.promises.rm(path.join(UPLOAD_ROOT, '../', filePath), { recursive: true, force: true })
                    .catch((err) => {
                        logger.warn({ error: err, fontId: id }, "Failed to remove font fonts folder")
                    }),
                fs.promises.rm(path.join(UPLOAD_ROOT, "zipfiles_to_download", zipFileName), { recursive: true, force: true })
                    .catch((err) => {
                        logger.warn({ error: err, fontId: id }, "Failed to remove download zip file")
                    })
            ]);
            logger.info({ fontID: id }, "Successfully deleted font record")
        }
        return { status: 'Deleted' };
    } catch (error) {
        logger.error({ error: error, fontId: id }, 'Failed to delete font');
        if (error instanceof ApiError) throw error;
        throw new Error("Failed to delete font");
    }
}