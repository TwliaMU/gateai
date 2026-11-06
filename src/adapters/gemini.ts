import type { ProviderAdapter, HealthCheckResult } from './base.js';
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  ProviderRecord,
  ChatMessage
} from '../core/types.js';
import { formatOpenAiSseChunk, formatDoneSseChunk, iterateSseLines } from '../core/sse.js';

export class GeminiAdapter implements ProviderAdapter {
  constructor(public readonly provider: ProviderRecord) {}

  private transformMessagesToGemini(messages: ChatMessage[]): {
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: Array<{ role: string; parts: any[] }>;
  } {
    let systemText = '';
    const contents: Array<{ role: string; parts: any[] }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        systemText = systemText ? `${systemText}\n\n${text}` : text;
      } else {
        const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
        let parts: any[] = [];

        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              parts.push({ text: part.text });
            } else if (part.type === 'image_url' && part.image_url?.url) {
              const url = part.image_url.url;
              if (url.startsWith('data:')) {
                const [header, base64] = url.split(',');
                const mimeType = header.split(';')[0].replace('data:', '');
                parts.push({ inlineData: { mimeType, data: base64 } });
              }
            }
          }
        }

        if (parts.length === 0) {
          parts.push({ text: '' });
        }

        contents.push({ role: geminiRole, parts });
      }
    }

    return {
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }]
    };
  }

  async chat(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<NormalizedChatResponse> {
    const { systemInstruction, contents } = this.transformMessagesToGemini(request.messages);
    const model = request.model.replace(/^models\//, '');
    const url = `${this.provider.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const bodyPayload: any = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        topP: request.top_p,
        maxOutputTokens: request.max_tokens
      }
    };
    if (systemInstruction) {
      bodyPayload.systemInstruction = systemInstruction;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (downstreamSignal) {
      if (downstreamSignal.aborted) controller.abort();
      else downstreamSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
        redirect: 'manual'
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new UpstreamHttpError(resp.status, errText, resp.headers.get('Retry-After'));
      }

      const data = await resp.json() as any;
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';

      const promptTokens = data.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

      return {
        id: 'chatcmpl-' + Math.random().toString(36).substring(2, 11),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text
            },
            finish_reason: candidate?.finishReason === 'STOP' ? 'stop' : (candidate?.finishReason?.toLowerCase() || 'stop')
          }
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      };
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
    const { systemInstruction, contents } = this.transformMessagesToGemini(request.messages);
    const model = request.model.replace(/^models\//, '');
    const url = `${this.provider.baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

    const bodyPayload: any = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        topP: request.top_p,
        maxOutputTokens: request.max_tokens
      }
    };
    if (systemInstruction) {
      bodyPayload.systemInstruction = systemInstruction;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(bodyPayload),
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
      throw new Error('Gemini upstream response body is null');
    }

    const reqId = 'chatcmpl-' + Math.random().toString(36).substring(2, 11);
    const upstreamBody = resp.body;

    const upstreamController = controller;
    const onDownstreamAbort = () => upstreamController.abort();
    if (downstreamSignal) {
      if (downstreamSignal.aborted) upstreamController.abort();
      else downstreamSignal.addEventListener('abort', onDownstreamAbort, { once: true });
    }
    return new ReadableStream<Uint8Array>({
      async start(streamController) {
        clearTimeout(timer);
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        // Stall timeout is 20s, separate from the overall timeout.
        const resetStallTimer = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            upstreamController.abort();
            streamController.error(new Error('Upstream stream stalled'));
          }, 20000);
        };
        let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
        resetStallTimer();
        try {
          for await (const rawLine of iterateSseLines(upstreamBody)) {
            resetStallTimer();
            if (!rawLine) continue;
            try {
              const parsed = JSON.parse(rawLine);
              if (parsed.usageMetadata) {
                const pt = parsed.usageMetadata.promptTokenCount || 0;
                const ct = parsed.usageMetadata.candidatesTokenCount || 0;
                if (pt + ct > 0) lastUsage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct };
              }
              const candidate = parsed.candidates?.[0];
              const textChunk = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';

              if (textChunk) {
                const openAiChunk = formatOpenAiSseChunk(reqId, request.model, textChunk, null);
                streamController.enqueue(openAiChunk);
              }

              if (candidate?.finishReason) {
                const finalChunk = formatOpenAiSseChunk(
                  reqId,
                  request.model,
                  '',
                  candidate.finishReason === 'STOP' ? 'stop' : candidate.finishReason.toLowerCase()
                );
                streamController.enqueue(finalChunk);
              }
            } catch {
              // Ignore non-json or fragmented SSE lines
            }
          }

          if (stallTimer) clearTimeout(stallTimer);
          // Emit a usage chunk before [DONE] so the gateway can tally
          // Gemini stream tokens (previously always recorded as 0).
          if (lastUsage) streamController.enqueue(formatOpenAiSseChunk(reqId, request.model, '', null, undefined, lastUsage));
          streamController.enqueue(formatDoneSseChunk());
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
      }
    });
  }

  async models(apiKey: string, timeoutMs: number): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${this.provider.baseUrl}/v1beta/models`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal,
        redirect: 'manual'
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.models || []).map((m: any) => ({
        id: m.name.replace('models/', ''),
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: 'google'
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(apiKey: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.provider.baseUrl}/v1beta/models`, {
        headers: { 'x-goog-api-key': apiKey },
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

export class UpstreamHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    public readonly retryAfterHeader?: string | null
  ) {
    super(`Upstream HTTP ${statusCode}: ${responseBody.slice(0, 300)}`);
    this.name = 'UpstreamHttpError';
  }
}
