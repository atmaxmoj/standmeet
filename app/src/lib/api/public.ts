// public.ts —— app 对 backend public 协议的入口；复用 @standmeet/sdk-core
// 的客户端，把 Next 特有的 baseURL 判断（SSR vs 浏览器）放在工厂里。
// dogfood：app 自己跑 SDK，证明 SDK 真好用。
//
// 重要：这层只暴露薄薄的"已配 baseURL 的 client + 兼容 re-export"。组件
// 不直接 import @standmeet/sdk-core，统一从这里走以便日后再调整。

import { createClient } from '@standmeet/sdk-core';

import {
  EMPTY_TREE_CONTEXT, TreeContextSchema, TreeResponseSchema,
  type TreeContext, type TreeNode,
} from '@/lib/corpus/tree';
import type {
  BYOAIHeaders,
  IssueSessionInput,
  PublicSessionResponse,
  StandMeetClient,
  SSEEvent,
} from '@standmeet/sdk-core';

export type {
  BYOAIHeaders,
  PagePinCard,
  PageWhere,
  PageContact,
  PageContent,
  PublicOwnerView,
  PublicPageView,
  WikiLandingView,
  LanguageOption,
  OutputLandingView,
  PublicSessionResponse,
  SSEEvent,
  SessionMode,
} from '@standmeet/sdk-core';

// 客户端 / SSR baseURL 切换：服务端组件走容器网络 backend:8000，浏览器走
// 相对路径（Next rewrites 转给后端）。集中一个工厂，避免每个调用点重判。
// baseURL —— 客户端走相对路径(Next rewrites 转后端),SSR 走容器网络。booking.ts
// 也复用,故 export。
export function baseURL(): string {
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
  visitor_email?: string; // 可选;进入时填的邮箱 → session profile
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
// fetchWikiLanding —— lang 可选:多语笔记服务端就选好了那一面(SSR 也就有正确的那一份,
// 爬虫和 agent 抓到的是内容本身,不是一段等 JS 的骨架)。
export const fetchWikiLanding = (slug: string, lang?: string) =>
  client().fetchWikiLanding(slug, lang);
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
// ToolCallSchema —— 会话聚合里的一次工具调用。
//
// result **必须是 optional**:F-A-28 起,检索族(corpus_*)的 result 在下发给访客前就被剥掉了
// (那里面是笔记正文,含私有的),只留 name + ok。而 zod v4 里对象内的 `z.unknown()` 是
// **非可选**的 —— 缺这个键会报 `expected nonoptional, received undefined`,于是**整份**聚合
// safeParse 失败,fetchConversation 回 'error',restoreSession 一声不吭地返回,访客刷新后
// 看到的是空白 transcript:自己刚才的整段对话没了。
//
// 非检索工具(booker 报告卡 / summarize / skill_* / ext_*)的 result 照常在,刷新后那些卡要靠它
// 重渲,所以这里不能直接删掉这一格,只能放宽。
const ToolCallSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
});
const AggDialogSchema = z.object({
  created_at: z.string(),
  question: z.string(),
  answer: z.string(),
  ghosts: z.array(GhostSchema),
  citations: z.array(DialogCitationSchema),
  tool_calls: z.array(ToolCallSchema),
});
// ConvEventSchema —— 一条卡上动作的记录。它不是谁说的话,所以不进 dialogs:
// 那边是一问一答的形状,硬塞会把配对弄乱。
const ConvEventSchema = z.object({ created_at: z.string(), text: z.string() });
const ViewSchema = z.object({
  session: z.object({
    visitor_name: z.string(),
    // used_turns —— member 级已用 turn(后端跨该人全部对话求和)。前端 strip 据此
    // 显 used,不再从单 surface 本地 dialogs 数(多对话下会少算)。
    used_turns: z.number().optional().default(0),
    code: z.object({
      max_turns_per_session: z.number(),
      max_members: z.number(),
      member_count: z.number(),
    }),
  }),
  conversation: z.object({
    dialogs: z.array(AggDialogSchema),
    started_at: z.string(),
    // events —— 这段对话里**发生过的事**(访客在卡上取消了会 / 发了确认信)。
    // optional:老实例(还没发这一格)的响应不能因此整份 safeParse 失败,那会
    // 让访客刷新后看见空白 transcript(同 ToolCallSchema.result 那一课)。
    events: z.array(ConvEventSchema).optional().default([]),
  }),
});
export type DialogCitation = z.infer<typeof DialogCitationSchema>;
export type AggDialog = z.infer<typeof AggDialogSchema>;
export type ConvEvent = z.infer<typeof ConvEventSchema>;

