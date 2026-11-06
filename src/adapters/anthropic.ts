import type { ProviderAdapter, HealthCheckResult } from './base.js';
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  ProviderRecord,
  ChatMessage
} from '../core/types.js';
import { formatOpenAiSseChunk, formatDoneSseChunk, iterateSseLines } from '../core/sse.js';
import { UpstreamHttpError } from './gemini.js';

export class AnthropicAdapter implements ProviderAdapter {
  constructor(public readonly provider: ProviderRecord) {}

  private transformToAnthropic(request: NormalizedChatRequest): {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    max_tokens: number;
  } {
    let system = '';
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        system = system ? `${system}\n\n${text}` : text;
      } else {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        messages.push({ role, content: text });
      }
    }

    return {
      system: system || undefined,
      messages: messages.length > 0 ? messages : [{ role: 'user', content: '' }],
      max_tokens: request.max_tokens || 4096
    };
  }

  async chat(
    request: NormalizedChatRequest,
    apiKey: string,
    timeoutMs: number,
    downstreamSignal?: AbortSignal
  ): Promise<NormalizedChatResponse> {
    const { system, messages, max_tokens } = this.transformToAnthropic(request);
    const url = `${this.provider.baseUrl.replace(/\/+$/, '')}/v1/messages`;
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
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: request.model,
          system,
          messages,
          max_tokens,
          temperature: request.temperature
        }),
        signal: controller.signal,
        redirect: 'manual'
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new UpstreamHttpError(resp.status, errText, resp.headers.get('Retry-After'));
      }

      const data = await resp.json() as any;
      const text = data.content?.map((c: any) => c.text || '').join('') || '';

      return {
        id: data.id || ('chatcmpl-' + Math.random().toString(36).substring(2, 11)),
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
            finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason || 'stop')
          }
        ],
        usage: {
          prompt_tokens: data.usage?.input_tokens || 0,
          completion_tokens: data.usage?.output_tokens || 0,
          total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
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
    const { system, messages, max_tokens } = this.transformToAnthropic(request);
    const url = `${this.provider.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: request.model,
        system,
        messages,
        max_tokens,
        temperature: request.temperature,
        stream: true
      }),
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
      throw new Error('Anthropic upstream body is null');
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
        let usageInput = 0;
        let usageOutput = 0;
        let usageSent = false;
        const sendUsage = () => {
          if (usageSent || usageInput + usageOutput <= 0) return;
          usageSent = true;
          streamController.enqueue(formatOpenAiSseChunk(reqId, request.model, '', null, undefined, {
            prompt_tokens: usageInput, completion_tokens: usageOutput, total_tokens: usageInput + usageOutput
          }));
        };
        resetStallTimer();
        try {
          for await (const rawLine of iterateSseLines(upstreamBody)) {
            resetStallTimer();
            if (!rawLine) continue;
            try {
              const event = JSON.parse(rawLine);
              if (event.type === 'message_start' && event.usage?.input_tokens) usageInput = event.usage.input_tokens;
              if (event.type === 'message_delta' && event.usage?.output_tokens) usageOutput = event.usage.output_tokens;
              if (event.type === 'message_stop') sendUsage();
              if (event.type === 'content_block_delta' && event.delta?.text) {
                streamController.enqueue(formatOpenAiSseChunk(reqId, request.model, event.delta.text, null));
              } else if (event.type === 'message_delta') {
                const finish = event.delta?.stop_reason === 'end_turn' ? 'stop' : (event.delta?.stop_reason || 'stop');
                streamController.enqueue(formatOpenAiSseChunk(reqId, request.model, '', finish));
              }
            } catch {
              // ignore unparseable events
            }
          }

          if (stallTimer) clearTimeout(stallTimer);
          // Usage on message_stop is emitted in-loop; this covers a
          // stream that ends without it (previously always 0 tokens).
          sendUsage();
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

  async models(_apiKey: string, _timeoutMs: number): Promise<ModelInfo[]> {
    return [
      { id: 'claude-3-7-sonnet-20250219', object: 'model', created: 1740000000, owned_by: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1730000000, owned_by: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', object: 'model', created: 1730000000, owned_by: 'anthropic' },
      { id: 'claude-3-opus-20240229', object: 'model', created: 1709000000, owned_by: 'anthropic' }
    ];
  }

  async healthCheck(apiKey: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Light test call
      const resp = await fetch(`${this.provider.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        redirect: 'manual',
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
      const latencyMs = Date.now() - start;
      return {
        success: resp.ok || resp.status === 400, // 400 means token is valid and api reached
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
