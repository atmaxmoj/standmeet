// sse.ts —— 解析 backend 发的 text/event-stream 字节流。pure：不知道
// 任何 HTTP 细节，只接 ReadableStream<Uint8Array>，按 SSE 协议吐
// SSEEvent。streamMessages 在 client.ts 里包一层 fetch。

import type {
  SSEEvent,
  SSETokenEvent,
  SSEDoneEvent,
  SSEErrorEvent,
} from './types.js';

// readSSE —— 把一段 ReadableStream<Uint8Array> 转成 SSEEvent 生成器。
// 一个 SSE block 由 \n\n 划界；最后一段 partial 留下次循环继续 buffer。
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    for (let i = 0; i < parts.length - 1; i++) {
      const ev = parseBlock(parts[i] ?? '');
      if (ev) yield ev;
    }
    buf = parts[parts.length - 1] ?? '';
  }
}

function parseBlock(block: string): SSEEvent | null {
  let event = '';
  let dataRaw = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataRaw += line.slice(6);
  }
  if (!event) return null;
  try {
    const data = JSON.parse(dataRaw) as Record<string, unknown>;
    return buildEvent(event, data);
  } catch {
    return null;
  }
}

function buildEvent(event: string, data: Record<string, unknown>): SSEEvent | null {
  switch (event) {
    case 'token':
      return buildToken(data);
    case 'done':
      return buildDone(data);
    case 'error':
      return buildError(data);
    default:
      return null;
  }
}

function buildToken(data: Record<string, unknown>): SSETokenEvent {
  return { kind: 'token', text: strField(data, 'text') };
}

function buildDone(data: Record<string, unknown>): SSEDoneEvent {
  const raw = data['cited_wiki_ids'];
  const cited = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : [];
  return { kind: 'done', cited_wiki_ids: cited };
}

function buildError(data: Record<string, unknown>): SSEErrorEvent {
  return {
    kind: 'error',
    code: strField(data, 'code') || 'unknown',
    message: strField(data, 'message'),
  };
}

function strField(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}
