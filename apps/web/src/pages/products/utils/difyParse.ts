/**
 * Helpers for parsing Dify workflow output payloads on the client.
 *
 * The `outputs` shape is workflow-defined, so these helpers probe loosely:
 *   - common direct-string fields (`description`, `output`, …)
 *   - LLM-style markdown-fenced JSON in a `text` field
 *   - nested `response` wrappers (the actual production workflows use this)
 *
 * Pure functions, no React imports — safe to import from anywhere on the
 * client and easy to unit-test in isolation.
 */

/** Hostname for display, with the `www.` prefix stripped; "unknown" on parse failure. */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** Strip markdown code fences (` ```json ... ``` `) and parse as JSON. Returns null on failure. */
export function tryParseMarkdownJson(text: string): unknown {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/** Unwrap a nested `response` wrapper that the real Dify workflow returns. */
export function unwrapOutputs(outputs: Record<string, unknown>): Record<string, unknown> {
  if (outputs.response && typeof outputs.response === 'object' && !Array.isArray(outputs.response)) {
    return outputs.response as Record<string, unknown>;
  }
  return outputs;
}

/**
 * Pull the first string field from a Dify outputs object that looks like a
 * description. The workflow's `description` output is already the fully
 * assembled wizard plain-text (heading markers + bullets) — no separate
 * key_features field to merge in.
 */
export function extractDescription(rawOutputs: Record<string, unknown>): string {
  const outputs = unwrapOutputs(rawOutputs);
  const candidates = ['description', 'product_description', 'output', 'result', 'content'];
  for (const key of candidates) {
    const v = outputs[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim();
    }
  }
  // Dify LLM nodes often return a JSON object in `text` with a `description` field
  const textField = outputs.text ?? rawOutputs.text;
  if (typeof textField === 'string') {
    const parsed = tryParseMarkdownJson(textField);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const desc = typeof obj.description === 'string' ? obj.description.trim() : '';
      if (desc) return desc;
    }
  }
  // Fallback: first long string in the outputs
  for (const v of Object.values(outputs)) {
    if (typeof v === 'string' && v.length > 50) return v;
  }
  return '';
}

export interface ExtractedImage {
  id: number;
  url: string;
  /**
   * Original Serper URL kept alongside `url` (which may be an upgraded high-res
   * variant from the workflow). Frontend `<img onError>` swaps to this when the
   * upgraded URL fails. Undefined when no upgrade was applied.
   */
  fallbackUrl?: string;
  thumbnailUrl: string;
  source: string;
  label: string;
  /**
   * Set after the user accepts an AI enhancement. Used to render the Sparkles
   * indicator on the tile while keeping the original `source` (e.g. "Amazon")
   * visible. `prompt` is only present for `edit` mode.
   */
  enhanced?: { type: 'quality' | 'edit'; prompt?: string };
}

export interface ExtractedAttribute {
  key: string;
  label: string;
  value: string;
  confidence?: number;
}

/** Try to extract image results from outputs (URLs as strings or {url, source} objects). */
export function extractImages(outputs: Record<string, unknown>): ExtractedImage[] {
  // Try standard array shapes first
  let imgSource: unknown =
    (outputs.images as unknown) ??
    (outputs.results as unknown) ??
    (outputs.image_urls as unknown) ??
    null;

  // Fallback: Dify LLM nodes often return a markdown-fenced JSON array in `text`
  if (!Array.isArray(imgSource) && typeof outputs.text === 'string') {
    const parsed = tryParseMarkdownJson(outputs.text);
    if (Array.isArray(parsed)) imgSource = parsed;
  }

  const result: ExtractedImage[] = [];
  if (!Array.isArray(imgSource)) return result;

  imgSource.forEach((item, idx) => {
    if (typeof item === 'string') {
      result.push({
        id: idx + 1,
        url: item,
        thumbnailUrl: item,
        source: safeHostname(item),
        label: `Result ${idx + 1}`,
      });
    } else if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      const url = String(obj.imageUrl ?? obj.url ?? obj.image_url ?? obj.src ?? '');
      if (!url) return;
      const thumbnailUrl = String(obj.thumbnailUrl ?? obj.thumbnail ?? obj.thumb ?? url);
      const rawFallback = obj.imageUrl_fallback ?? obj.fallbackUrl ?? null;
      const fallbackUrl =
        typeof rawFallback === 'string' && rawFallback && rawFallback !== url
          ? rawFallback
          : undefined;
      result.push({
        id: idx + 1,
        url,
        fallbackUrl,
        thumbnailUrl,
        source: String(obj.source ?? obj.domain ?? safeHostname(url)),
        label: String(obj.label ?? obj.title ?? `Result ${idx + 1}`),
      });
    }
  });

  return result;
}
