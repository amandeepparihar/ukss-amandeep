/**
 * New Product Module — Dify AI workflow integrations.
 * Wraps the generic Dify client (lib/dify.ts) with two product-specific calls:
 *   1. generateImages       → Step 3 (Images)
 *   2. generateDescription  → Step 4 (Description & Attributes)
 *
 * Both workflows are configured in Dify; we only forward inputs and return
 * the raw `outputs` payload so the frontend can map fields without the API
 * needing to know the workflow's internal output shape.
 */

import { config } from '../../config';
import { runDifyWorkflow, DifyError, toDifyImageFileList } from '../../lib/dify';
import { ApiError } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import type {
  GenerateImagesInput,
  GenerateDescriptionInput,
  DifyImagesResult,
  DifyDescriptionResult,
} from './products.types';

const logger = createLogger('products-dify');

// ---------------------------------------------------------------------------
// Development stubs (used when DIFY_STUB_MODE=true)
// ---------------------------------------------------------------------------

const STUB_IMAGES_OUTPUTS: Record<string, unknown> = {
  text: '```json\n' + JSON.stringify([
    {
      rank: 1,
      title: '2025-2026 Poland Away Concept Football Shirt (Milik 7 ...)',
      imageUrl: 'https://cdn1.uksoccershop.com/images/adtnl_prodts_img/1525696422-polandairobackaway.jpg',
      imageUrl_fallback: 'https://cdn1.uksoccershop.com/images/adtnl_prodts_img/1525696422-polandairobackaway.jpg',
      thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQJ5jmG0-DaxEdpR0LWPhTmpd2_iVoG7uLLcw&s',
      source: 'UKSoccerShop.com',
      link: 'https://www.uksoccershop.com/p-110341/2018-2019-poland-away-concept-football-shirt.html',
      trusted: false,
      upgraded: false,
    },
    {
      rank: 2,
      title: '2025-2026 Poland Away Concept Football Shirt (Milik 7 ...)',
      imageUrl: 'https://i.ebayimg.com/images/g/gygAAOSwZvdg39AA/s-l500.jpg',
      imageUrl_fallback: 'https://i.ebayimg.com/images/g/gygAAOSwZvdg39AA/s-l500.jpg',
      thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRE1fMozXDneiE6eT_IeXJJfwghszX0swFOjQ&s',
      source: 'eBay UK',
      link: 'https://www.ebay.co.uk/itm/157462565090',
      trusted: false,
      upgraded: false,
    },
    {
      rank: 3,
      title: '2020-21 Poland Away Shirt (M)',
      imageUrl: 'https://www.classicfootballshirts.co.uk/cdn-cgi/image/fit=pad,q=70,f=webp//pub/media/catalog/product//1/1/11122371528-99_uxmvrlvdooi2qo6b.jpg',
      imageUrl_fallback: 'https://www.classicfootballshirts.co.uk/cdn-cgi/image/fit=pad,q=70,f=webp//pub/media/catalog/product//1/1/11122371528-99_uxmvrlvdooi2qo6b.jpg',
      thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSx0dJ5Ye_ZSUYv9fDmqcHVjN3FNz8AqMncOA&s',
      source: 'Classic Football Shirts',
      link: 'https://www.classicfootballshirts.co.uk/2020-21-poland-away-shirt-m-pola20281621.html',
      trusted: true,
      upgraded: false,
    },
    {
      rank: 4,
      title: '2025-2026 Poland Away Concept Football Shirt [POLANDA ...]',
      imageUrl: 'https://cdn1.uksoccershop.com/images/1525696411-re-polandairofrontaway.jpg',
      imageUrl_fallback: 'https://cdn1.uksoccershop.com/images/1525696411-re-polandairofrontaway.jpg',
      thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR58uAgOFxaPfGcgIqP4edoaUXZgTg4diU-ng&s',
      source: 'UKSoccerShop.com',
      link: 'https://www.uksoccershop.com/p-110341/2018-2019-poland-away-concept-football-shirt.html',
      trusted: false,
      upgraded: false,
    },
    {
      rank: 5,
      title: 'Poland 2025-2026 Away Concept Football Kit (Libero ...)',
      imageUrl: 'https://cdn1.uksoccershop.com/images/adtnl_prodts_img/Poland-Libero-Away-Back.jpg',
      imageUrl_fallback: 'https://cdn1.uksoccershop.com/images/adtnl_prodts_img/Poland-Libero-Away-Back.jpg',
      thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT8cAWZO_C9Lbqc_qZ0fTYJ3A4Uy-CBjVoE4g&s',
      source: 'UKSoccerShop.com',
      link: 'https://www.uksoccershop.com/p-193147/poland-2020-2021-away-concept-football-kit-libero.html',
      trusted: false,
      upgraded: false,
    },
  ], null, 4) + '\n```',
  exhausted: 'no',
  dimension_filter_lifted: 'no',
  pool_size: 5,
  total_after_filter: 5,
  trusted_count: 1,
  upgraded_count: 0,
};

