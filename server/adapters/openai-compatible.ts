import type { Response } from 'express';
import type { ProviderConfig } from '../../src/types/index.js';
import type { OpenAiChatRequest } from './gemini.js';

export async function proxyToOpenAiCompatible(params: {
  provider: ProviderConfig;
  apiKey: string;
  targetModel: string;
  body: OpenAiChatRequest;
  res: Response;
  signal?: AbortSignal;
}): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
  const { provider, apiKey, targetModel, body, res, signal } = params;
  const isStream = Boolean(body.stream);

  const payload = {
    ...body,
    model: targetModel
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // Auth header customization
  if (provider.authHeaderFormat === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider.authHeaderFormat === 'x-api-key') {
    const headerName = provider.authHeaderName || 'x-api-key';
    headers[headerName] = apiKey;
  } else if (provider.authHeaderFormat === 'custom-header') {
    const headerName = provider.authHeaderName || 'Authorization';
    headers[headerName] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }

  let endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  if (provider.authHeaderFormat === 'query-param') {
    endpoint += `?key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
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
    const err = new Error(parsed?.error?.message || `${provider.name} API error: ${response.status}`);
    (err as any).statusCode = response.status;
    (err as any).body = parsed;
    throw err;
  }

  if (!isStream) {
    const data: any = await response.json();
    const promptTokens = data.usage?.prompt_tokens || Math.ceil(JSON.stringify(body.messages).length / 4);
    const completionTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

    res.json(data);

    return {
      promptTokens,
      completionTokens,
      totalTokens
    };
  }

  // Streaming SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let promptTokens = Math.ceil(JSON.stringify(body.messages).length / 4);
  let completionTokens = 0;

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        res.write('\n');
        continue;
      }

      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || promptTokens;
            completionTokens = parsed.usage.completion_tokens || completionTokens;
          } else if (parsed.choices?.[0]?.delta?.content) {
            completionTokens += Math.ceil(parsed.choices[0].delta.content.length / 4);
          }
        } catch {
          // pass-through raw SSE
        }

        res.write(`${trimmed}\n\n`);
      } else {
        res.write(`${trimmed}\n`);
      }
    }
  }

  if (buffer.trim()) {
    res.write(`${buffer}\n\n`);
  }

  res.end();

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}
