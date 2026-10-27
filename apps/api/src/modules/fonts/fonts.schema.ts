import { z } from 'zod';

// ─── Fonts Schemas ────────────────────────────────────

const ALLOWED_ZIP_MIME_TYPES = [
    'application/zip',
    'application/x-zip-compressed',
];

const zipFileSchema = z
    .custom<any>((val) => {

        if (!val) return false;

        return (
            typeof val === 'object' &&
            (
                'file' in val ||
                'buffer' in val ||
                'filename' in val
            )
        );

    }, {
        message:
            'A valid font ZIP file upload is required',
    })
    .refine((file) => {

        if (!file?.filename) {
            return false;
        }
        return file.filename
            .toLowerCase()
            .endsWith('.zip');
    }, {
        message:
            'Only .zip compressed archives are accepted'
    }).refine((file) => {

        if (!file?.mimetype) {
            return false;
        }

        return ALLOWED_ZIP_MIME_TYPES.includes(
            file.mimetype
        );

    }, {
        message: 'Invalid ZIP file mimetype',
    });

export const textCase = z.enum([
    'Upper', 'Lower',
]);
export const fontStyle = z.enum([
    'Curve', 'Straight',
]);

export const createFontSchema = z.object({
    fontName: z.string().trim().min(1, 'Font name is required').max(255),
    fontDescription: z.string().trim().min(1, 'Font Description is required').max(1000),
    fontZipFile: zipFileSchema,
    textCase: textCase,
    fontStyle: fontStyle,

});

export const updateFontSchema = z.object({
    fontName: z.string().trim().min(1, 'Font name is required'),
    fontDescription: z.string().trim().min(1, 'Font Description is required').max(1000),
    textCase:textCase,
    fontStyle: fontStyle,
    fontZipFile: zipFileSchema.optional(),
});
