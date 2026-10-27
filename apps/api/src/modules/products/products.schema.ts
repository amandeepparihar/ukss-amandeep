/**
 * New Product Module — Zod validation schemas.
 * Requirements: REQ-1, REQ-2, REQ-3, REQ-6
 */

import { z } from 'zod';
// PMS #166509: one copy of the HS Code shape rule, shared with the service that
// writes it, so what the form accepts cannot drift from what the column holds.
import { sanitiseHsCode } from './origin-details.service';

// ---------------------------------------------------------------------------
// Shared validation patterns
// ---------------------------------------------------------------------------

/** REQ-1.8: Reject special characters in product codes */
const PRODUCT_CODE_FORBIDDEN = /['^£$%&*()}{@#~?><>,|=+¬]/;

// ---------------------------------------------------------------------------
// Product code schema (REQ-1, REQ-2)
// ---------------------------------------------------------------------------

export const productCodeSchema = z
  .object({
    productCode: z
      .string()
      .trim()
      .min(1, 'Product code is required')
      .max(100, 'Product code must be 100 characters or less')
      .refine((v) => !PRODUCT_CODE_FORBIDDEN.test(v), {
        message: 'Product code contains invalid special characters',
      }),
    productName: z.string().trim().min(1, 'Product name is required').max(255),
    teamName: z.string().trim().min(1, 'Team is required').max(100),
    season: z.string().trim().min(1, 'Season is required').max(50),
    price: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.coerce.number().min(0, 'Price must be non-negative').default(0),
    ),
    productTypeId: z.coerce.number().int().positive('Product type is required'),
    manufacturerName: z.string().trim().max(100).optional(),
    frontImage: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    backImage: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    additionalImage: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    // Persisted to product_lists.allows_personalisation. Default false.
    allowsPersonalisation: z.coerce.boolean().optional().default(false),
    // product_lists.country_of_origin_id (FK to countries). Optional.
    countryOfOriginId: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    // product_lists.hs_code — the commodity code the goods are declared under
    // (PMS #166509). Free text, not an FK: there is no master list of commodity
    // codes in the system and suppliers send them as-is. Separators the operator
    // types are stripped here, so 9505.10.00 and 9505 10 00 both store as
    // 95051000 and the column only ever holds digits. sanitiseHsCode() is the
    // one copy of that rule, shared with origin-details.service.ts.
    hsCode: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z
        .string()
        .trim()
        .transform((v) => sanitiseHsCode(v))
        .refine((v): v is string => v !== null, {
          message: 'HS Code must be 6 to 10 digits',
        })
        .optional(),
    ),
  });

export type ProductCodeSchemaInput = z.infer<typeof productCodeSchema>;

// ---------------------------------------------------------------------------
// Inventory entry schema (REQ-3)
// ---------------------------------------------------------------------------

const inventoryEntryRowSchema = z.object({
  boxCode: z.string().trim().min(1, 'Box code is required').max(50),
  quantity: z.coerce.number().int().nonnegative('Quantity cannot be negative'),
  action: z.enum(['add', 'subtract']),
});

