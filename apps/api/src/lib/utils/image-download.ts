/**
 * Image download helper shared by the New Product save flow and the click-time
 * background-removal flow.
 *
 * Handles both HTTP(S) sources and base64 `data:` URIs. The data-URI branch
 * exists because the bg-removal pipeline returns PNG bytes as a data URI for
 * the frontend's before/after dialog, and `saveProductDetails` later "downloads"
 * that same URI when persisting the chosen variant.
 *
 * Throws `ApiError` with stable codes so callers can surface a sensible HTTP
 * status without needing to know about `fetch` semantics.
 */

import { ApiError } from '../errors';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = 'UKSS-Stock2/1.0';

export interface DownloadImageOptions {
  /** Per-call timeout in milliseconds. Defaults to 30 s. */
  timeoutMs?: number;
  /** Override the User-Agent header (rarely needed; sites that block bots may want this). */
  userAgent?: string;
}

export async function downloadImage(
  url: string,
  options: DownloadImageOptions = {},
): Promise<Buffer> {
  // Handle base64 data URIs inline. Node's `fetch` supports data: URIs in
  // recent versions, but bypassing it avoids surprises with undici buffering
  // and is measurably faster for large PNG payloads.
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new ApiError(400, 'INVALID_IMAGE', 'Malformed data URI');
    }
    return Buffer.from(match[2], 'base64');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
    });

    if (!response.ok) {
      throw new ApiError(
        400,
        'IMAGE_DOWNLOAD_FAILED',
        `Failed to download image: HTTP ${response.status} from ${url}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      throw new ApiError(
        400,
        'INVALID_IMAGE',
        `URL did not return an image (content-type: ${contentType})`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ApiError(
      400,
      'IMAGE_DOWNLOAD_FAILED',
      `Failed to download image from ${url}: ${message}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