const STUB_DESCRIPTION_TEXT = [
  '# Poland Away Concept Shirt',
  '',
  '## Product Overview',
  "Embrace Poland's national pride in this striking away concept shirt from Airo Sportswear. Crisp white meets bold red accents as the lightweight, high-performance fabric drapes comfortably across every body, thanks to its unisex cut and versatile adult and kids sizing.",
  '',
  '## Heritage & Inspiration',
  "Inspired by the team's enduring spirit, the design channels decades of Polish football pride into a modern, wearable silhouette.",
  '',
  '## Key Features & Technical Specifications',
  '### Fabric & Comfort',
  '• High-performance lightweight fabric for optimal comfort',
  '• Unisex fit available in adult and kids sizes',
  '### Design Details',
  "• Durable Plastic Flex Transfer printing of Milik's number 7",
  "• Bold away concept design reflecting Poland's identity",
  '',
  "## Why You'll Love It",
  'This shirt fuses style and substance for supporters and players alike.',
  '• Officially licensed by Airo Sportswear for the 2025-2026 season',
  '• Perfect for football fans and casual wear with guaranteed authenticity',
  '',
  '## Ideal For',
  '• Fans of the Poland national team',
  '• Casual football-wear enthusiasts',
  '',
  '## Summary',
  'Order yours now from UK Soccer Shop for fast delivery and our authenticity guarantee.',
].join('\n');

const STUB_DESCRIPTION_OUTPUTS: Record<string, unknown> = {
  text: JSON.stringify({
    title: '2025-2026 Poland Away Concept Shirt (Milik 7)',
    description: STUB_DESCRIPTION_TEXT,
  }),
};

