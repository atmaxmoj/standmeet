// client.ts —— createClient 工厂：给定 baseURL 返回一组业务方法。caller
// （Next.js SSR、React app、Web Component embed）只用 client 实例，不
// 自己写 fetch / URL 拼接。
//
// 设计上 client 是无状态轻量对象，每次方法调用都新发 fetch；session token
// 由 caller 自己保存，作为参数传进 streamMessage。
//
// baseURL 为空串时所有请求走相对路径（让 Next rewrites / app proxy
// 透传）；非空时走绝对路径（SSR、Web Component 在第三方域名下）。

import { readSSE } from './sse.js';
import type {
  PublicPageView,
  WikiLandingView,
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
//   public —— 仅 handle
//   code   —— handle + code (+ visitor_name optional)
//   byoai  —— handle + byoai_provider + byoai_key
export interface IssueSessionInput {
  handle: string;
  tier: SessionTier;
  code?: string;
  visitor_name?: string;
  byoai_provider?: 'anthropic' | 'openai';
  byoai_key?: string;
}

// StandMeetClient —— 业务接口。consumer 通过 createClient 拿到的实例
// 满足这个 shape；不直接暴露内部字段。
export interface StandMeetClient {
  fetchPage(handle: string): Promise<PublicPageView>;
  fetchWikiLanding(handle: string, slug: string): Promise<WikiLandingView | null>;
  issueSession(input: IssueSessionInput): Promise<PublicSessionResponse>;
  streamMessage(
    conversationID: string,
    sessionToken: string,
    content: string,
  ): AsyncGenerator<SSEEvent, void, unknown>;
}

export function createClient(opts: ClientOptions = {}): StandMeetClient {
  const baseURL = opts.baseURL ?? '';
  const f = opts.fetchImpl ?? fetch;
  return {
    fetchPage: (handle) => fetchPage(f, baseURL, handle),
    fetchWikiLanding: (handle, slug) => fetchWikiLanding(f, baseURL, handle, slug),
    issueSession: (input) => issueSession(f, baseURL, input),
    streamMessage: (id, token, content) => streamMessage(f, baseURL, id, token, content),
  };
}

async function fetchPage(
  f: typeof fetch, baseURL: string, handle: string,
): Promise<PublicPageView> {
  const res = await f(`${baseURL}/api/v1/page/${handle}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch page ${handle}: ${res.status}`);
  return (await res.json()) as PublicPageView;
}

async function fetchWikiLanding(
  f: typeof fetch, baseURL: string, handle: string, slug: string,
): Promise<WikiLandingView | null> {
  const res = await f(`${baseURL}/api/v1/wiki/${handle}/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch wiki ${handle}/${slug}: ${res.status}`);
  return (await res.json()) as WikiLandingView;
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
): AsyncGenerator<SSEEvent, void, unknown> {
  const res = await f(`${baseURL}/api/v1/sessions/${conversationID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`send message: ${res.status}`);
  yield* readSSE(res.body);
}
