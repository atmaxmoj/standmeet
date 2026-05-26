// types.ts —— public-facing shape of every response @standmeet/sdk-core
// returns. 全部 readonly 走"server is authoritative"语义；caller 不该改
// 这些对象再回写。命名遵循 backend JSON 协议（snake_case）。

export interface PageProject {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly lines: readonly string[];
  readonly url?: string | null;
}

export interface PageInsight {
  readonly id: string;
  readonly thesis: string;
  readonly context: string;
  readonly body: string;
}

export interface PageWhere {
  readonly location_line: string;
  readonly status_prose: string;
  readonly closing: string;
  readonly looking_for: readonly string[];
}

export interface PageContact {
  readonly email: string;
  readonly chat_line: string;
  readonly recruiter_prose: string;
  readonly casual_prose: string;
}

export interface PageContent {
  readonly updated_at: string;
  readonly owner_id: string;
  readonly hero_prose: string;
  readonly hero_examples: readonly string[];
  readonly insights: readonly PageInsight[];
  readonly projects: readonly PageProject[];
  readonly where: PageWhere;
  readonly contact: PageContact;
}

export interface PublicOwnerView {
  readonly handle: string;
  readonly full_name: string;
  readonly location: string;
}

export interface PublicPageView {
  readonly owner: PublicOwnerView;
  readonly content: PageContent;
}

export interface WikiLandingView {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly seo_description: string;
  readonly updated_at: string;
}

// OutputLandingView —— /output/<path> SEO landing。结构跟 WikiLandingView
// 一致；output 是 raw → wiki → output 三层中最精炼那层。
export interface OutputLandingView {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly seo_description: string;
  readonly updated_at: string;
}

// PublicSessionQuota —— session 颁发时 server 给的 turn 配额。max_turns=0
// 表示无限（owner 在 code 上未设 max_turns_per_session，或非 code tier）。
export interface PublicSessionQuota {
  readonly max_turns: number;
  readonly used_turns: number;
}

export interface PublicSessionResponse {
  readonly session_token: string;
  readonly conversation_id: string;
  readonly code?: string;
  readonly visitor_name?: string;
  readonly quota?: PublicSessionQuota;
}

export type SSETokenEvent = { readonly kind: 'token'; readonly text: string };

// CitedRef —— SSE done event 给前端的引用信息：id + title。让 visitor chat
// 渲染 "↑ from: <title>" footer 时不用再去 fetch 单条 wiki/output。
export interface CitedRef {
  readonly id: string;
  readonly title: string;
}

export type SSEDoneEvent = {
  readonly kind: 'done';
  readonly cited_wiki_ids: readonly string[];
  readonly cited_output_ids: readonly string[];
  readonly cited_wiki_refs: readonly CitedRef[];
  readonly cited_output_refs: readonly CitedRef[];
};
export type SSEErrorEvent = {
  readonly kind: 'error';
  readonly code: string;
  readonly message: string;
};
export type SSEEvent = SSETokenEvent | SSEDoneEvent | SSEErrorEvent;

export type SessionTier = 'public' | 'code' | 'byoai';
