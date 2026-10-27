/**
 * Replicate HTTP API client.
 *
 * Replicate's `POST /v1/predictions` returns immediately with status='starting'
 * and a `urls.get` poll URL. We poll until the prediction reaches a terminal
 * state (`succeeded` or `failed`), bounded by REPLICATE_TIMEOUT_MS.
 *
 * Reference: https://replicate.com/docs/reference/http
 */

import { config } from '../config';
import { logger } from './logger';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 1500;

type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface ReplicatePrediction<TOutput = unknown> {
  id: string;
  status: PredictionStatus;
  output: TOutput | null;
  error: string | null;
  urls: {
    get: string;
    cancel: string;
  };
}

export class ReplicateError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly replicateError?: string,
  ) {
    super(message);
    this.name = 'ReplicateError';
  }
}

/**
 * Run a Replicate model and wait for its output.
 *
 * `modelRef` accepts two forms:
 *   - `<owner>/<name>:<version>` — pinned version, posted to `/v1/predictions`.
 *   - `<owner>/<name>`           — official-model latest, posted to
 *     `/v1/models/<owner>/<name>/predictions`. Use this for Replicate official
 *     models (e.g. `google/nano-banana`) where the version rotates and
 *     pinning is impractical.
 */
export async function runReplicateModel<TInput, TOutput = unknown>(
  modelRef: string,
  input: TInput,
): Promise<{ output: TOutput; predictionId: string; elapsedMs: number }> {
  if (!config.REPLICATE_API_TOKEN) {
    throw new ReplicateError('Replicate API token is not configured', 500);
  }

  let createUrl: string;
  let createBody: string;
  if (modelRef.includes(':')) {
    const [, version] = modelRef.split(':');
    if (!version) {
      throw new ReplicateError(`Replicate modelRef has empty version (got '${modelRef}')`, 400);
    }
    createUrl = `${REPLICATE_API_BASE}/predictions`;
    createBody = JSON.stringify({ version, input });
  } else {
    const [owner, name] = modelRef.split('/');
    if (!owner || !name) {
      throw new ReplicateError(
        `Replicate modelRef must be '<owner>/<name>' or '<owner>/<name>:<version>' (got '${modelRef}')`,
        400,
      );
    }
    createUrl = `${REPLICATE_API_BASE}/models/${owner}/${name}/predictions`;
    createBody = JSON.stringify({ input });
  }

  const startedAt = Date.now();
  const deadline = startedAt + config.REPLICATE_TIMEOUT_MS;

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: createBody,
  });

  const createText = await createRes.text();
  let createPayload: ReplicatePrediction<TOutput>;
  try {
    createPayload = JSON.parse(createText);
  } catch {
    throw new ReplicateError(`Replicate returned non-JSON response: ${createText.slice(0, 200)}`, createRes.status);
  }

  if (!createRes.ok) {
    const errMsg = (createPayload as unknown as { detail?: string })?.detail ?? `HTTP ${createRes.status}`;
    throw new ReplicateError(`Replicate prediction create failed: ${errMsg}`, createRes.status, errMsg);
  }

  let prediction = createPayload;

  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() > deadline) {
      throw new ReplicateError(
        `Replicate prediction ${prediction.id} timed out after ${config.REPLICATE_TIMEOUT_MS}ms (last status: ${prediction.status})`,
        504,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${config.REPLICATE_API_TOKEN}` },
    });
    const pollText = await pollRes.text();
    try {
      prediction = JSON.parse(pollText);
    } catch {
      throw new ReplicateError(`Replicate poll returned non-JSON response: ${pollText.slice(0, 200)}`, pollRes.status);
    }
    if (!pollRes.ok) {
      throw new ReplicateError(`Replicate poll failed: HTTP ${pollRes.status}`, pollRes.status);
    }
  }

  const elapsedMs = Date.now() - startedAt;

  if (prediction.status !== 'succeeded') {
    throw new ReplicateError(
      `Replicate prediction ended with status '${prediction.status}': ${prediction.error ?? 'no error detail'}`,
      500,
      prediction.error ?? undefined,
    );
  }

  if (prediction.output == null) {
    throw new ReplicateError('Replicate prediction succeeded but returned no output', 500);
  }

  logger.info(
    { predictionId: prediction.id, elapsed_ms: elapsedMs, status: prediction.status },
    'Replicate prediction completed',
  );

  return { output: prediction.output, predictionId: prediction.id, elapsedMs };
}
