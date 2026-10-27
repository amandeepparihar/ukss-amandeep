/**
 * New Product Module — Replicate per-image enhancement.
 *
 * Wraps the generic Replicate client (lib/replicate.ts) with two product-specific
 * paths:
 *   - quality: nightmareai/real-esrgan upscale (4x).
 *   - edit:    google/nano-banana image edit guided by a text prompt.
 *
 * Both share the same download → 1080-cap resize → base64 data URI pipeline so
 * we stay under Replicate's GPU input cap regardless of source size.
 */

import { config } from '../../config';
import { runReplicateModel, ReplicateError } from '../../lib/replicate';
import { runDifyWorkflow, DifyError } from '../../lib/dify';
import { ApiError } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { downloadImage, compressImage } from './products-image.service';
import type { EnhanceImageInput } from './products.schema';

const logger = createLogger('products-replicate');

const REAL_ESRGAN_MODEL =
  'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';

// Official Replicate model — version rotates upstream, so we use the
// /v1/models/<owner>/<name>/predictions endpoint (no pinned hash). See
// runReplicateModel() in lib/replicate.ts for how the unpinned ref is handled.
const NANO_BANANA_MODEL = 'google/nano-banana';

interface RealEsrganInput {
  image: string;
  scale: number;
  face_enhance: boolean;
}

interface NanoBananaInput {
  prompt: string;
  image_input: string[];
}

export interface EnhanceImageResult {
  enhancedUrl: string;
  elapsedMs: number;
}

/**
 * Build the 1080-capped JPEG data URI we send to Replicate. Web-scraped product
 * photos are often >2 MP and trip Replicate's GPU memory cap when sent direct.
 */
async function buildDataUri(imageUrl: string): Promise<{ dataUri: string; sourceBytes: number; resizedBytes: number }> {
  const sourceBuffer = await downloadImage(imageUrl);
  const resizedBuffer = await compressImage(sourceBuffer);
  return {
    dataUri: `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`,
    sourceBytes: sourceBuffer.length,
    resizedBytes: resizedBuffer.length,
  };
}

async function enhanceImageQuality(imageUrl: string): Promise<EnhanceImageResult> {
  const log = logger.child({ imageUrl, mode: 'quality' });

  log.info('Downloading and pre-resizing image to 1080x1080');
  const { dataUri, sourceBytes, resizedBytes } = await buildDataUri(imageUrl);

  log.info({ sourceBytes, resizedBytes }, 'Calling Replicate real-esrgan');

  const { output, predictionId, elapsedMs } = await runReplicateModel<RealEsrganInput, string>(
    REAL_ESRGAN_MODEL,
    { image: dataUri, scale: 4, face_enhance: false },
  );

  if (typeof output !== 'string' || !output) {
    throw new ApiError(500, 'REPLICATE_INVALID_OUTPUT', 'Replicate returned an unexpected output shape');
  }

  log.info({ predictionId, elapsedMs }, 'Replicate quality enhance succeeded');
  return { enhancedUrl: output, elapsedMs };
}

async function editImage(imageUrl: string, prompt: string): Promise<EnhanceImageResult> {
  const log = logger.child({ imageUrl, mode: 'edit' });

  log.info('Downloading and pre-resizing image to 1080x1080');
  const { dataUri, sourceBytes, resizedBytes } = await buildDataUri(imageUrl);

  log.info({ sourceBytes, resizedBytes, promptLen: prompt.length }, 'Calling Replicate google/nano-banana');

  // Nano Banana sometimes returns a single URL string and sometimes an array of
  // URLs depending on how many variants the model produced. Handle both.
  const { output, predictionId, elapsedMs } = await runReplicateModel<
    NanoBananaInput,
    string | string[]
  >(NANO_BANANA_MODEL, { prompt, image_input: [dataUri] });

  const enhancedUrl = Array.isArray(output) ? output[0] : output;
  if (typeof enhancedUrl !== 'string' || !enhancedUrl) {
    throw new ApiError(500, 'REPLICATE_INVALID_OUTPUT', 'Nano Banana returned an unexpected output shape');
  }

  log.info({ predictionId, elapsedMs }, 'Replicate nano-banana edit succeeded');
  return { enhancedUrl, elapsedMs };
}

async function enhanceViaDify(input: EnhanceImageInput): Promise<EnhanceImageResult> {
  if (!config.DIFY_ENHANCE_API_KEY) {
    throw new ApiError(400, 'DIFY_NOT_CONFIGURED', 'Dify enhance is not configured (set DIFY_ENHANCE_API_KEY)');
  }
  const log = logger.child({ imageUrl: input.imageUrl, mode: input.type, via: 'dify' });
  log.info('Calling Dify enhance workflow');
  try {
    const res = await runDifyWorkflow<{ enhancedUrl?: string; elapsedMs?: number }>(
      config.DIFY_ENHANCE_API_KEY,
      {
        type: input.type,
        imageUrl: input.imageUrl,
        prompt: input.type === 'edit' ? input.prompt : undefined,
      },
      'stock2-backend',
    );
    const out = res.data.outputs;
    if (!out?.enhancedUrl) {
      throw new ApiError(502, 'DIFY_INVALID_OUTPUT', 'Dify enhance returned no enhancedUrl');
    }
    log.info({ elapsedMs: out.elapsedMs ?? 0 }, 'Dify enhance succeeded');
    return { enhancedUrl: out.enhancedUrl, elapsedMs: out.elapsedMs ?? 0 };
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
 * Dispatch an enhancement request based on `type`. Stub mode short-circuits
 * both modes to the original URL so dev environments don't burn Replicate
 * credits.
 */
export async function enhanceImage(input: EnhanceImageInput): Promise<EnhanceImageResult> {
  if (config.REPLICATE_STUB_MODE) {
    logger.info({ type: input.type, imageUrl: input.imageUrl }, 'REPLICATE_STUB_MODE enabled, returning original image URL');
    return { enhancedUrl: input.imageUrl, elapsedMs: 0 };
  }

  if (config.DIFY_STUB_MODE) {
    logger.info({ type: input.type, imageUrl: input.imageUrl }, 'DIFY_STUB_MODE enabled, returning original image URL');
    return { enhancedUrl: input.imageUrl, elapsedMs: 0 };
  }

  if (config.USE_DIFY_FOR_IMAGES) {
    return enhanceViaDify(input);
  }

  if (!config.REPLICATE_API_TOKEN) {
    throw new ApiError(
      400,
      'REPLICATE_NOT_CONFIGURED',
      'Replicate is not configured (set REPLICATE_API_TOKEN)',
    );
  }

  try {
    if (input.type === 'quality') {
      return await enhanceImageQuality(input.imageUrl);
    }
    return await editImage(input.imageUrl, input.prompt);
  } catch (err) {
    if (err instanceof ReplicateError) {
      throw new ApiError(err.statusCode, 'REPLICATE_ERROR', err.message);
    }
    throw err;
  }
}
