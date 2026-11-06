import type { ProviderAdapter, HealthCheckResult } from './base.js';
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  ProviderRecord
} from '../core/types.js';
import { UpstreamHttpError } from './gemini.js';

export class OpenAIAdapter implements ProviderAdapter {
  constructor(public readonly provider: ProviderRecord) {}

  protected getAuthHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (this.provider.authHeaderFormat) {
      case 'x-api-key':
        headers['x-api-key'] = apiKey;
        break;
      case 'custom-header':
        headers[this.provider.authHeaderName || 'Authorization'] = apiKey;
        break;
      case 'bearer':
      default:
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
    }

    return headers;
  }

  async chat(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<NormalizedChatResponse> {
    const url = `${this.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (downstreamSignal) {
      if (downstreamSignal.aborted) controller.abort();
      else downstreamSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(apiKey),
        body: JSON.stringify({ ...request, stream: false }),
        signal: controller.signal,
        redirect: 'manual'
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new UpstreamHttpError(resp.status, errText, resp.headers.get('Retry-After'));
      }

      const data = await resp.json() as NormalizedChatResponse;
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async stream(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(apiKey),
      body: JSON.stringify({ ...request, stream: true }),
      signal: controller.signal,
        redirect: 'manual'
    });

    if (!resp.ok) {
      clearTimeout(timer);
      const errText = await resp.text().catch(() => '');
      throw new UpstreamHttpError(resp.status, errText, resp.headers.get('Retry-After'));
    }

    if (!resp.body) {
      clearTimeout(timer);
      throw new Error('Upstream response body is null');
    }

    // Wrap the upstream body: a stall timeout that resets on every chunk,
    // and downstream abort propagation. A mid-stream error errors the
    // stream instead of silently truncating it.
    clearTimeout(timer);
    const upstreamBody = resp.body;
    const upstreamController = controller;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    // Stall timeout is 20s, separate from the overall timeout.
    const resetStallTimer = (streamController: ReadableStreamDefaultController<Uint8Array>) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        upstreamController.abort();
        streamController.error(new Error('Upstream stream stalled'));
      }, 20000);
    };
    const onDownstreamAbort = () => upstreamController.abort();
    if (downstreamSignal) {
      if (downstreamSignal.aborted) upstreamController.abort();
      else downstreamSignal.addEventListener('abort', onDownstreamAbort, { once: true });
    }
    return new ReadableStream<Uint8Array>({
      async start(streamController) {
        const reader = upstreamBody.getReader();
        let seenDone = false;
        const doneEncoder = new TextEncoder();
        resetStallTimer(streamController);
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              resetStallTimer(streamController);
              // OpenAI-compatible upstreams normally emit [DONE]; strict
              // clients hang without it, so synthesise one on clean close.
              try { if (new TextDecoder().decode(value).includes('[DONE]')) seenDone = true; } catch {}
              streamController.enqueue(value);
            }
          }
          if (stallTimer) clearTimeout(stallTimer);
          if (!seenDone) streamController.enqueue(doneEncoder.encode('data: [DONE]\n\n'));
          streamController.close();
        } catch (err) {
          if (stallTimer) clearTimeout(stallTimer);
          streamController.error(err);
        } finally {
          if (downstreamSignal) downstreamSignal.removeEventListener('abort', onDownstreamAbort);
        }
      },
      cancel() {
        upstreamController.abort();
        if (stallTimer) clearTimeout(stallTimer);
      }
    });
  }

  async models(apiKey: string, timeoutMs: number): Promise<ModelInfo[]> {
    const url = `${this.provider.baseUrl.replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        headers: this.getAuthHeaders(apiKey),
        signal: controller.signal,
        redirect: 'manual'
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      if (Array.isArray(data.data)) {
        return data.data.map((m: any) => ({
          id: m.id,
          object: 'model' as const,
          created: m.created || Math.floor(Date.now() / 1000),
          owned_by: m.owned_by || this.provider.id
        }));
      }
      return [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(apiKey: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.provider.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: this.getAuthHeaders(apiKey),
        redirect: 'manual'
      });
      const latencyMs = Date.now() - start;
      return {
        success: resp.ok,
        statusCode: resp.status,
        latencyMs,
        message: resp.ok ? `Connected (${latencyMs}ms)` : `HTTP ${resp.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        statusCode: 0,
        latencyMs: Date.now() - start,
        message: err.message || 'Connection failed'
      };
    }
  }
}
