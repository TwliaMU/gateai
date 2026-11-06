import type { NormalizedStreamChunk } from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/**
 * Format a NormalizedStreamChunk as OpenAI SSE line:
 * data: {...}\n\n
 */
export function formatOpenAiSseChunk(
  id: string,
  model: string,
  content = '',
  finishReason: string | null = null,
  toolCalls?: any[],
  usage?: any
): Uint8Array {
  const chunk: NormalizedStreamChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: content ? 'assistant' : undefined,
          content: content || undefined,
          tool_calls: toolCalls
        },
        finish_reason: finishReason
      }
    ],
    usage
  };

  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

/**
 * Format the terminal SSE chunk:
 * data: [DONE]\n\n
 */
export function formatDoneSseChunk(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

/**
 * Robust SSE Stream Reader that handles chunk boundary splitting and multi-line data
 */
export async function* iterateSseLines(readable: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = readable.getReader();
  let buffer = '';
  let lineCapWarned = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Cap a single SSE line at 1MB: an unbounded line (long tool call
      // / reasoning) must not grow the buffer without limit.
      if (buffer.length > 1024 * 1024) {
        const nl = buffer.indexOf('\n');
        buffer = nl >= 0 ? buffer.slice(nl + 1) : '';
        if (!lineCapWarned) { lineCapWarned = true; console.warn('[SSE] Dropped an over-long (>1MB) SSE line'); }
      }
      const lines = buffer.split('\n');
      // Keep the last incomplete fragment in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Keep-alive or comment line, skip
          continue;
        }
        if (trimmed.startsWith('data:')) {
          yield trimmed.substring(5).trim();
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      yield buffer.trim().substring(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}
