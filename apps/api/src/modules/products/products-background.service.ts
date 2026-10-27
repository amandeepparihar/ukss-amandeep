/**
 * Background Removal Service
 *
 * Click-time background removal via the remove.bg API. Called from
 * POST /api/products/remove-background — the route returns the processed
 * PNG as a base64 data URI, the frontend shows a before/after dialog,
 * and on accept the image URL is swapped to the data URI which
 * saveProductDetails persists as a .png file.
 */

import FormData from 'form-data';
import axios from 'axios';
import sharp from 'sharp';
import { config } from '../../config';
import { ApiError } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { downloadImage } from '../../lib/utils/image-download';
import { nanoid } from 'nanoid';
import { runDifyWorkflow, DifyError } from '../../lib/dify';

const defaultLogger = createLogger('products-background');

export interface RemoveBackgroundFromUrlResult {
  bgRemovedUrl: string;
  elapsedMs: number;
}

async function removeBgViaDify(imageUrl: string): Promise<RemoveBackgroundFromUrlResult> {
  if (!config.DIFY_REMOVE_BG_API_KEY) {
    throw new ApiError(400, 'DIFY_NOT_CONFIGURED', 'Dify remove-bg is not configured (set DIFY_REMOVE_BG_API_KEY)');
  }
  const log = defaultLogger.child({ imageUrl, via: 'dify' });
  log.info('Calling Dify remove-bg workflow');
  try {
    const res = await runDifyWorkflow<{ bgRemovedUrl?: string; elapsedMs?: number }>(
      config.DIFY_REMOVE_BG_API_KEY,
      { imageUrl },
      'stock2-backend',
    );
    const out = res.data.outputs;
    if (!out?.bgRemovedUrl) {
      throw new ApiError(502, 'DIFY_INVALID_OUTPUT', 'Dify remove-bg returned no bgRemovedUrl');
    }
    // Dify's bg-removed URL is temporary — return the bytes as a data URI (like remove.bg) so later re-saves don't hit an expired URL.
    const pngBuffer = await downloadImage(out.bgRemovedUrl);
    const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    log.info({ elapsedMs: out.elapsedMs ?? 0, pngBytes: pngBuffer.length }, 'Dify remove-bg succeeded');
    return { bgRemovedUrl: dataUri, elapsedMs: out.elapsedMs ?? 0 };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DifyError) {
      // Only forward upstream 5xx. Clamp 4xx to 502 so Dify auth/rate-limit
      // errors don't trigger the frontend's 401 session-expiry interceptor.
      const status = err.statusCode >= 500 ? err.statusCode : 502;
      throw new ApiError(status, 'DIFY_WORKFLOW_FAILED', err.message);
    }
    throw err;
  }
}

/**
 * Click-time background removal: download a source URL, call remove.bg, and
 * return the result as a base64 data URI. Mirrors the enhanceImage pattern —
 * the caller (frontend) shows a before/after dialog and, on accept, swaps the
 * image URL to this data URI. saveProductDetails then persists the PNG bytes.
 *
 * @param imageUrl - Source image URL (any reachable HTTP(S) URL)
 * @returns data URI of the processed PNG and the elapsed time
 */
export async function removeBackgroundFromUrl(
  imageUrl: string,
): Promise<RemoveBackgroundFromUrlResult> {
  const executionId = nanoid(10);
  const log = defaultLogger.child({ executionId, imageUrl });
  const startedAt = Date.now();

  if (config.DIFY_STUB_MODE) {
    defaultLogger.info({ imageUrl }, 'DIFY_STUB_MODE enabled, returning source URL as bgRemovedUrl');
    return { bgRemovedUrl: imageUrl, elapsedMs: 0 };
  }

  // Background removal is gated by its own flag (default false) rather than the
  // global USE_DIFY_FOR_IMAGES. This lets remove-bg fall back to the direct
  // remove.bg API while enhance/upscale/edits keep running on Dify. Flip
  // USE_DIFY_FOR_REMOVE_BG=true to route background removal back through Dify.
  if (config.USE_DIFY_FOR_REMOVE_BG) {
    return removeBgViaDify(imageUrl);
  }

  if (!config.REMOVE_BG_API_KEY) {
    throw new ApiError(
      400,
      'REMOVE_BG_NOT_CONFIGURED',
      'Background removal is not configured (set REMOVE_BG_API_KEY)',
    );
  }

  log.info('Downloading and resizing source image');
  const sourceBuffer = await downloadImage(imageUrl);
  const resizedBuffer = await sharp(sourceBuffer)
    .resize(1080, 1080, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  log.info(
    { sourceBytes: sourceBuffer.length, resizedBytes: resizedBuffer.length, size: config.REMOVE_BG_SIZE },
    'Calling remove.bg API',
  );

  const formData = new FormData();
  formData.append('image_file', resizedBuffer, {
    filename: 'image.jpg',
    contentType: 'image/jpeg',
  });
  formData.append('size', config.REMOVE_BG_SIZE || 'full');
  formData.append('type', 'auto');
  formData.append('format', 'png');

  try {
    const response = await axios.post(config.REMOVE_BG_API_URL, formData, {
      headers: {
        'X-Api-Key': config.REMOVE_BG_API_KEY,
        ...formData.getHeaders(),
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    const png = Buffer.from(response.data);
    const elapsedMs = Date.now() - startedAt;
    log.info({ pngBytes: png.length, elapsedMs }, 'Background removed successfully');

    return {
      bgRemovedUrl: `data:image/png;base64,${png.toString('base64')}`,
      elapsedMs,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.data) {
        try {
          const errorData = JSON.parse(Buffer.from(error.response.data).toString());
          const title = errorData?.errors?.[0]?.title;
          if (title) {
            log.error({ title, statusCode: error.response.status }, 'remove.bg API error');
            throw new ApiError(error.response.status, 'REMOVE_BG_ERROR', title);
          }
        } catch (parseErr) {
          if (parseErr instanceof ApiError) throw parseErr;
        }
      }
      log.error({ message: error.message, code: error.code }, 'remove.bg network error');
      throw new ApiError(502, 'REMOVE_BG_ERROR', `Background removal failed: ${error.message}`);
    }
    throw error;
  }
}

