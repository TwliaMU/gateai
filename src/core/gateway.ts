import type { IGatewayStorage } from '../storage/interface.js';
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  ProviderRecord,
  ApiKeyRecord,
  ClientTokenRecord
} from './types.js';
import { sha256Hex, decryptKey, deriveAesKey, decryptWithKey, validateSafeUrl as safeUrlChecker } from './crypto.js';
import { KeyLoadBalancer } from './load-balancer.js';
import { ClientRateLimiter } from './rate-limiter.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ModelRouter } from './router.js';
import { GeminiAdapter, UpstreamHttpError } from '../adapters/gemini.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { AnthropicAdapter } from '../adapters/anthropic.js';
import { isRetryableError, parseRetryAfterMs, type ProviderAdapter } from '../adapters/base.js';

function stableErrorCode(statusCode: number): string {
  if (statusCode === 429) return 'rate_limited';
  if (statusCode === 401) return 'invalid_key';
  return 'upstream_error';
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimatePromptTokens(request: NormalizedChatRequest): number {
  let chars = 0;
  const msgs: any[] = Array.isArray((request as any).messages) ? (request as any).messages : [];
  for (const m of msgs) {
    const c: any = m?.content;
    if (typeof c === 'string') chars += c.length;
    else if (Array.isArray(c)) for (const part of c) if (typeof part?.text === 'string') chars += part.text.length;
  }
  return Math.ceil(chars / 4);
}

export class AiGatewayCore {
  private rateLimiter = new ClientRateLimiter();
  private circuitBreaker = new CircuitBreaker(5, 60000);

  constructor(
    private storage: IGatewayStorage,
    private encryptionSecret: string
  ) {}

  private getAdapter(provider: ProviderRecord): ProviderAdapter {
    switch (provider.type) {
      case 'gemini':
        return new GeminiAdapter(provider);
      case 'anthropic':
        return new AnthropicAdapter(provider);
      case 'openai':
      case 'deepseek':
      case 'groq':
      case 'custom':
      default:
        return new OpenAIAdapter(provider);
    }
  }

  /**
   * Validate and authenticate incoming Client Bearer Token
   */
  async authenticateClientToken(authHeader?: string | null): Promise<ClientTokenRecord | null> {
    if (!authHeader) return null;
    const match = authHeader.match(/^Bearer\s+(sk-gw-[a-zA-Z0-9_-]+)$/);
    if (!match) return null;
    const rawToken = match[1];
    const tokenHash = await sha256Hex(rawToken);
    return this.storage.getClientByTokenHash(tokenHash);
  }

  /**
   * Handle /v1/models request, optionally filtered by authorized client token allowedModels
   */
  async listModels(client?: ClientTokenRecord | null): Promise<{ object: 'list'; data: ModelInfo[] }> {
    const providers = await this.storage.getProviders();
    const modelSet = new Set<string>();
    const models: ModelInfo[] = [];

    for (const p of providers.filter(p => p.enabled)) {
      const pModels = await this.storage.getProviderModels(p.id);
      for (const m of pModels) {
        if (!modelSet.has(m)) {
          modelSet.add(m);
          models.push({
            id: m,
            object: 'model',
            created: 1740000000,
            owned_by: p.id
          });
        }
      }
    }

    let filteredModels = models;
    if (client && Array.isArray(client.allowedModels) && client.allowedModels.length > 0 && !client.allowedModels.includes('*')) {
      const allowedSet = new Set(client.allowedModels);
      filteredModels = models.filter(m => allowedSet.has(m.id));
    }

    return { object: 'list', data: filteredModels };
  }

  /**
   * Main Chat Completions Orchestration with multi-key LB, retry, circuit breaker & streaming
   */
  private async safeBookkeeping(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      console.error('[Gateway] Bookkeeping failed (ignored):', e);
    }
  }

  private assertQuotaAvailable(client: ClientTokenRecord | null): void {
    if (!client) return;
    if (client.quotaLimitRequests > 0 && client.quotaUsedRequests >= client.quotaLimitRequests) {
      throw new GatewayError(429, 'rate_limited');
    }
    if (client.quotaLimitTokens > 0 && client.quotaUsedTokens >= client.quotaLimitTokens) {
      throw new GatewayError(429, 'rate_limited');
    }
  }

  private assertQuotaWithEstimate(client: ClientTokenRecord | null, request: NormalizedChatRequest): void {
    if (!client || client.quotaLimitTokens <= 0) return;
    const estimate = estimatePromptTokens(request) + ((request as any).max_tokens || 0);
    if (client.quotaUsedTokens + estimate > client.quotaLimitTokens) {
      throw new GatewayError(429, 'rate_limited');
    }
  }

  /** Wrap an upstream SSE stream, tallying usage from final usage chunks. */
  private wrapStreamWithUsage(stream: ReadableStream<Uint8Array>, onUsage: (totalTokens: number) => Promise<void>): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let total = 0;
    let usageSettled = false;
    const settleUsage = async () => {
      if (usageSettled) return;
      usageSettled = true;
      try { await onUsage(total); } catch {}
    };
    const tallyChunk = (text: string) => {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const data: any = JSON.parse(payload);
          const u = data.usage;
          if (u) {
            const tt = typeof u.total_tokens === 'number' ? u.total_tokens
              : (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number' ? (u.prompt_tokens || 0) + (u.completion_tokens || 0)
              : (u.input_tokens || 0) + (u.output_tokens || 0));
            if (typeof tt === 'number' && tt > total) total = tt;
          }
        } catch {}
      }
    };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          await settleUsage();
          controller.close();
          return;
        }
        if (value) { tallyChunk(decoder.decode(value, { stream: true })); controller.enqueue(value); }
      },
      async cancel(reason) {
        // A cancelled stream still settles what was already delivered,
        // instead of silently dropping the partial usage.
        await settleUsage();
        await reader.cancel(reason);
      },
    });
  }

  /**
   * Main Chat Completions Orchestration with multi-key LB, retry, circuit breaker & streaming
   */
  async handleChatCompletion(
    request: NormalizedChatRequest,
    client: ClientTokenRecord | null,
    isPublicAllowed = false,
    downstreamSignal?: AbortSignal
  ): Promise<
    | { type: 'json'; response: NormalizedChatResponse }
    | { type: 'stream'; stream: ReadableStream<Uint8Array> }
  > {
    if (!client && !isPublicAllowed) {
      throw new GatewayError(401, 'Unauthorized: Valid Client Token (Bearer sk-gw-...) is required');
    }

    // 1. Enforce Client RPM Rate Limit
    if (client && client.rpmLimit > 0) {
      const check = this.rateLimiter.checkRateLimit(client.id, client.rpmLimit);
      if (!check.allowed) {
        throw new GatewayError(429, `Rate limit exceeded: ${client.rpmLimit} RPM limit reached. Try again in ${check.retryAfterSeconds}s.`);
      }
    }

    // 1b. Enforce Client Quota before any upstream call (0 = unlimited, as before)
    this.assertQuotaAvailable(client);

    // Overall request deadline: 120s from here, separate from the
    // per-attempt timeout and the 20s stream stall timeout. The timer
    // is intentionally left to fire for streams (it aborts the stream);
    // for finished requests firing on a dead controller is harmless.
    const deadlineController = new AbortController();
    let deadlineExceeded = false;
    setTimeout(() => { deadlineExceeded = true; deadlineController.abort(); }, 120000);
    if (downstreamSignal) {
      if (downstreamSignal.aborted) deadlineController.abort();
      else downstreamSignal.addEventListener('abort', () => deadlineController.abort(), { once: true });
    }
    const effectiveSignal = deadlineController.signal;

    // 2. Resolve Route & Fallbacks
    const providers = await this.storage.getProviders();
    const mappings = await this.storage.getAllModelMappings();
    const config = await this.storage.getConfig();

    const resolution = ModelRouter.resolveRoute(
      request.model,
      providers,
      mappings,
      config.defaultProvider
    );

    if (!resolution) {
      throw new GatewayError(503, 'No available or enabled providers configured in gateway');
    }

    // Unknown model: reject before calling any upstream provider.
    if (!resolution.matched) {
      throw new GatewayError(404, `model_not_found: ${request.model}`);
    }

    // Enforce Client Provider & Model Permissions, and filter fallbacks by them.
    let candidateProviders = [resolution.primaryProvider, ...resolution.fallbackProviders];
    if (client) {
      if (!client.allowedProviders.includes('*')) {
        candidateProviders = candidateProviders.filter(p => client.allowedProviders.includes(p.id));
        if (candidateProviders.length === 0) {
          throw new GatewayError(403, `Forbidden: Token not permitted to access provider '${resolution.primaryProvider.id}'`);
        }
      }
      if (!client.allowedModels.includes('*')
        && !client.allowedModels.includes(request.model)
        && !client.allowedModels.includes(resolution.targetModel)) {
        throw new GatewayError(403, `Forbidden: Token not permitted to access model '${request.model}'`);
      }
    }

    this.assertQuotaWithEstimate(client, request);

    const maxRetries = Math.min(config.maxRetries || 3, 5);

    let lastError: any = null;
    let totalAttempts = 0;
    let aesKey: CryptoKey | null = null;
    try { aesKey = await deriveAesKey(this.encryptionSecret); } catch { aesKey = null; }

    for (let providerIndex = 0; providerIndex < candidateProviders.length; providerIndex++) {
      const provider = candidateProviders[providerIndex];
      // Reserve 2 attempts for vendors not yet tried, so the first
      // vendors cannot consume the whole 9-attempt budget.
      const remainingVendors = candidateProviders.length - providerIndex - 1;
      const totalAttemptsCap = 9 - (remainingVendors > 0 ? 2 : 0);
      let consecutive429 = 0;
      // Check Circuit Breaker
      if (!this.circuitBreaker.canExecute(provider.id)) {
        continue;
      }

      // SSRF: validate the provider base URL before any upstream request.
      const urlCheck = safeUrlChecker(provider.baseUrl);
      if (!urlCheck.safe) {
        lastError = new GatewayError(400, `Unsafe provider base URL: ${urlCheck.error || 'blocked'}`);
        continue;
      }

      const fullKeys: ApiKeyRecord[] = typeof (this.storage as any).getKeysFull === 'function'
        ? await (this.storage as any).getKeysFull(provider.id)
        : await (async () => {
            const allKeys = await this.storage.getKeys(provider.id);
            const out: ApiKeyRecord[] = [];
            for (const k of allKeys) {
              const full = await this.storage.getKey(k.id);
              if (full) out.push(full);
            }
            return out;
          })();
      if (fullKeys.length === 0) {
        lastError = new GatewayError(502, `no_key_configured: provider ${provider.id} has no keys`);
        continue;
      }

      // Retry budget is per provider: reset for each provider.
      let providerAttempts = 0;
      const maxProviderAttempts = Math.min(fullKeys.length, maxRetries);

      while (providerAttempts < maxProviderAttempts && totalAttempts < totalAttemptsCap) {
        providerAttempts++;
        totalAttempts++;
        if (providerAttempts > 1) await sleepMs(50 + Math.random() * 150);

        const currentCursor = await this.storage.getProviderRrCursor(provider.id);
        const selection = KeyLoadBalancer.selectKey(fullKeys, provider.strategy, currentCursor);

        if (!selection) {
          // Distinguish "all keys cooling" (actionable, with an expiry)
          // from "no available key" instead of leaving lastError stale.
          const nowMs = Date.now();
          const cooling = fullKeys.filter(k => k.status === 'rate_limited' && k.cooldownUntil && k.cooldownUntil > nowMs);
          if (fullKeys.length > 0 && cooling.length === fullKeys.length) {
            const nearest = Math.min(...cooling.map(k => k.cooldownUntil as number));
            lastError = new GatewayError(429, `all_keys_cooling: provider ${provider.id} keys are cooling`, Math.max(0, nearest - nowMs));
          } else {
            lastError = new GatewayError(502, `no_available_key: provider ${provider.id} has no available keys`);
          }
          break;
        }

        const { selectedKey, nextCursor } = selection;
        await this.storage.incrementProviderRrCursor(provider.id, nextCursor);

        const startTime = Date.now();
        let rawKey: string;
        try {
          rawKey = aesKey ? await decryptWithKey(selectedKey.encryptedKey, aesKey) : await decryptKey(selectedKey.encryptedKey, this.encryptionSecret);
        } catch (e: any) {
          console.error(`[Gateway] Failed to decrypt key ${selectedKey.id}:`, e);
          await this.safeBookkeeping(() =>
            this.storage.updateKeyStatus(selectedKey.id, selectedKey.status, undefined, 'key decryption failed')
          );
          lastError = new GatewayError(502, 'key decryption failed');
          continue;
        }

        const adapter = this.getAdapter(provider);
        const reqWithMappedModel: any = { ...request, model: resolution.targetModel };
        // OpenAI-style streams only report usage when the client asks;
        // force include_usage when the client did not set stream_options,
        // without overriding an explicit client value. Gemini/Anthropic
        // adapters build their own payloads and ignore this field.
        if (request.stream && !reqWithMappedModel.stream_options) {
          reqWithMappedModel.stream_options = { include_usage: true };
        }

        if (request.stream) {
          let upstreamStream: ReadableStream<Uint8Array>;
          try {
            upstreamStream = await adapter.stream(
              reqWithMappedModel,
              rawKey,
              provider.timeoutMs || 60000,
              effectiveSignal
            );
          } catch (err: any) {
            const durationMs = Date.now() - startTime;
            const statusCode = err instanceof UpstreamHttpError ? err.statusCode : (err.name === 'AbortError' ? 504 : 502);
            if (deadlineExceeded) throw new GatewayError(504, 'request_deadline_exceeded');
            lastError = err;
            await this.safeBookkeeping(() => this.storage.updateKeyUsage(selectedKey.id, 0, true));
            if (statusCode === 401) {
              await this.safeBookkeeping(() => this.storage.updateKeyStatus(selectedKey.id, 'invalid', 0, '401 Unauthorized from upstream'));
            }
            if (statusCode === 429) {
              const retryAfterMs = parseRetryAfterMs(err.retryAfterHeader, (config.autoCooldownMinutes || 5) * 60000);
              await this.safeBookkeeping(() => this.storage.updateKeyStatus(selectedKey.id, 'rate_limited', Date.now() + retryAfterMs, '429 Too Many Requests'));
              this.circuitBreaker.recordFailure(provider.id, retryAfterMs);
              // Keep the in-memory copy in sync so the "all keys cooling"
              // check below reflects this attempt.
              (selectedKey as any).status = 'rate_limited';
            } else {
              this.circuitBreaker.recordFailure(provider.id);
            }
            await this.safeBookkeeping(() => this.storage.recordLog({
              id: 'log-' + globalThis.crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              clientName: client?.name || 'Public Client',
              providerId: provider.id,
              providerName: provider.name,
              keyMasked: selectedKey.keyPrefix,
              model: request.model,
              mappedModel: resolution.targetModel !== request.model ? resolution.targetModel : undefined,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              durationMs,
              statusCode,
              isStream: true,
              errorMessage: `${statusCode} ${stableErrorCode(statusCode)}`
            }));
            if (statusCode === 429) {
              // 2026-11-05: try the next key in the same vendor first;
              // skip the vendor only after 2 consecutive 429s or when
              // every key is now rate_limited.
              consecutive429++;
              if (consecutive429 >= 2 || fullKeys.every(k => k.status === 'rate_limited')) break;
            }
            if (statusCode === 404 || statusCode === 400) {
              // Model mismatch is per-vendor, not per-key: trying the
              // next key of the same vendor would repeat the same 404.
              break;
            }
            if (!isRetryableError(statusCode, err.name === 'AbortError') && statusCode !== 401) {
              throw new GatewayError(statusCode, stableErrorCode(statusCode), statusCode === 429 ? parseRetryAfterMs(err.retryAfterHeader, (config.autoCooldownMinutes || 5) * 60000) : undefined);
            }
            continue;
          }

          // Stream established: bookkeeping is best-effort and must never
          // turn this successful upstream call into a failure. Token usage
          // for a stream is not known here, so it is honestly recorded as
          // 0 tokens (request count only) instead of a fixed placeholder.
          this.circuitBreaker.recordSuccess(provider.id);
          if (client) {
            const quotaOk = await this.storage.atomicIncrementClientQuota(client.id, 1, 0).catch(() => false);
            if (!quotaOk) {
              console.error('[Gateway] Streaming quota increment failed after stream start; stream already established, not retracting it.');
            }
          }
          // Usage is tallied from the final usage chunk when the stream
          // closes; key usage and token quota are updated then (a refused
          // token increment after delivery is logged, never retracted).
          const wrappedStream = this.wrapStreamWithUsage(upstreamStream, async (totalTokens) => {
            if (totalTokens > 0) {
              await this.safeBookkeeping(() => this.storage.updateKeyUsage(selectedKey.id, totalTokens, false));
              if (client) {
                const ok = await this.storage.atomicIncrementClientQuota(client.id, 0, totalTokens).catch(() => false);
                if (!ok) console.error('[Gateway] Streaming token quota increment refused after stream delivery.');
              }
            } else {
              await this.safeBookkeeping(() => this.storage.updateKeyUsage(selectedKey.id, 0, false));
            }
          });
          upstreamStream = wrappedStream;
          await this.safeBookkeeping(() => this.storage.recordLog({
            id: 'log-' + globalThis.crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            clientName: client?.name || 'Public Client',
            providerId: provider.id,
            providerName: provider.name,
            keyMasked: selectedKey.keyPrefix,
            model: request.model,
            mappedModel: resolution.targetModel !== request.model ? resolution.targetModel : undefined,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            durationMs: Date.now() - startTime,
            statusCode: 200,
            isStream: true
          }));
          return { type: 'stream', stream: upstreamStream };
        }

        // NON-STREAMING FLOW: adapter call in its own try, so bookkeeping
        // failures below can never be misread as upstream failures.
        let response: NormalizedChatResponse;
        try {
          response = await adapter.chat(
            reqWithMappedModel,
            rawKey,
            provider.timeoutMs || 60000,
            effectiveSignal
          );
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          const statusCode = err instanceof UpstreamHttpError ? err.statusCode : (err.name === 'AbortError' ? 504 : 502);
          if (deadlineExceeded) throw new GatewayError(504, 'request_deadline_exceeded');
          lastError = err;
          await this.safeBookkeeping(() => this.storage.updateKeyUsage(selectedKey.id, 0, true));
          if (statusCode === 401) {
            await this.safeBookkeeping(() => this.storage.updateKeyStatus(selectedKey.id, 'invalid', 0, '401 Unauthorized from upstream'));
          }
          if (statusCode === 429) {
            const retryAfterMs = parseRetryAfterMs(err.retryAfterHeader, (config.autoCooldownMinutes || 5) * 60000);
            await this.safeBookkeeping(() => this.storage.updateKeyStatus(selectedKey.id, 'rate_limited', Date.now() + retryAfterMs, '429 Too Many Requests'));
            this.circuitBreaker.recordFailure(provider.id, retryAfterMs);
            (selectedKey as any).status = 'rate_limited';
          } else {
            this.circuitBreaker.recordFailure(provider.id);
          }
          await this.safeBookkeeping(() => this.storage.recordLog({
            id: 'log-' + globalThis.crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            clientName: client?.name || 'Public Client',
            providerId: provider.id,
            providerName: provider.name,
            keyMasked: selectedKey.keyPrefix,
            model: request.model,
            mappedModel: resolution.targetModel !== request.model ? resolution.targetModel : undefined,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            durationMs,
            statusCode,
            isStream: false,
            errorMessage: `${statusCode} ${stableErrorCode(statusCode)}`
          }));
          if (statusCode === 429) {
            consecutive429++;
            if (consecutive429 >= 2 || fullKeys.every(k => k.status === 'rate_limited')) break;
          }
          if (statusCode === 404 || statusCode === 400) {
            break;
          }
          if (!isRetryableError(statusCode, err.name === 'AbortError') && statusCode !== 401) {
            throw new GatewayError(statusCode, stableErrorCode(statusCode), statusCode === 429 ? parseRetryAfterMs(err.retryAfterHeader, (config.autoCooldownMinutes || 5) * 60000) : undefined);
          }
          continue;
        }

        const durationMs = Date.now() - startTime;
        const totalTokens = response.usage?.total_tokens || 0;
        this.circuitBreaker.recordSuccess(provider.id);

        // Quota enforcement after a successful upstream call: if the
        // increment is refused, do not return the upstream response.
        if (client) {
          const quotaOk = await this.storage.atomicIncrementClientQuota(client.id, 1, totalTokens);
          if (!quotaOk) {
            throw new GatewayError(429, 'rate_limited');
          }
        }
        await this.safeBookkeeping(() => this.storage.updateKeyUsage(selectedKey.id, totalTokens, false));
        await this.safeBookkeeping(() => this.storage.recordLog({
          id: 'log-' + globalThis.crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          clientName: client?.name || 'Public Client',
          providerId: provider.id,
          providerName: provider.name,
          keyMasked: selectedKey.keyPrefix,
          model: request.model,
          mappedModel: resolution.targetModel !== request.model ? resolution.targetModel : undefined,
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens,
          durationMs,
          statusCode: 200,
          isStream: false
        }));
        return { type: 'json', response };
      }
    }

    // If all providers & keys exhausted: an explicit no-key / cooling
    // error is more actionable than a generic 502, and carries its
    // Retry-After when it is a cooling error.
    if (lastError instanceof GatewayError && (
      lastError.message.startsWith('no_key_configured') ||
      lastError.message.startsWith('all_keys_cooling') ||
      lastError.message.startsWith('no_available_key')
    )) {
      throw lastError;
    }
    const finalStatus = lastError instanceof UpstreamHttpError ? lastError.statusCode : 502;
    if (finalStatus === 404) {
      throw new GatewayError(404, `model_not_found: ${request.model}`);
    }
    throw new GatewayError(
      finalStatus === 429 ? 429 : 502,
      stableErrorCode(finalStatus),
      finalStatus === 429 && lastError?.retryAfterHeader ? parseRetryAfterMs(lastError.retryAfterHeader, (config.autoCooldownMinutes || 5) * 60000) : undefined
    );
  }

  /**
   * SSRF-safe URL validation for provider testing
   */
  static validateSafeUrl(urlStr: string): { safe: boolean; error?: string } {
    return safeUrlChecker(urlStr);
  }
}

export class GatewayError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'GatewayError';
  }
}