// VisitorView —— 端点解析后的 camelCase 形态。session(身份+code 配额)+
// conversation(dialogs / ended / summary)。count 由 dialogs.length 派生,不带
// 单独字段。
export interface VisitorView {
  visitorName: string;
  maxTurns: number;
  usedTurns: number;
  maxMembers: number;
  memberCount: number;
  dialogs: AggDialog[];
  // events —— 刷新之后要折回**模型看的那串消息**,否则卡上取消掉的那场会,
  // 重新打开页面 agent 就又不知道了(F-B-9)。
  events: ConvEvent[];
}

// ConversationResult —— 三态:活着 / 失效(401/403,要重进)/ 抖动(保持现状)。
// dead session 不能当空历史悄悄吞 —— 得清 stale 身份、按有没有 code 回入口。
export type ConversationResult =
  | { status: 'ok'; view: VisitorView }
  | { status: 'invalid' }
  | { status: 'error' };

// openDocConversation —— 多对话模型:浮窗在某篇 doc 上 find-or-create 该 member
// 自己那段对话(POST /conversations {doc_key})。返 conversation_id;失败返 null
// (caller 回退主对话,不崩)。idempotent:同一 doc 再开还是那段。
export async function openDocConversation(
  docKey: string, sessionToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ doc_key: docKey }),
    });
    if (!res.ok) return null;
    const parsed = z.object({ conversation_id: z.string() }).safeParse(await res.json());
    return parsed.success ? parsed.data.conversation_id : null;
  } catch {
    return null;
  }
}

// 约成卡的两个 POST(确认信 / 取消)拆到 api/booking.ts 守 350-line cap。

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
    usedTurns: d.session.used_turns,
    maxMembers: d.session.code.max_members,
    memberCount: d.session.code.member_count,
    dialogs: d.conversation.dialogs,
    events: d.conversation.events,
  };
}

// VisitorDoc —— 锁屏页凭 visitor session 走 corpus_read 取回的被引文档全文。
const VisitorDocSchema = z.object({
  ok: z.boolean(),
  result: z.object({ body: z.string(), title: z.string() }),
});
export interface VisitorDoc { title: string; body: string }

