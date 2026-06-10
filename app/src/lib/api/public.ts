// public.ts —— app 对 backend public 协议的入口；复用 @standmeet/sdk-core
// 的客户端，把 Next 特有的 baseURL 判断（SSR vs 浏览器）放在工厂里。
// dogfood：app 自己跑 SDK，证明 SDK 真好用。
//
// 重要：这层只暴露薄薄的"已配 baseURL 的 client + 兼容 re-export"。组件
// 不直接 import @standmeet/sdk-core，统一从这里走以便日后再调整。

import { createClient } from '@standmeet/sdk-core';

import { TreeResponseSchema, type TreeNode } from '@/lib/corpus/tree';
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
  SessionMode,
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
  member_id?: string;
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

// CodeIntro —— 名字选择器 pre-issue 拿的 code 介绍(greeting + 名字上限/已用)。
const CodeIntroSchema = z.object({
  label: z.string(),
  greeting: z.string(),
  max_members: z.number(),
  member_count: z.number(),
});
export type CodeIntro = z.infer<typeof CodeIntroSchema>;

// fetchCodeIntro —— code 走 body(不入 URL log)。坏码 / 网络挂 / 形状不对 →
// null,picker 优雅回落(只显默认表单)。
export async function fetchCodeIntro(code: string): Promise<CodeIntro | null> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/codes/intro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const parsed = CodeIntroSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// 会话聚合读模型(GET /conversations/<id>)。概念三层 code → session →
// conversation,凭 session token 找到 conversation。前端载入时一次性 hydrate。
const GhostSchema = z.object({ text: z.string(), selected: z.boolean() });
const DialogCitationSchema = z.object({
  genre: z.enum(['wiki', 'output']),
  path: z.string(),
  title: z.string(),
});
const ToolCallSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  result: z.unknown(),
});
const AggDialogSchema = z.object({
  created_at: z.string(),
  question: z.string(),
  answer: z.string(),
  ghosts: z.array(GhostSchema),
  citations: z.array(DialogCitationSchema),
  tool_calls: z.array(ToolCallSchema),
});
const ViewSchema = z.object({
  session: z.object({
    visitor_name: z.string(),
    code: z.object({
      max_turns_per_session: z.number(),
      max_members: z.number(),
      member_count: z.number(),
    }),
  }),
  conversation: z.object({
    dialogs: z.array(AggDialogSchema),
    started_at: z.string(),
    ended_at: z.string().nullable().optional(),
    ended: z.boolean(),
    has_summary: z.boolean(),
  }),
});
export type DialogCitation = z.infer<typeof DialogCitationSchema>;
export type AggDialog = z.infer<typeof AggDialogSchema>;

// VisitorView —— 端点解析后的 camelCase 形态。session(身份+code 配额)+
// conversation(dialogs / ended / summary)。count 由 dialogs.length 派生,不带
// 单独字段。
export interface VisitorView {
  visitorName: string;
  maxTurns: number;
  maxMembers: number;
  memberCount: number;
  dialogs: AggDialog[];
  ended: boolean;
  hasSummary: boolean;
}

// ConversationResult —— 三态:活着 / 失效(401/403,要重进)/ 抖动(保持现状)。
// dead session 不能当空历史悄悄吞 —— 得清 stale 身份、按有没有 code 回入口。
export type ConversationResult =
  | { status: 'ok'; view: VisitorView }
  | { status: 'invalid' }
  | { status: 'error' };

// fetchConversation —— 凭 session token 拉会话聚合(GET /conversations/<id>)。
// 401/403 = token 失效(过期 / 实例重置 / 撤销)→ 'invalid';其它非 2xx / 网络挂
// / 形状不对 → 'error'(保持现状不崩)。
export async function fetchConversation(
  conversationID: string, sessionToken: string,
): Promise<ConversationResult> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/conversations/${conversationID}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.status === 401 || res.status === 403) return { status: 'invalid' };
    if (!res.ok) return { status: 'error' };
    const parsed = ViewSchema.safeParse(await res.json());
    return parsed.success
      ? { status: 'ok', view: toView(parsed.data) }
      : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

