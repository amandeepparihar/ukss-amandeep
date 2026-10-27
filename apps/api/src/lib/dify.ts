/**
 * Dify Workflow API client.
 *
 * Dify exposes one workflow per API key. Calling `/workflows/run` in `blocking`
 * mode returns the full output once the workflow finishes (timeout configurable
 * via DIFY_TIMEOUT_MS). For streaming we'd switch to `streaming` + SSE — not
 * needed yet, the existing UI already shows a skeleton during the wait.
 *
 * Reference: https://docs.dify.ai/api-reference/workflow/run-workflow
 */

import { config } from '../config';
import { logger } from './logger';

export interface DifyWorkflowResponse<TOutputs = Record<string, unknown>> {
  task_id: string;
  workflow_run_id: string;
  data: {
    id: string;
    workflow_id: string;
    status: 'running' | 'succeeded' | 'failed' | 'stopped';
    outputs: TOutputs | null;
    error: string | null;
    elapsed_time?: number;
    total_tokens?: number;
    total_steps?: number;
    created_at?: number;
    finished_at?: number;
  };
}

export class DifyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly difyError?: string,
  ) {
    super(message);
    this.name = 'DifyError';
  }
}

/**
 * Run a Dify workflow in blocking mode.
 *
 * Strips `null`/`undefined`/empty-string entries from `inputs` so that
 * optional workflow variables fall back to their Dify-side defaults.
 */
export async function runDifyWorkflow<TOutputs = Record<string, unknown>>(
  apiKey: string,
  inputs: Record<string, unknown>,
  user: string,
): Promise<DifyWorkflowResponse<TOutputs>> {
  if (!apiKey) {
    throw new DifyError('Dify API key is not configured', 500);
  }

  const cleanInputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== null && value !== undefined && value !== '') {
      cleanInputs[key] = value;
    }
  }

  const url = `${config.DIFY_API_BASE_URL}/workflows/run`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.DIFY_TIMEOUT_MS);

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: cleanInputs,
        response_mode: 'blocking',
        user,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new DifyError(`Dify returned non-JSON response: ${text.slice(0, 200)}`, res.status);
    }

    if (!res.ok) {
      const errMsg =
        (payload as { message?: string; error?: string })?.message ??
        (payload as { error?: string })?.error ??
        `HTTP ${res.status}`;
      throw new DifyError(`Dify workflow failed: ${errMsg}`, res.status, errMsg);
    }

    const response = payload as DifyWorkflowResponse<TOutputs>;
    if (response.data?.status !== 'succeeded') {
      throw new DifyError(
        `Dify workflow ended with status '${response.data?.status}': ${response.data?.error ?? 'no error detail'}`,
        500,
        response.data?.error ?? undefined,
      );
    }

    logger.info(
      {
        workflow_run_id: response.workflow_run_id,
        elapsed_ms: Date.now() - startedAt,
        status: response.data?.status,
      },
      'Dify workflow completed',
    );

    return response;
  } catch (err) {
    if (err instanceof DifyError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new DifyError(`Dify workflow timed out after ${config.DIFY_TIMEOUT_MS}ms`, 504);
    }
    throw new DifyError(`Dify request failed: ${(err as Error).message}`, 500);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Shape Dify expects for a `file-list` workflow input. Keys MUST match the
 * Dify spec exactly: `type`, `transfer_method`, `url` for remote URLs.
 * Local-file uploads use `upload_file_id` instead — not currently used here.
 */
export interface DifyFileRef {
  type: 'image' | 'document' | 'audio' | 'video';
  transfer_method: 'remote_url' | 'local_file';
  url?: string;
  upload_file_id?: string;
}

/**
 * Caller-facing shape for an image reference. Either a remote URL or a Dify
 * upload-file-id (returned from `uploadFileToDify`). Used by the description
 * workflow's `images` input — the user can pick from gallery URLs, paste a
 * URL, or upload a local file.
 */
export type DifyImageRefInput =
  | string
  | { url?: string; uploadFileId?: string };

/**
 * Convert a list of image refs into the file-list payload shape that Dify
 * workflow vision-enabled LLM nodes expect. Reusable wherever a workflow
 * accepts a `file-list` variable populated from URLs and/or Dify-side uploads.
 *
 * Accepts:
 *   - bare URL strings (back-compat with original signature)
 *   - { url } — emits `transfer_method: 'remote_url'`
 *   - { uploadFileId } — emits `transfer_method: 'local_file'` with upload_file_id
 *
 * Empty / falsy entries are filtered out.
 */
export function toDifyImageFileList(
  refs: ReadonlyArray<DifyImageRefInput | null | undefined>,
): DifyFileRef[] {
  const out: DifyFileRef[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    if (typeof ref === 'string') {
      const u = ref.trim();
      if (u) out.push({ type: 'image', transfer_method: 'remote_url', url: u });
      continue;
    }
    if (typeof ref.uploadFileId === 'string' && ref.uploadFileId.trim().length > 0) {
      out.push({
        type: 'image',
        transfer_method: 'local_file',
        upload_file_id: ref.uploadFileId.trim(),
      });
      continue;
    }
    if (typeof ref.url === 'string' && ref.url.trim().length > 0) {
      out.push({ type: 'image', transfer_method: 'remote_url', url: ref.url.trim() });
    }
  }
  return out;
}

/**
 * Upload a file to Dify so it can be referenced by `upload_file_id` in a
 * subsequent workflow run. Used for the "attach a local image" flow in the
 * Enhance Description dialog. The returned `id` is what gets passed as
 * `upload_file_id` inside the workflow's `images` file-list input.
 *
 * Reference: https://docs.dify.ai/api-reference/files/upload-files
 */
export async function uploadFileToDify(
  apiKey: string,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  user: string,
): Promise<{ id: string; name: string; size: number; mime_type: string }> {
  if (!apiKey) {
    throw new DifyError('Dify API key is not configured', 500);
  }

  const url = `${config.DIFY_API_BASE_URL}/files/upload`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.DIFY_TIMEOUT_MS);

  // Uses the *native* Web FormData (built-in on Node 18+), which pairs with
  // native `fetch`. This is intentionally NOT the `form-data` npm package —
  // products-background.service.ts imports that one because the remove.bg
  // client there is built on `axios`, which only accepts streamable form data.
  const form = new FormData();
  // The Web FormData API expects a Blob; Buffer wraps fine in Node 18+ via Blob.
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('user', user);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new DifyError(`Dify upload returned non-JSON: ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok) {
      const errMsg =
        (payload as { message?: string; error?: string })?.message ??
        (payload as { error?: string })?.error ??
        `HTTP ${res.status}`;
      throw new DifyError(`Dify file upload failed: ${errMsg}`, res.status, errMsg);
    }
    return payload as { id: string; name: string; size: number; mime_type: string };
  } catch (err) {
    if (err instanceof DifyError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new DifyError(`Dify file upload timed out after ${config.DIFY_TIMEOUT_MS}ms`, 504);
    }
    throw new DifyError(`Dify upload request failed: ${(err as Error).message}`, 500);
  } finally {
    clearTimeout(timeout);
  }
}
