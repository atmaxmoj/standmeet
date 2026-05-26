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

import { readSSE } from './sse.js';
import type {
  PublicPageView,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SessionTier,
  SSEEvent,
} from './types.js';

// ClientOptions —— createClient 的入参。baseURL 默认空串。
export interface ClientOptions {
  baseURL?: string;
  fetchImpl?: typeof fetch;
}

// IssueSessionInput —— 三档访问 tier 统一入参。tier 决定哪些字段是必需的：
//   public —— 无字段
//   code   —— code (+ visitor_name optional)
//   byoai  —— byoai_provider（key / endpoint / model 不上传 server；browser
//             自己 vault 保管，chat header 里走）
export interface IssueSessionInput {
  tier: SessionTier;
  code?: string;
  visitor_name?: string;
  byoai_provider?: string;
}

// BYOAIHeaders —— streamMessage 在 tier=byoai 时透传 4 个 header（**全部必填**，
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
  if (!res.ok) throw new Error(`issue session: ${res.status}`);
  return (await res.json()) as PublicSessionResponse;
}

async function* streamMessage(
  f: typeof fetch, baseURL: string,
  conversationID: string, sessionToken: string, content: string,
  byoai?: BYOAIHeaders,
): AsyncGenerator<SSEEvent, void, unknown> {
  const res = await f(`${baseURL}/api/v1/sessions/${conversationID}/messages`, {
    method: 'POST',
    headers: buildMessageHeaders(sessionToken, byoai),
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`send message: ${res.status}`);
  yield* readSSE(res.body);
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
