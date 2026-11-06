import type { Response } from 'express';

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
}

export function convertOpenAiToGemini(body: OpenAiChatRequest) {
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const msg of body.messages) {
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join('\n');
    }

    if (msg.role === 'system') {
      systemInstruction = {
        parts: [{ text }]
      };
    } else if (msg.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text }]
      });
    } else if (msg.role === 'assistant') {
      contents.push({
        role: 'model',
        parts: [{ text }]
      });
    }
  }

  const generationConfig: Record<string, any> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  const maxToks = body.max_completion_tokens || body.max_tokens;
  if (maxToks !== undefined) generationConfig.maxOutputTokens = maxToks;
  if (body.stop) {
    generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  return {
    systemInstruction,
    contents,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined
  };
}

export async function proxyToGemini(params: {
  apiKey: string;
  model: string;
  body: OpenAiChatRequest;
  res: Response;
  signal?: AbortSignal;
}): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
  const { apiKey, model, body, res, signal } = params;
  const isStream = Boolean(body.stream);
  const geminiPayload = convertOpenAiToGemini(body);

  const action = isStream ? 'streamGenerateContent' : 'generateContent';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(apiKey)}${isStream ? '&alt=sse' : ''}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(geminiPayload),
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
    const err = new Error(parsed?.error?.message || `Gemini API error: ${response.status}`);
    (err as any).statusCode = response.status;
    (err as any).body = parsed;
    throw err;
  }

  const completionId = 'chatcmpl-' + Math.random().toString(36).substring(2, 12);
  const created = Math.floor(Date.now() / 1000);

  if (!isStream) {
    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text || '';
    const finishReason = candidate?.finishReason === 'STOP' ? 'stop' : (candidate?.finishReason?.toLowerCase() || 'stop');

    const promptTokens = data.usageMetadata?.promptTokenCount || Math.ceil(JSON.stringify(body.messages).length / 4);
    const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(content.length / 4);

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
          finish_reason: finishReason
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

  let accumulatedContent = '';
  let promptTokens = Math.ceil(JSON.stringify(body.messages).length / 4);
  let completionTokens = 0;

  if (!response.body) {
    throw new Error('Gemini response body is null');
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
      if (!jsonStr) continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const textDelta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (textDelta) {
          accumulatedContent += textDelta;
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
        }

        if (parsed.usageMetadata) {
          promptTokens = parsed.usageMetadata.promptTokenCount || promptTokens;
          completionTokens = parsed.usageMetadata.candidatesTokenCount || completionTokens;
        }
      } catch {
        // ignore incomplete chunk
      }
    }
  }

  if (completionTokens === 0) {
    completionTokens = Math.ceil(accumulatedContent.length / 4);
  }

  // End of stream chunk
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