export const inventoryEntrySchema = z
  .object({
    productListsId: z.coerce.number().int().positive(),
    // Legacy SMS caps barcodes at 13 chars (product_quantities_controller.php
    // line 477). Stock2 must match that contract or barcodes saved here will
    // diverge from what the rest of the system expects.
    barcode: z.string().trim().min(1, 'Barcode is required').max(13, 'Barcode must be 13 characters or less'),
    // Cascade context — all three required so the service can verify the
    // submitted size really belongs to the chosen group + option pair.
    // Without this, a stale-state UI (or a hand-crafted request) can store
    // a size_id from a completely different size group.
    sizeOptionId: z.coerce.number().int().positive('Size option is required'),
    sizeGroupId: z.coerce.number().int().positive('Size group is required'),
    sizeId: z.coerce.number().int().positive('Size is required'),
    // Weight is mandatory in Stock2 (stricter than legacy, which only warned).
    weight: z.coerce.number().positive('Weight is required and must be greater than 0'),
    entries: z.array(inventoryEntryRowSchema).min(1, 'At least one box entry is required'),
  })
  .superRefine((data, ctx) => {
    // REQ-3.10: Reject duplicate box codes in same submission
    const boxCodes = data.entries.map((e) => e.boxCode.toLowerCase());
    const seen = new Set<string>();
    for (let i = 0; i < boxCodes.length; i++) {
      if (seen.has(boxCodes[i])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate box code: ${data.entries[i].boxCode}`,
          path: ['entries', i, 'boxCode'],
        });
      }
      seen.add(boxCodes[i]);
    }
  });

export type InventoryEntrySchemaInput = z.infer<typeof inventoryEntrySchema>;

export const inventoryUpdateSchema = z.object({
  quantity: z.coerce.number().int('Quantity must be a whole number'),
  weight: z.coerce.number().min(0, 'Weight must be non-negative').default(0),
});

// ---------------------------------------------------------------------------
// Lookup query schemas (REQ-6)
// ---------------------------------------------------------------------------

export const teamSearchSchema = z.object({
  search: z.string().trim().max(100).optional(),
});

export const sizeGroupQuerySchema = z.object({
  optionId: z.coerce.number().int().positive('Size option is required'),
});

export const sizesQuerySchema = z.object({
  groupId: z.coerce.number().int().positive('Size group is required'),
});

// Used by the cascade UI to refuse a size group that conflicts with whatever
// group is already attached to this product's existing inventory. Mirrors
// legacy product_quantities_controller.php::get_mapped_sizes_to_size_groups.
export const checkSizeGroupSchema = z.object({
  productListsId: z.coerce.number().int().positive(),
  sizeGroupId: z.coerce.number().int().positive(),
});

export const boxSearchSchema = z.object({
  search: z.string().trim().max(50).optional(),
});

export const barcodeCheckSchema = z.object({
  barcode: z.string().trim().min(1, 'Barcode is required').max(50),
});

export const productCodeCheckSchema = z.object({
  code: z.string().trim().min(1, 'Product code is required').max(100),
});

// ---------------------------------------------------------------------------
// Origin details family conflict check (PMS #166509)
// ---------------------------------------------------------------------------

/**
 * Body of POST /api/products/origin-conflicts. Either field may be blank —
 * a blank field is one that is not being changed and raises no conflict — but at
 * least one of the two has to be there, otherwise there is nothing to ask about.
 *
 * The HS Code is NOT put through sanitiseHsCode() here on purpose: this endpoint
 * only reads, and a half-typed code should come back "no conflicts" and be
 * refused by the save with a proper message, rather than 400ing the conflict
 * check while the operator is still typing.
 */
export const originConflictsSchema = z
  .object({
    productCode: z.string().trim().min(1, 'Product code is required').max(100),
    countryOfOriginId: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    hsCode: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.string().trim().max(50).optional(),
    ),
  })
  .refine((d) => d.countryOfOriginId !== undefined || d.hsCode !== undefined, {
    message: 'Either the country of origin or the HS Code is required',
  });

// ---------------------------------------------------------------------------
// Duplicate detection schema (Product Automation Improvement)
// ---------------------------------------------------------------------------

export const checkDuplicatesSchema = z.object({
  teamName: z.string().trim().max(100).default(''),
  season: z.string().trim().max(50).default(''),
  productTypeId: z.coerce.number().int().positive('Product type is required'),
  ageGroup: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  gender: z.string().trim().max(100).optional(),
  manufacturerName: z.string().trim().max(100).optional(),
  productName: z.string().trim().max(255).optional(),
  excludeProductCode: z.string().trim().max(100).optional(),
});

export type CheckDuplicatesSchemaInput = z.infer<typeof checkDuplicatesSchema>;

// ---------------------------------------------------------------------------
// Dify AI workflow schemas (Step 3 Images, Step 4 Description)
// ---------------------------------------------------------------------------

/** Convert blank strings to undefined so Dify falls back to its own defaults */
const optionalString = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const generateImagesSchema = z.object({
  productName: z.string().trim().min(1, 'Product name is required').max(255),
  productCode: z.string().trim().min(1, 'Product code is required').max(100),
  team: optionalString,
  season: optionalString,
  manufacturerName: optionalString,
  numberOfKeywords: z.coerce.number().int().min(1).max(20).default(3),
  numberOfResults: z.coerce.number().int().min(1).max(20).default(10),
  enhancementPrompt: optionalString,
  excludeUrls: z.array(z.string().url()).max(200).default([]),
});

export const generateDescriptionSchema = z.object({
  productName: z.string().trim().min(1, 'Product name is required').max(255),
  productCode: z.string().trim().min(1, 'Product code is required').max(100),
  brand: optionalString,
  teamName: optionalString,
  season: optionalString,
  category: optionalString,
  sport: optionalString,
  gender: optionalString,
  color: optionalString,
  material: optionalString,
  league: optionalString,
  targetMarket: optionalString,
  tone: optionalString,
  language: optionalString,
  seoKeywords: optionalString,
  price: z.coerce.number().min(0).optional(),
  // Image refs forwarded to the vision-enabled GENERATE DESCRIPTION node.
  // Each ref is either a remote URL (gallery / paste) or a Dify upload-file-id
  // (returned by POST /products/dify/upload-image). Capped at 5 to match the
  // Dify workflow's `file-list` variable limit.
  images: z
    .array(
      z.union([
        z.object({ url: z.string().url() }),
        z.object({ uploadFileId: z.string().min(1) }),
      ]),
    )
    .max(5)
    .optional(),
  enhancementPrompt: optionalString,
  // Mirrors product_lists.allows_personalisation; gates the description LLM's
  // personalisation/legends paragraph. Workflow forces it to "no" when teamName
  // is empty, so we don't validate that interaction here.
  addLegends: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Save Details schema (Images + Description save)
// ---------------------------------------------------------------------------

export const saveDetailsSchema = z.object({
  productListsId: z.coerce.number().int().positive(),
  productCode: z.string().trim().min(1).max(100),
  // NOTE: .url() below uses `new URL()`, which accepts `data:` schemes — so the
  // bg-removal AND manual-crop flows (which send `data:image/...` URIs here)
  // validate fine. Do NOT "tighten" these to reject data URIs: it would break
  // both flows. The manual-crop-specific fields below are plain z.string() for
  // the same reason (belt-and-braces).
  primaryImageUrl: z.string().url().nullable(),
  backImageUrl: z.string().url().nullable().default(null),
  additionalImageUrls: z.array(z.string().url()).default([]),
  descriptionNotes: z.string().max(10000).default(''),
  productAttributes: z.record(z.string(), z.string()).default({}),
  // Background removal flags
  removeBackgroundForPrimary: z.boolean().default(false),
  removeBackgroundForBack: z.boolean().default(false),
  removeBackgroundImageUrls: z.array(z.string().url()).default([]), // Additional image URLs marked for bg removal
  // Manual crop flags — cropped images are `data:` URIs (server did the pixel
  // work), so these are plain strings, NOT .url()-typed.
  manualCropForPrimary: z.boolean().default(false),
  manualCropForBack: z.boolean().default(false),
  manualCropImageUrls: z.array(z.string()).default([]), // additional cropped data URIs
  // Maps each cropped data URI → its pre-crop source URL (http or data URI),
  // so the backend can persist the un-cropped original for later re-crops.
  manualCropOriginals: z.record(z.string(), z.string()).default({}),
  // URLs of every image the user uploaded via POST /upload-image during this
  // wizard session. After save, unselected uploads are pruned from disk.
  uploadedImageUrls: z.array(z.string().url()).max(50).default([]),
});

export type SaveDetailsSchemaInput = z.infer<typeof saveDetailsSchema>;

// ---------------------------------------------------------------------------
// Replicate per-image enhance schema
// ---------------------------------------------------------------------------

export const enhanceImageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('quality'),
    imageUrl: z.string().url('Must be a valid URL'),
  }),
  z.object({
    type: z.literal('edit'),
    imageUrl: z.string().url('Must be a valid URL'),
    prompt: z.string().trim().min(3, 'Prompt must be at least 3 characters').max(500),
  }),
]);
export type EnhanceImageInput = z.infer<typeof enhanceImageSchema>;

// ---------------------------------------------------------------------------
// Remove-background per-image schema (instant click-time bg removal)
// ---------------------------------------------------------------------------

export const removeBackgroundSchema = z.object({
  imageUrl: z.string().url('Must be a valid URL'),
});

// ---------------------------------------------------------------------------
// Manual crop schemas (see spec §3, §4)
// ---------------------------------------------------------------------------

export const cropImageSchema = z.object({
  // http(s) URL or data URI (bg-removed / re-crop sources are data:image/...).
  // Plain string — data URIs are not valid `.url()` inputs in every zod path.
  imageUrl: z.string().min(1),
  // Crop rectangle in NATURAL pixel coordinates of the source image
  // (react-easy-crop's croppedAreaPixels). Must be square; the server also
  // clamps against the real image bounds before extracting.
  crop: z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    })
    .refine((c) => c.width === c.height, { message: 'Crop must be square' }),
});

export type CropImageSchemaInput = z.infer<typeof cropImageSchema>;

// GET /crop-source?imageUrl=... — resolves a saved CDN URL to its persisted
// original (for full-resolution re-crops). imageUrl is a saved CDN URL.
export const cropSourceSchema = z.object({
  imageUrl: z.string().min(1),
});
