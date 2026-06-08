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
// 表示无限（owner 在 code 上未设 max_turns_per_session，或非 code mode）。
export interface PublicSessionQuota {
  readonly max_turns: number;
  readonly used_turns: number;
  // max_members —— 这张码最多几个名字(0 = 不限)。后端恒发(非 code session
  // 也是 0),必填 —— 直接读,不兜底。配 members 数渲 "N of M names"。
  readonly max_members: number;
}

// PublicSessionMember —— 这张码下已有的一个名字(member)。
export interface PublicSessionMember {
  readonly name: string;
  readonly last_seen: string;
}

export interface PublicSessionCapability {
  readonly id: string;
  readonly enabled: boolean;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
}

export interface PublicSessionToolSpec {
  readonly name: string;
  readonly description: string;
  // G-8: tool 跑过程中 frontend throbber 显的文案；空 / 缺失 → fallback
  // "running <name>"。让 label 跟 tool spec 同源 (backend single source)，
  // frontend ConversationDeck/ChatRoom 不再各自硬编码 THROBBER_LABELS 表。
  readonly progress_label?: string;
  readonly input_schema: unknown;
}

export interface PublicSessionResponse {
  readonly session_token: string;
  readonly conversation_id: string;
  readonly code?: string;
  readonly visitor_name?: string;
  // member_id —— 这次解析到的 member id;client 存下,再来带上续会(尤其匿名)。
  readonly member_id?: string;
  // quota / members —— 后端恒发(public/byoai 也给 zero-value quota + [] members),
  // 必填:直接读,不用 `?.` + `?? 0` 兜底掩盖"本该有却没有"。
  readonly quota: PublicSessionQuota;
  readonly members: readonly PublicSessionMember[];
  // D-2 / D-5: pi-pivot fields。pi-agent-core 装 system prompt + tool
  // registry 用。旧 caller 不读这些字段，optional 兼容。
  readonly capabilities?: readonly PublicSessionCapability[];
  readonly tool_specs?: readonly PublicSessionToolSpec[];
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
  // H.13.b: code-mode visitor 进 chat 时浏览器拿初始 ghost text 列表，
  // owner 建码时填的 suggested questions 透下来。code-mode 之外是空
  // 数组 (backend 强制 [] 不 null)。
  readonly suggested_questions?: readonly string[];
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

export type SessionMode = 'public' | 'code' | 'byoai';
