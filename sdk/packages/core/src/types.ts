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
  readonly owner_handle: string;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly seo_description: string;
  readonly updated_at: string;
}

export interface PublicSessionResponse {
  readonly session_token: string;
  readonly conversation_id: string;
  readonly owner_handle: string;
  readonly included_tags: readonly string[];
  readonly excluded_tags: readonly string[];
}

export type SSETokenEvent = { readonly kind: 'token'; readonly text: string };
export type SSEDoneEvent = {
  readonly kind: 'done';
  readonly cited_wiki_ids: readonly string[];
};
export type SSEErrorEvent = {
  readonly kind: 'error';
  readonly code: string;
  readonly message: string;
};
export type SSEEvent = SSETokenEvent | SSEDoneEvent | SSEErrorEvent;

export type SessionTier = 'public' | 'code' | 'byoai';
