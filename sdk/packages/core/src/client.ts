// client.ts —— createClient 工厂：给定 baseURL 返回一组业务方法。caller
// （Next.js SSR、React app、Web Component embed）只用 client 实例，不
// 自己写 fetch / URL 拼接。
//
// 设计上 client 是无状态轻量对象，每次方法调用都新发 fetch；session token
// 由 caller 自己保存，作为参数传进 streamMessage。
//
// baseURL 为空串时所有请求走相对路径（让 Next rewrites / app proxy
// 透传）；非空时走绝对路径（SSR、Web Component 在第三方域名下）。
//
// v1 单 owner instance —— page / wiki landing / session 等 API 都不带
// handle 参数：sole owner 直接在 server 端 resolve。

import type {
  PublicPageView,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SessionMode,
  SSEEvent,
} from './types.js';

// ClientOptions —— createClient 的入参。baseURL 默认空串。
export interface ClientOptions {
  baseURL?: string;
  fetchImpl?: typeof fetch;
}

// IssueSessionInput —— 三种 session mode 统一入参。mode 决定哪些字段是必需的：
//   public —— 无字段
//   code   —— code (+ visitor_name optional)
//   byoai  —— byoai_provider（key / endpoint / model 不上传 server；browser
//             自己 vault 保管，chat header 里走）
export interface IssueSessionInput {
  mode: SessionMode;
  code?: string;
  visitor_name?: string;
  // member_id —— 上次拿到的 member id;带上凭 id 续会(尤其匿名者),失效后端
  // 自动退到按 visitor_name / 新建。
  member_id?: string;
  byoai_provider?: string;
}

// BYOAIHeaders —— streamMessage 在 mode=byoai 时透传 4 个 header（**全部必填**，
// 缺任一 server 401）：
//   X-BYOAI-Provider —— preset name ('openai' / 'deepseek' / 'custom' / ...)
//   X-BYOAI-Endpoint —— base URL（不带 /v1/... 后缀）
//   X-BYOAI-Model    —— model id
//   X-BYOAI-Key      —— caller 用 session_token HKDF 派生 AES-256 key、AES-GCM
//                       封装 plaintext 后的 base64 (URL-safe no padding)
// SDK 不参与 key 封装；caller 负责。
export interface BYOAIHeaders {
  provider: string;
  endpoint: string;
  model: string;
  wrappedKey: string;
}

// StandMeetClient —— 业务接口。consumer 通过 createClient 拿到的实例
// 满足这个 shape；不直接暴露内部字段。
export interface StandMeetClient {
  fetchPage(): Promise<PublicPageView>;
  fetchWikiLanding(slug: string): Promise<WikiLandingView | null>;
  fetchOutputLanding(slug: string): Promise<OutputLandingView | null>;
  issueSession(input: IssueSessionInput): Promise<PublicSessionResponse>;
  streamMessage(
    conversationID: string,
    sessionToken: string,
    content: string,
    byoai?: BYOAIHeaders,
  ): AsyncGenerator<SSEEvent, void, unknown>;
}

export function createClient(opts: ClientOptions = {}): StandMeetClient {
  const baseURL = opts.baseURL ?? '';
  const f = opts.fetchImpl ?? fetch;
  return {
    fetchPage: () => fetchPage(f, baseURL),
    fetchWikiLanding: (slug) => fetchWikiLanding(f, baseURL, slug),
    fetchOutputLanding: (slug) => fetchOutputLanding(f, baseURL, slug),
    issueSession: (input) => issueSession(f, baseURL, input),
    streamMessage: (id, token, content, byoai) =>
      streamMessage(f, baseURL, id, token, content, byoai),
  };
}

async function fetchPage(f: typeof fetch, baseURL: string): Promise<PublicPageView> {
  const res = await f(`${baseURL}/api/v1/page`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch page: ${res.status}`);
  return (await res.json()) as PublicPageView;
}

async function fetchWikiLanding(
  f: typeof fetch, baseURL: string, slug: string,
): Promise<WikiLandingView | null> {
  const res = await f(`${baseURL}/api/v1/wiki/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch wiki ${slug}: ${res.status}`);
  return (await res.json()) as WikiLandingView;
}

async function fetchOutputLanding(
  f: typeof fetch, baseURL: string, slug: string,
): Promise<OutputLandingView | null> {
  const res = await f(`${baseURL}/api/v1/output/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch output ${slug}: ${res.status}`);
  return (await res.json()) as OutputLandingView;
}

async function issueSession(
  f: typeof fetch, baseURL: string, input: IssueSessionInput,
): Promise<PublicSessionResponse> {
  const res = await f(`${baseURL}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // 把 status + 后端错误 code(member_quota_reached / code_invalid …)挂到 error
    // 上,让前端区分"code 已满"等情形给人话提示。
    const body = (await res.json().catch(() => ({}))) as { code?: unknown };
    throw Object.assign(new Error(`issue session: ${res.status}`), {
      status: res.status,
      code: typeof body.code === 'string' ? body.code : '',
    });
  }
  return (await res.json()) as PublicSessionResponse;
}

// streamMessage —— H.5: POST /api/v1/llm/chat/stream (eino-backed) +
// translate pi unified SSE → {kind:'token',text} events for legacy
// consumers (e.g. admin code-self-test preview). No tool loop; this is
// a single-turn smoke test path.
async function* streamMessage(
  f: typeof fetch, baseURL: string,
  conversationID: string, sessionToken: string, content: string,
  byoai?: BYOAIHeaders,
): AsyncGenerator<SSEEvent, void, unknown> {
  void conversationID; // single LLM call; no conv_id needed
  const res = await f(`${baseURL}/api/v1/llm/chat/stream`, {
    method: 'POST',
    headers: buildMessageHeaders(sessionToken, byoai),
    body: JSON.stringify({
      system: '',
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`send message: ${res.status}`);
  yield* translatePiSSE(res.body);
}

async function* translatePiSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.at(-1) ?? '';
    for (let i = 0; i < parts.length - 1; i++) {
      const ev = parseFrameToToken(parts[i] ?? '');
      if (ev !== null) yield ev;
    }
  }
}

function parseFrameToToken(raw: string): SSEEvent | null {
  let evType = ''; let evData = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) evType = line.slice(7).trim();
    else if (line.startsWith('data: ')) evData = line.slice(6).trim();
  }
  if (evType === 'text') {
    const d = safeParse(evData) as { delta?: string };
    if (d.delta) return { kind: 'token', text: d.delta };
    return null;
  }
  if (evType === 'done') {
    return {
      kind: 'done',
      cited_wiki_ids: [], cited_output_ids: [],
      cited_wiki_refs: [], cited_output_refs: [],
    };
  }
  if (evType === 'error') {
    const d = safeParse(evData) as { message?: string; code?: string };
    return { kind: 'error', code: d.code ?? 'inference_error', message: d.message ?? 'error' };
  }
  return null;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

function buildMessageHeaders(
  sessionToken: string, byoai: BYOAIHeaders | undefined,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
  return byoai
    ? {
      ...base,
      'X-BYOAI-Provider': byoai.provider,
      'X-BYOAI-Endpoint': byoai.endpoint,
      'X-BYOAI-Model': byoai.model,
      'X-BYOAI-Key': byoai.wrappedKey,
    }
    : base;
}
