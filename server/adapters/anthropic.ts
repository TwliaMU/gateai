import type { Response } from 'express';
import type { OpenAiChatRequest } from './gemini.js';

export async function proxyToAnthropic(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  body: OpenAiChatRequest;
  res: Response;
  signal?: AbortSignal;
}): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
  const { apiKey, baseUrl, model, body, res, signal } = params;
  const isStream = Boolean(body.stream);

  let systemPrompt = '';
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of body.messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + text;
    } else {
      anthropicMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: text
      });
    }
  }

  const payload: any = {
    model,
    messages: anthropicMessages,
    max_tokens: body.max_completion_tokens || body.max_tokens || 4096,
    stream: isStream
  };

  if (systemPrompt) {
    payload.system = systemPrompt;
  }
  if (body.temperature !== undefined) {
    payload.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    payload.top_p = body.top_p;
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      parsed = { error: { message: errorText } };
    }
    const err = new Error(parsed?.error?.message || `Anthropic API error: ${response.status}`);
    (err as any).statusCode = response.status;
    (err as any).body = parsed;
    throw err;
  }

  const completionId = 'chatcmpl-' + Math.random().toString(36).substring(2, 12);
  const created = Math.floor(Date.now() / 1000);

  if (!isStream) {
    const data: any = await response.json();
    const content = data.content?.[0]?.text || '';
    const promptTokens = data.usage?.input_tokens || 0;
    const completionTokens = data.usage?.output_tokens || 0;

    res.json({
      id: completionId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content
          },
          finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason || 'stop')
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    });

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };
  }

  // Streaming SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let promptTokens = 0;
  let completionTokens = 0;

  if (!response.body) {
    throw new Error('Anthropic response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.type === 'message_start' && parsed.message?.usage) {
          promptTokens = parsed.message.usage.input_tokens || promptTokens;
        } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          const textDelta = parsed.delta.text;
          const openAiChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  content: textDelta
                },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
        } else if (parsed.type === 'message_delta' && parsed.usage) {
          completionTokens = parsed.usage.output_tokens || completionTokens;
        }
      } catch {
        // ignore incomplete chunk
      }
    }
  }

  const finalChunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };
  res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}