/** Re-throws `DifyError` as an `ApiError` so Fastify's error handler surfaces the real status code. */
function rethrowDifyError(err: unknown): never {
  if (err instanceof DifyError) {
    throw new ApiError(err.statusCode, 'DIFY_ERROR', err.message);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Images workflow
// ---------------------------------------------------------------------------

export async function generateImages(
  input: GenerateImagesInput,
  userId: number,
): Promise<DifyImagesResult> {
  if (config.DIFY_STUB_MODE) {
    return { workflowRunId: 'stub-images-001', status: 'succeeded', outputs: STUB_IMAGES_OUTPUTS, elapsedTime: 0 };
  }

  if (!config.DIFY_IMAGES_API_KEY) {
    throw new ApiError(400, 'DIFY_NOT_CONFIGURED', 'Dify Images workflow is not configured (set DIFY_IMAGES_API_KEY)');
  }

  const inputs = {
    product_name: input.productName,
    product_code: input.productCode,
    team_name: input.team ?? null,
    season: input.season ?? null,
    manufacturer_name: input.manufacturerName ?? null,
    num_keywords: String(input.numberOfKeywords ?? 3),
    num_results: String(input.numberOfResults ?? 10),
    custom_prompt: input.enhancementPrompt ?? null,
    exclude_urls: (input.excludeUrls ?? []).join('\n'),
  };
  try {
    const response = await runDifyWorkflow<Record<string, unknown>>(
      config.DIFY_IMAGES_API_KEY,
      inputs,
      `sms-user-${userId}`,
    );
    return {
      workflowRunId: response.workflow_run_id,
      status: response.data.status,
      outputs: response.data.outputs ?? {},
      elapsedTime: response.data.elapsed_time,
    };
  } catch (err) {
    rethrowDifyError(err);
  }
}

// ---------------------------------------------------------------------------
// Description workflow
// ---------------------------------------------------------------------------

export async function generateDescription(
  input: GenerateDescriptionInput,
  userId: number,
): Promise<DifyDescriptionResult> {
  if (config.DIFY_STUB_MODE) {
    return { workflowRunId: 'stub-desc-001', status: 'succeeded', outputs: STUB_DESCRIPTION_OUTPUTS, elapsedTime: 0 };
  }

  if (!config.DIFY_DESCRIPTION_API_KEY) {
    throw new ApiError(400, 'DIFY_NOT_CONFIGURED', 'Dify Description workflow is not configured (set DIFY_DESCRIPTION_API_KEY)');
  }

  const inputs = {
    product_name: input.productName,
    product_code: input.productCode,
    brand: input.brand ?? null,
    team_name: input.teamName ?? null,
    season: input.season ?? null,
    category: input.category ?? null,
    sport: input.sport ?? null,
    gender: input.gender ?? null,
    color: input.color ?? null,
    material: input.material ?? null,
    league: input.league ?? null,
    target_market: input.targetMarket ?? null,
    tone: input.tone ?? null,
    language: input.language ?? null,
    seo_keywords: input.seoKeywords ?? null,
    price: input.price != null ? String(input.price) : null,
    // Dify file-list variables expect [{type, transfer_method, url|upload_file_id}].
    // Each input ref is either {url} (gallery pick / paste) or {uploadFileId}
    // (Dify upload). Empty → omit so optional file-list defaults apply Dify-side.
    images:
      input.images && input.images.length > 0
        ? toDifyImageFileList(input.images)
        : null,
    custom_prompt: input.enhancementPrompt ?? null,
    // Workflow expects a literal yes/no string. Anything other than the truthy
    // boolean is sent as 'no' so the LLM's PERSONALISATION SECTION stays gated.
    add_legends: input.addLegends ? 'yes' : 'no',
  };

  try {
    const response = await runDifyWorkflow<Record<string, unknown>>(
      config.DIFY_DESCRIPTION_API_KEY,
      inputs,
      `sms-user-${userId}`,
    );
    return {
      workflowRunId: response.workflow_run_id,
      status: response.data.status,
      outputs: response.data.outputs ?? {},
      elapsedTime: response.data.elapsed_time,
    };
  } catch (err) {
    rethrowDifyError(err);
  }
}

// ---------------------------------------------------------------------------
// Upscale/Enhance workflow — used for image processing before saving
// ---------------------------------------------------------------------------

interface UpscaleWorkflowOutputs {
  upscaled_url?: string;
  upscaled_urls?: string[];
  results_json?: string;
  [key: string]: unknown;
}

/**
 * Upscale multiple images using the Dify upscale workflow in a single API call.
 * The workflow has default size/quality settings configured, so we only need to send the image URLs.
 *
 * @param imageUrls - Array of image URLs to upscale
 * @returns Map of original URL to upscaled URL (null value means upscale failed for that image)
 */
export async function upscaleImages(imageUrls: string[]): Promise<Map<string, string | null>> {
  const log = logger.child({ imageCount: imageUrls.length });
  const resultMap = new Map<string, string | null>();

  if (imageUrls.length === 0) {
    log.info('No images to upscale');
    return resultMap;
  }

  if (config.DIFY_STUB_MODE) {
    log.info('DIFY_STUB_MODE enabled, returning original image URLs');
    imageUrls.forEach(url => resultMap.set(url, url));
    return resultMap;
  }

  if (!config.DIFY_UPSCALE_API_KEY) {
    log.warn('DIFY_UPSCALE_API_KEY not configured, skipping upscale');
    imageUrls.forEach(url => resultMap.set(url, null));
    return resultMap;
  }

  // Join URLs with pipe character as required by Dify workflow
  const pipeDelimitedUrls = imageUrls.join('|');

  const inputs = {
    image_urls: pipeDelimitedUrls,
  };

  log.info({ inputs, imageUrls }, 'Calling Dify upscale API with multiple images');

  try {
    const response = await runDifyWorkflow<UpscaleWorkflowOutputs>(
      config.DIFY_UPSCALE_API_KEY,
      inputs,
      'sms-image-upscale',
    );

    log.info({
      workflowRunId: response.workflow_run_id,
      status: response.data.status,
      elapsedTime: response.data.elapsed_time,
      outputs: response.data.outputs,
    }, 'Dify upscale API response received');

    const outputs = response.data.outputs;
    let upscaledUrls: string[] = [];

    // Try to extract upscaled URLs from various possible output formats
    if (outputs?.upscaled_urls && Array.isArray(outputs.upscaled_urls)) {
      upscaledUrls = outputs.upscaled_urls;
      log.info({ upscaledUrls }, 'Upscaled URLs found in upscaled_urls array');
    } else if (outputs?.upscaled_url) {
      // Single URL returned - might be pipe-delimited or just one
      const urlStr = outputs.upscaled_url;
      upscaledUrls = urlStr.includes('|') ? urlStr.split('|') : [urlStr];
      log.info({ upscaledUrls }, 'Upscaled URLs extracted from upscaled_url field');
    } else if (outputs?.results_json) {
      // Try parsing results_json
      try {
        const results = JSON.parse(outputs.results_json);
        if (Array.isArray(results)) {
          upscaledUrls = results.map(r => r.upscaled || r.upscaled_url || null).filter(Boolean);
          log.info({ upscaledUrls }, 'Upscaled URLs extracted from results_json array');
        }
      } catch (parseErr) {
        log.warn({ results_json: outputs.results_json, error: parseErr }, 'Failed to parse results_json');
      }
    }

    // Map original URLs to upscaled URLs (by index)
    for (let i = 0; i < imageUrls.length; i++) {
      const originalUrl = imageUrls[i];
      const upscaledUrl = upscaledUrls[i] || null;
      resultMap.set(originalUrl, upscaledUrl);

      if (upscaledUrl) {
        log.info({ originalUrl, upscaledUrl, index: i }, 'Image upscaled successfully');
      } else {
        log.warn({ originalUrl, index: i }, 'No upscaled URL found for image');
      }
    }

    return resultMap;
  } catch (err) {
    if (err instanceof DifyError) {
      log.error({ statusCode: err.statusCode, message: err.message }, 'Dify upscale API error');
    } else {
      log.error({ error: err }, 'Unexpected error during image upscale');
    }

    // Return null for all images on error
    imageUrls.forEach(url => resultMap.set(url, null));
    return resultMap;
  }
}