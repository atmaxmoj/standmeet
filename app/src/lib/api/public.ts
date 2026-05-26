// public.ts —— app 对 backend public 协议的入口；复用 @standmeet/sdk-core
// 的客户端，把 Next 特有的 baseURL 判断（SSR vs 浏览器）放在工厂里。
// dogfood：app 自己跑 SDK，证明 SDK 真好用。
//
// 重要：这层只暴露薄薄的"已配 baseURL 的 client + 兼容 re-export"。组件
// 不直接 import @standmeet/sdk-core，统一从这里走以便日后再调整。

import { createClient } from '@standmeet/sdk-core';
import type {
  BYOAIHeaders,
  IssueSessionInput,
  StandMeetClient,
  SSEEvent,
} from '@standmeet/sdk-core';

export type {
  BYOAIHeaders,
  PageProject,
  PageInsight,
  PageWhere,
  PageContact,
  PageContent,
  PublicOwnerView,
  PublicPageView,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SSEEvent,
  SessionTier,
} from '@standmeet/sdk-core';

// 客户端 / SSR baseURL 切换：服务端组件走容器网络 backend:8000，浏览器走
// 相对路径（Next rewrites 转给后端）。集中一个工厂，避免每个调用点重判。
function baseURL(): string {
  if (typeof window === 'undefined') {
    return process.env['BACKEND_URL'] ?? 'http://backend:8000';
  }
  return '';
}

function client(): StandMeetClient {
  return createClient({ baseURL: baseURL() });
}

// v1 单 owner instance —— session 入参不带 handle。
export interface IssueCodeSessionInput {
  code: string;
  visitor_name?: string;
}

// BYOAI key / endpoint / model 不再在 server 落任何层；session 只 send
// provider 名做 conversation audit。明文 key + endpoint + model 进 browser
// vault (lib/gate/byoai-vault.ts)；每次 chat 时用 session_token 派生 AES key、
// AES-GCM 信封塞 X-BYOAI-Key header，endpoint / model 走另两个 header。
export interface IssueBYOAISessionInput {
  byoai_provider: string;
}

export const fetchPublicPage = () => client().fetchPage();
export const fetchWikiLanding = (slug: string) => client().fetchWikiLanding(slug);
export const fetchOutputLanding = (slug: string) => client().fetchOutputLanding(slug);

export const issuePublicSession = () => client().issueSession({ tier: 'public' });
export const issueCodeSession = (input: IssueCodeSessionInput) =>
  client().issueSession({ ...input, tier: 'code' });
export const issueBYOAISession = (input: IssueBYOAISessionInput) =>
  client().issueSession({ ...input, tier: 'byoai' });

export function streamChatMessage(
  conversationID: string,
  sessionToken: string,
  content: string,
  byoai?: BYOAIHeaders,
): AsyncGenerator<SSEEvent, void, unknown> {
  return client().streamMessage(conversationID, sessionToken, content, byoai);
}

// 一些 caller 还是直接需要 IssueSessionInput（custom-page 在 sdk-react
// useChatSession 里用），re-export 兼容。
export type { IssueSessionInput };

// ─── posts (blog) ────────────────────────────────────────────────────
// SDK 还没接 posts；这里直接走 raw fetch。日后扩 SDK 时移过去保持 dogfood。
//
// body_md 是 GitHub-flavored markdown 原文，render 端用 react-markdown +
// remark-gfm 直渲。不存中间块结构。

export interface PostView {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_headline: string;
  cover_sub: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  cover_image_asset_id?: string;
  tags: string[];
  visibility: 'public' | 'private';
  cross_refs: string[];
  path: string;
  read_minutes: number;
  locked_body?: string;
  published_at?: string;
  asset_urls?: Record<string, string>;
}

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(baseURL() + path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return await res.json() as T;
}

export interface PostsPage {
  posts: PostView[];
  next_cursor?: string;
}

// fetchPostsPage —— /api/v1/posts?cursor=...&limit=...。首次 cursor 空，
// next_cursor 非空就继续加载。infinite scroll 用。
export const fetchPostsPage = (cursor?: string, limit?: number) => {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const suffix = qs.toString() ? '?' + qs.toString() : '';
  return fetchJSON<PostsPage>('/api/v1/posts' + suffix);
};

export const fetchPost = (slug: string) =>
  fetchJSON<PostView>('/api/v1/posts/' + encodeURIComponent(slug));