// callVisitorTool —— booked 卡的 mcp-ui:tool 派发：凭访客 session 调一个具名 tool
// （calendar_cancel / send_confirmation）。host 带 session context（conversation +
// token）派发，回工具结果 wire（{ok,...}）。坏响应 / 网络挂 → {ok:false,error}，
// 卡据此进 error 终态。
export async function callVisitorTool(
  conversationID: string, sessionToken: string,
  name: string, args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (conversationID === '' || sessionToken === '' || name === '') {
    return { ok: false, error: 'unavailable' };
  }
  try {
    const res = await fetch(
      `${baseURL()}/api/v1/sessions/${conversationID}/tools/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(args),
      },
    );
    const body: unknown = await res.json();
    if (!isRecordValue(body)) return { ok: false, error: 'bad_response' };
    // /tools envelope is {ok, result:<tool wire>, reason}. The card wants the tool
    // wire (result); a dispatch failure (no result — expired session / quota) →
    // return the envelope itself (ok:false + reason) so the card degrades in-card.
    return isRecordValue(body['result']) ? body['result'] : body;
  } catch {
    return { ok: false, error: 'network' };
  }
}

// isRecordValue —— 把 res.json() 的 unknown 收成 Record（避开 `as` 断言，过 eslint
// consistent-type-assertions）。
function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}


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
        // QUERY (RFC 10008)：corpus_read 是安全/幂等的读；同源，无预检。
        method: 'QUERY',
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
// Bearer(走 code 的 role scope);否则匿名(只 published)。ACL 在后端评估,
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

// WritingTreeNode wire —— 后端 writing-tree 节点(slug + locked)。映射成中性
// TreeNode 时 slug 装进 path(reader 导航 /writings/<slug>),复用 LazyTree。
const WritingTreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  has_children: z.boolean(),
  locked: z.boolean(),
});
const WritingTreeResponseSchema = z.object({ nodes: z.array(WritingTreeNodeSchema) });
const WritingTreeContextWireSchema = z.object({
  ancestors: z.array(WritingTreeNodeSchema),
  children: z.array(WritingTreeNodeSchema),
});

// mapWritingNode —— 后端 writing 节点(slug)→ 中性 TreeNode(slug 装进 path)。
function mapWritingNode(n: z.infer<typeof WritingTreeNodeSchema>): TreeNode {
  return { id: n.id, title: n.title, path: n.slug, has_children: n.has_children, locked: n.locked };
}

// fetchWritingTree —— GET /api/v1/writing-tree[?parent=ID] 的一层。public(published
// 进树,private 标 locked)。坏响应 → []。
export async function fetchWritingTree(parentID: string): Promise<TreeNode[]> {
  try {
    const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
    const res = await fetch(`${baseURL()}/api/v1/writing-tree${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const parsed = WritingTreeResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.nodes.map(mapWritingNode) : [];
  } catch {
    return [];
  }
}

// fetchWritingContext —— GET /api/v1/writing-tree/context?slug=... —— 文章页
// breadcrumb 祖先链 + sub-rail 子节点。SSR public,坏响应 → 空上下文。
export async function fetchWritingContext(slug: string): Promise<TreeContext> {
  try {
    const res = await fetch(
      `${baseURL()}/api/v1/writing-tree/context?slug=${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return EMPTY_TREE_CONTEXT;
    const parsed = WritingTreeContextWireSchema.safeParse(await res.json());
    if (!parsed.success) return EMPTY_TREE_CONTEXT;
    return {
      ancestors: parsed.data.ancestors.map(mapWritingNode),
      children: parsed.data.children.map(mapWritingNode),
    };
  } catch {
    return EMPTY_TREE_CONTEXT;
  }
}

// fetchWikiContext —— GET /api/v1/wiki-tree/context?path=... —— breadcrumb 祖先
// 链 + sub-rail 子节点。token 非空带 Bearer(走 code 的 role scope,看到自己的 gated
// 子条目/祖先);SSR 无 token → 匿名(只 published)。坏响应 → 空上下文。F-L-13:reader
// 客户端拿 stored session token 再 fetch 一次,把 SSR 匿名的 children 升级成访客 scope。
export async function fetchWikiContext(path: string, token = ''): Promise<TreeContext> {
  try {
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(
      `${baseURL()}/api/v1/wiki-tree/context?path=${encodeURIComponent(path)}`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return EMPTY_TREE_CONTEXT;
    const parsed = TreeContextSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : EMPTY_TREE_CONTEXT;
  } catch {
    return EMPTY_TREE_CONTEXT;
  }
}

// WikiTreeStats —— 侧栏脚定位计数(总数/根数/非公开)。
const WikiTreeStatsSchema = z.object({
  entries: z.number(),
  roots: z.number(),
  gated: z.number(),
});
export type WikiTreeStats = z.infer<typeof WikiTreeStatsSchema>;

const EMPTY_WIKI_STATS: WikiTreeStats = { entries: 0, roots: 0, gated: 0 };

// fetchWikiTreeStats —— GET /api/v1/wiki-tree/stats —— 侧栏脚计数。坏响应 → 全 0。
// token 非空带 Bearer:gated 数说的是**对这位访客**关着几条,跟 wiki-tree 同一道闸(F-L-14)。
export async function fetchWikiTreeStats(token = ''): Promise<WikiTreeStats> {
  try {
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`${baseURL()}/api/v1/wiki-tree/stats`, { headers, cache: 'no-store' });
    if (!res.ok) return EMPTY_WIKI_STATS;
    const parsed = WikiTreeStatsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : EMPTY_WIKI_STATS;
  } catch {
    return EMPTY_WIKI_STATS;
  }
}

export const issuePublicSession = () => client().issueSession({ mode: 'public' });
export const issueCodeSession = (input: IssueCodeSessionInput) =>
  client().issueSession({ ...input, mode: 'code' });
export const issueBYOAISession = (input: IssueBYOAISessionInput) =>
  client().issueSession({ ...input, mode: 'byoai' });

// streamChatMessage —— **system 必填**：走 /agent/turn，空 system = 模型收不到 fragment +
// persona（F-O-2）。一场先 composeChatSystem 拼一次。
export function streamChatMessage(
  conversationID: string, sessionToken: string, content: string,
  system: string, byoai?: BYOAIHeaders,
): AsyncGenerator<SSEEvent, void, unknown> {
  return client().streamMessage(conversationID, sessionToken, content, system, byoai);
}

// composeChatSystem —— 这一场的 system prompt（fragment + persona）。
export const composeChatSystem = (s: PublicSessionResponse): Promise<string> =>
  client().composeSystem(s);

// 一些 caller 还是直接需要 IssueSessionInput（custom-page 在 sdk-react
// useChatSession 里用），re-export 兼容。
export type { IssueSessionInput };

// ─── posts (blog) ────────────────────────────────────────────────────
// SDK 还没接 posts；这里直接走 raw fetch。日后扩 SDK 时移过去保持 dogfood。
//
// body_md 是 GitHub-flavored markdown 原文，render 端用 react-markdown +
// remark-gfm 直渲。不存中间块结构。

import { WritingViewSchema } from '@/lib/api/public-schemas';

export type { BacklinkRef, WritingView } from '@/lib/api/public-schemas';

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

// lang —— `?lang=zh`。多语文章由**服务端**挑面：爬虫和 agent 抓到的是内容，不是两份都发下来
// 再用 CSS 藏一份。空串 = 不带这个参数，后端按这条的身份语言决定。
export const fetchWriting = (slug: string, lang = '') =>
  fetchJSONSchema(
    '/api/v1/writings/' + encodeURIComponent(slug)
      + (lang === '' ? '' : `?lang=${encodeURIComponent(lang)}`),
    WritingViewSchema,
  );
