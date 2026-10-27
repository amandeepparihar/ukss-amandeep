import type { BatchResult, RunState } from './medusa-price-sync.types';

/**
 * HTTP client for the Medusa price-sync Admin API. Redmine #166532 (HLA row 7).
 *
 * Thin on purpose: the retry policy is the only real logic, and it is the part
 * that decides whether a failed night costs a rerun or a corrupted catalogue.
 */

export class MedusaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MedusaApiError';
  }
}

/**
 * Statuses worth retrying: the request never reached the handler, or the handler
 * asked us to come back.
 *
 * 401/403 (bad or revoked key), 404 (wrong run id) and 422 (unusable snapshot,
 * stale cursor, finished run) are NEVER retried. All of them are deterministic —
 * retrying cannot change the answer, it just delays the alert and, in the case of a
 * cursor error, keeps hammering a run that needs a human to look at it.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

export type MedusaClientOptions = {
  baseUrl: string;
  secretApiKey: string;
  timeoutMs: number;
  maxRetries: number;
  log?: (message: string) => void;
};

/**
 * Builds the HTTP Basic credential, accepting either form found in this estate.
 *
 * Medusa's api-key auth is Basic with the secret key as the username and an empty
 * password — not a Bearer token. The framework already applies
 * authenticate("user", ["bearer", "session", "api-key"]) to every /admin route, so
 * no server-side change was needed to accept it.
 *
 * Both shapes must work because the two Stock2 containers are provisioned
 * differently and we deliberately reuse their existing MEDUSA_API_KEY rather than
 * requiring a new variable:
 *
 *   production  "sk_45ab3..."      raw       -> encode as base64("sk_...:")
 *   staging     "c2tfNTgyZTk2..."  encoded   -> already base64("sk_...:"), use as-is
 *
 * Discriminated on the `sk_` prefix, which is safe rather than a guess: `_` is not
 * in the standard base64 alphabet, and the encoded form of any Medusa secret key
 * begins "c2t" (base64 of "sk"). The two cannot be confused.
 */
export function toBasicCredential(key: string): string {
  return key.startsWith('sk_') ? Buffer.from(`${key}:`).toString('base64') : key;
}

export class MedusaPriceSyncClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly options: MedusaClientOptions) {
    if (!options.baseUrl) {
      throw new Error('MEDUSA_API_BASE_URL is not set');
    }
    if (!options.secretApiKey) {
      throw new Error('MEDUSA_API_KEY is not set');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authHeader = `Basic ${toBasicCredential(options.secretApiKey)}`;
  }

  /** Opens a run, or returns the existing one for a replayed Idempotency-Key. */
  async createRun(body: unknown, idempotencyKey: string): Promise<RunState> {
    const { run } = await this.request<{ run: RunState }>('POST', '/admin/currency-price-sync/runs', {
      body,
      idempotencyKey,
    });
    return run;
  }

  async getRun(runId: string): Promise<RunState> {
    const { run } = await this.request<{ run: RunState }>(
      'GET',
      `/admin/currency-price-sync/runs/${runId}`,
    );
    return run;
  }

  async runBatch(
    runId: string,
    body: { cursor: string | null; limit?: number },
    idempotencyKey: string,
  ): Promise<BatchResult> {
    return await this.request<BatchResult>(
      'POST',
      `/admin/currency-price-sync/runs/${runId}/batches`,
      { body, idempotencyKey },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffMs(attempt));
        this.log(`retry ${attempt}/${this.options.maxRetries} ${method} ${path}`);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: this.authHeader,
            ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });

        const text = await response.text();
        const parsed = text ? safeJson(text) : null;

        if (response.ok) {
          return parsed as T;
        }

        const retryable = isRetryableStatus(response.status);
        const error = new MedusaApiError(
          `${method} ${path} -> ${response.status} ${describe(parsed) ?? text.slice(0, 300)}`,
          response.status,
          parsed,
          retryable,
        );

        if (!retryable) {
          throw error;
        }

        lastError = error;
      } catch (error) {
        /**
         * A timeout is retryable but it is also the dangerous case: the request may
         * have been handled and only the response lost. That is exactly why every
         * mutating call carries an Idempotency-Key and the batch endpoint replays a
         * committed cursor instead of re-executing it.
         */
        if (error instanceof MedusaApiError) {
          if (!error.retryable) {
            throw error;
          }
          lastError = error;
        } else if ((error as Error)?.name === 'AbortError') {
          lastError = new MedusaApiError(
            `${method} ${path} timed out after ${this.options.timeoutMs}ms`,
            0,
            null,
            true,
          );
        } else {
          // DNS, connection refused, socket reset: never reached the handler.
          lastError = new MedusaApiError(
            `${method} ${path} failed: ${(error as Error).message}`,
            0,
            null,
            true,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

/** Exponential backoff with jitter, capped — a stampede helps nobody. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function describe(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === 'object' && 'message' in parsed) {
    return String((parsed as { message: unknown }).message);
  }
  return undefined;
}
