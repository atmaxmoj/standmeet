// public.ts —— public API client：
// - GET /api/v1/page/:handle —— SSR fetch page content
// - POST /api/v1/sessions —— issue visitor session（M7 走 public tier）
// - POST /api/v1/sessions/:id/messages —— send + 接 SSE
//
// 不走第三方 HTTP 库，原生 fetch 够用；SSE 自己读 ReadableStream。
//
// 这层只负责"线上协议 → typed shape"。UI 层和 hook 不直接碰 JSON。

export type PageProject = {
  id: string;
  name: string;
  tagline: string;
  lines: string[];
  url?: string | null;
};

export type PageInsight = {
  id: string;
  thesis: string;
  context: string;
  body: string;
};

export type PageWhere = {
  location_line: string;
  status_prose: string;
  closing: string;
  looking_for: string[];
};

export type PageContact = {
  email: string;
  chat_line: string;
  recruiter_prose: string;
  casual_prose: string;
};

export type PageContent = {
  updated_at: string;
  owner_id: string;
  hero_prose: string;
  hero_examples: string[];
  insights: PageInsight[];
  projects: PageProject[];
  where: PageWhere;
  contact: PageContact;
};

export type PublicOwnerView = {
  handle: string;
  full_name: string;
  location: string;
};

export type PublicPageView = {
  owner: PublicOwnerView;
  content: PageContent;
};

export type PublicSessionResponse = {
  session_token: string;
  conversation_id: string;
  owner_handle: string;
  included_tags: string[];
  excluded_tags: string[];
};

export type SSEEvent =
  | { kind: 'token'; text: string }
  | { kind: 'done'; cited_wiki_ids: string[] }
  | { kind: 'error'; code: string; message: string };

// 默认 BASE_URL：服务端组件走 BACKEND_URL（容器网络名 backend:8000），
// 客户端组件走相对路径（经过 Next rewrites 转给后端）。
function backendBaseURL(): string {
  if (typeof window === 'undefined') {
    return process.env['BACKEND_URL'] ?? 'http://backend:8000';
  }
  return '';
}

export async function fetchPublicPage(handle: string): Promise<PublicPageView> {
  const res = await fetch(`${backendBaseURL()}/api/v1/page/${handle}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`fetch page ${handle}: ${res.status}`);
  }
  return res.json() as Promise<PublicPageView>;
}

export async function issuePublicSession(handle: string): Promise<PublicSessionResponse> {
  const res = await fetch(`/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, tier: 'public' }),
  });
  if (!res.ok) {
    throw new Error(`issue session: ${res.status}`);
  }
  return res.json() as Promise<PublicSessionResponse>;
}

// streamChatMessage —— 发一条消息，迭代 SSE event。返回 AsyncGenerator
// 让 caller 用 for-await-of 消费。caller 决定如何把 token 累加 + 怎么处理 done。
export async function* streamChatMessage(
  conversationID: string,
  sessionToken: string,
  content: string,
): AsyncGenerator<SSEEvent, void, unknown> {
  const res = await fetch(`/api/v1/sessions/${conversationID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`send message: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const ev of drainSSEBlocks(buf.split('\n\n'))) {
      yield ev;
    }
    const lastBoundary = buf.lastIndexOf('\n\n');
    if (lastBoundary !== -1) {
      buf = buf.slice(lastBoundary + 2);
    }
  }
}

// drainSSEBlocks —— 把 split('\n\n') 出来的字符串块解析成 SSEEvent 数组。
// 最后一块通常是不完整 partial（没 \n\n 终止），跳过让下一轮重试。
function* drainSSEBlocks(blocks: string[]): Generator<SSEEvent, void, unknown> {
  for (let i = 0; i < blocks.length - 1; i++) {
    const ev = parseSSEBlock(blocks[i] ?? '');
    if (ev) yield ev;
  }
}

function parseSSEBlock(block: string): SSEEvent | null {
  let event = '';
  let dataRaw = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataRaw += line.slice(6);
  }
  if (!event) return null;
  try {
    const data = JSON.parse(dataRaw) as Record<string, unknown>;
    return buildSSEEvent(event, data);
  } catch {
    // malformed JSON in data line —— skip silently；上层超时会兜住。
    return null;
  }
}

function buildSSEEvent(event: string, data: Record<string, unknown>): SSEEvent | null {
  if (event === 'token') {
    return { kind: 'token', text: stringField(data, 'text') };
  }
  if (event === 'done') {
    const v = data['cited_wiki_ids'];
    const cited = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return { kind: 'done', cited_wiki_ids: cited };
  }
  if (event === 'error') {
    return {
      kind: 'error',
      code: stringField(data, 'code') || 'unknown',
      message: stringField(data, 'message'),
    };
  }
  return null;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}