function toView(d: z.infer<typeof ViewSchema>): VisitorView {
  return {
    visitorName: d.session.visitor_name,
    maxTurns: d.session.code.max_turns_per_session,
    maxMembers: d.session.code.max_members,
    memberCount: d.session.code.member_count,
    dialogs: d.conversation.dialogs,
    ended: d.conversation.ended,
    hasSummary: d.conversation.has_summary,
  };
}

// VisitorDoc —— 锁屏页凭 visitor session 走 corpus_read 取回的被引文档全文。
const VisitorDocSchema = z.object({
  ok: z.boolean(),
  result: z.object({ body: z.string(), title: z.string() }),
});
export interface VisitorDoc { title: string; body: string }

// fetchVisitorDoc —— 公开 landing 锁屏时,凭访客 session(token + 自己的
// conversation)走 corpus_read 按 path 取被引文档。ACL 由后端按 role 评估:
// 授了就回全文,没授 / 无 session → null(留锁屏)。
export async function fetchVisitorDoc(
  conversationID: string, sessionToken: string, path: string,
): Promise<VisitorDoc | null> {
  try {
    const res = await fetch(
      `${baseURL()}/api/v1/sessions/${conversationID}/tools/corpus_read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ path }),
      },
    );
    if (!res.ok) return null;
    const parsed = VisitorDocSchema.safeParse(await res.json());
    return parsed.success && parsed.data.ok && parsed.data.result.body !== ''
      ? { title: parsed.data.result.title, body: parsed.data.result.body }
      : null;
  } catch {
    return null;
  }
}

// fetchWikiTree —— GET /api/v1/wiki-tree[?parent=ID] 的一层。token 非空带
// Bearer(走 code 的 role scope);否则匿名(只 seo_indexed)。ACL 在后端评估,
// 不在 scope 的条目整条不返。坏响应 / 网络挂 → []。逻辑薄,组件只 render。
export async function fetchWikiTree(parentID: string, token: string): Promise<TreeNode[]> {
  try {
    const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`${baseURL()}/api/v1/wiki-tree${qs}`, { headers, cache: 'no-store' });
    if (!res.ok) return [];
    const parsed = TreeResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.nodes : [];
  } catch {
    return [];
  }
}

export const issuePublicSession = () => client().issueSession({ mode: 'public' });
export const issueCodeSession = (input: IssueCodeSessionInput) =>
  client().issueSession({ ...input, mode: 'code' });
export const issueBYOAISession = (input: IssueBYOAISessionInput) =>
  client().issueSession({ ...input, mode: 'byoai' });

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

// BacklinkRef —— /writings/<slug> "linked from" section 的一条 backlink。后端
// 渲染时收集，源 writing 必须 published。
const BacklinkRefSchema = z.object({ slug: z.string(), title: z.string() });
export type BacklinkRef = z.infer<typeof BacklinkRefSchema>;

const WritingViewSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), excerpt: z.string(),
  body_md: z.string(), cover_headline: z.string(), cover_sub: z.string(),
  cover_hue: z.enum(['amber', 'violet', 'acid']),
  cover_image_asset_id: z.string().optional(),
  tags: z.array(z.string()), visibility: z.enum(['public', 'private']),
  cross_refs: z.array(z.string()), path: z.string(), read_minutes: z.number(),
  locked_body: z.string().optional(), published_at: z.string().optional(),
  asset_urls: z.record(z.string(), z.string()).optional(),
  backlinks: z.array(BacklinkRefSchema).optional(),
});
export type WritingView = z.infer<typeof WritingViewSchema>;

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

async function fetchJSONSchema<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(baseURL() + path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return safeJson(res, schema);
}

const WritingsPageSchema = z.object({
  writings: z.array(WritingViewSchema), next_cursor: z.string().optional(),
});

export const fetchWritingsPage = (cursor?: string, limit?: number) => {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const suffix = qs.toString() ? '?' + qs.toString() : '';
  return fetchJSONSchema('/api/v1/writings' + suffix, WritingsPageSchema);
};

export const fetchWriting = (slug: string) =>
  fetchJSONSchema('/api/v1/writings/' + encodeURIComponent(slug), WritingViewSchema);
