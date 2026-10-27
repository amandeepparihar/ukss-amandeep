import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { getLogger } from '../../../lib/logger-context';
import { ApiError, BadRequestError } from '../../../lib/errors';


const UPLOAD_ROOT = process.env.FONTS_DIR ? path.resolve(process.env.FONTS_DIR) : path.join(process.cwd(), 'fonts');

export async function saveAndExtractZip(fileBuffer: Buffer, originalFilename: string, textCase: string) {
    const logger = getLogger();

    if (!fileBuffer || fileBuffer.length === 0) {
        throw new BadRequestError('Uploaded ZIP file is empty');
    }
    const extension = path.extname(originalFilename).toLowerCase();
    if (extension !== '.zip') {
        throw new BadRequestError('Only ZIP files are allowed');
    }
    const fileName = path.basename(originalFilename, extension);

    const safeFileName = fileName.trim().toLowerCase().replace(/[^a-zA-Z0-9]+/g, '-');
    const uniqueFolderName = `${safeFileName}-${Date.now()}`;
    const uniqueZipFileName = `${uniqueFolderName}${extension}`

    const extractedFolderPath = path.join(UPLOAD_ROOT, uniqueFolderName);
    const zipFileDirectory = path.join(UPLOAD_ROOT, 'zipfiles_to_download');
    const zipFilePath = path.join(zipFileDirectory, uniqueZipFileName);

    try {
        await fs.promises.mkdir(zipFileDirectory, { recursive: true });
        // Save zip
        await fs.promises.writeFile(zipFilePath, fileBuffer);

        // Extract zip
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractedFolderPath, true);

        // Validate font files
        const extractedItems = await fs.promises.readdir(
            extractedFolderPath,
            {
                withFileTypes: true
            }
        );

        const folders = extractedItems.filter(
            (item) => item.isDirectory()
        );

        if (folders.length !== 1) {
            throw new BadRequestError(
                'ZIP must contain exactly one folder'
            );
        }
        const extractedFolder = folders[0];

        const folderName = extractedFolder.name;
        const isUpperCaseFolder = folderName.endsWith('uppercase');
        const isLowerCaseFolder = folderName.endsWith('lowercase');

        if (textCase === 'Upper' && !isUpperCaseFolder) {
            throw new BadRequestError('Folder Structure is not matching with text case.');
        }

        if (textCase === 'Lower' && !isLowerCaseFolder) {
            throw new BadRequestError('Folder Structure is not matching with text case');
        }

        const characterFolderPath = path.join(extractedFolderPath, folderName);
        const characterFiles = await fs.promises.readdir(characterFolderPath);

        for (const fileName of characterFiles) {
            if (!fileName.startsWith('_')) {
                continue;
            }
            const oldPath = path.join(
                characterFolderPath,
                fileName
            );

            const newFileName = fileName.substring(1);
            const newPath = path.join(
                characterFolderPath,
                newFileName
            );

            await fs.promises.rename(oldPath, newPath);
        }
        const finalFiles = await fs.promises.readdir(characterFolderPath);
        if (finalFiles.length <= 28) {
            throw new BadRequestError('Seems, Few letter images are missing!');
        }

        return {
            zipFileName: uniqueZipFileName,
            extractedFolderName: uniqueFolderName,
            extractedPath: characterFolderPath
        };

    } catch (error) {
        await Promise.all([
            fs.promises.rm(extractedFolderPath, { recursive: true, force: true }).catch(() => { }),
            fs.promises.rm(zipFilePath, { force: true }).catch(() => { })
        ]);
        logger.error({ error: error }, "Error occurred while saving zip file")
        if (error instanceof ApiError) {
            throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        throw new Error(errorMessage);
    }
}
