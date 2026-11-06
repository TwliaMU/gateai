import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  ProviderRecord
} from '../core/types.js';

export interface HealthCheckResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  message: string;
}

export interface ProviderAdapter {
  readonly provider: ProviderRecord;

  chat(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<NormalizedChatResponse>;

  stream(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>>;

  models(apiKey: string, timeoutMs: number): Promise<ModelInfo[]>;

  healthCheck(apiKey: string): Promise<HealthCheckResult>;
}

/**
 * Determine if an HTTP status code or error is retryable
 */
export function isRetryableError(statusCode: number, isTimeoutOrNetwork: boolean): boolean {
  if (isTimeoutOrNetwork) return true;
  // Non-retryable client errors: 400, 401, 403, 404, 422
  if ([400, 401, 403, 404, 422].includes(statusCode)) {
    return false;
  }
  // Retryable errors: 408 (Timeout), 425, 429 (Rate Limit), 500, 502, 503, 504
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
}

/**
 * Parse Retry-After header from upstream response
 * Returns cooldown in milliseconds
 */
export function parseRetryAfterMs(headerValue: string | null | undefined, fallbackMs = 30000): number {
  // Key cooldown and circuit cooldown share the same 300s cap (2026-11-05):
  // an uncapped Retry-After (e.g. 3600s) must not leave a vendor in
  // "circuit open, keys still cooling" limbo.
  const cap = (ms: number) => Math.min(Math.max(ms, 0), 300000);
  if (!headerValue) return cap(fallbackMs);
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return cap(seconds * 1000);
  }
  // Try parsing HTTP date
  const date = Date.parse(headerValue);
  if (!isNaN(date) && date > Date.now()) {
    return cap(Math.max(5000, date - Date.now()));
  }
  return cap(fallbackMs);
}
