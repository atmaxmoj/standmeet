// types.ts —— public-facing shape of every response @standmeet/sdk-core
// returns. 全部 readonly 走"server is authoritative"语义；caller 不该改
// 这些对象再回写。命名遵循 backend JSON 协议（snake_case）。

// PagePinCard —— one rendered pin: the pinned corpus entry's title + excerpt +
// tree-derived path (the card links into /wiki/<path>). insights/projects are
// windows onto the corpus, not a second copy of the content — the owner pins
// published entries and the public page joins them at render time.
export interface PagePinCard {
  readonly wiki_id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly path: string;
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
  readonly insights: readonly PagePinCard[];
  readonly projects: readonly PagePinCard[];
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
  readonly excerpt: string;
  readonly updated_at: string;
  readonly tags: readonly string[];
  // per-note cssclasses(呈现钩子):reader 把它加到 .corpus-content 容器上。
  readonly css_classes?: readonly string[];
  // 出/入链(read next / cited by rail):每项指向另一条 wiki。
  readonly related: readonly { readonly path: string; readonly title: string }[];
  readonly cited_by: readonly { readonly path: string; readonly title: string }[];
  // 这条 wiki 是从几条 raw 提炼来的(N corpus sources)。
  readonly sources_count: number;
  // asset_urls —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
  // reader 渲染前照它把 URI 换成 URL;不换的话 react-markdown 会把非标准 scheme 剥掉,
  // 图位是空的而且不报错。
  readonly asset_urls?: Readonly<Record<string, string>>;
  // assets —— 挂在这条上的文件(文件名 + 真实字节数 + 地址)。图片走正文里的 asset URI,
  // kind='attachment' 的渲成下载区 —— 大小要显示真实字节数,那是访客决定点不点的依据。
  readonly assets?: readonly WikiAssetView[];
  // hero 三件套。cover_image_asset_id 为空 = owner 没设封面,reader 退回程序生成的色板。
  readonly cover_image_asset_id?: string;
  readonly cover_headline?: string;
  readonly cover_hue?: string;
}

// WikiAssetView —— 一份挂在语料上的文件,访客那一侧看到的样子。
// **不含 storage key、不含 holder id**:访客要的是"叫什么、多大、从哪儿下"。
export interface WikiAssetView {
  readonly asset_id: string;
  readonly kind: string;
  readonly content_type: string;
  readonly original_filename: string;
  readonly url: string;
  readonly size_bytes: number;
}

// OutputLandingView —— /output/<path> SEO landing。output 是 raw → wiki → output
// 三层中最精炼那层。
//
// 素材那几个字段以前**不在这里**,而上面那句注释写着"结构跟 WikiLandingView 一致" ——
// 它描述的是意图,不是结果。于是访客读一条 output 时:正文里的 standmeet-asset 渲不出来
// (空图位,不报错)、owner 设的封面到不了前端、附件连字段都没有。
export interface OutputLandingView {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly excerpt: string;
  readonly updated_at: string;
  // 正文引用 + hero 图 → 可访问地址。渲染前照它把 URI 换成 URL。
  readonly asset_urls?: Readonly<Record<string, string>>;
  // 挂在这条上的文件(文件名 + 真实字节数 + 地址)。kind='attachment' 的渲成下载区。
  readonly assets?: readonly WikiAssetView[];
  // hero 三件套。cover_image_asset_id 为空 = owner 没设封面。
  readonly cover_image_asset_id?: string;
  readonly cover_headline?: string;
  readonly cover_hue?: string;
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
  // title —— 透传 MCP 工具的人类可读显示名（#109/#110 dock 按钮 label）。没实现则缺省。
  readonly title?: string;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
}

// PublicSessionDockButton —— #109/#110 一个可渲染的 chat dock 按钮：能力 id + 显示名 + 触发词。
// owner 在 role 上配，已过滤 code-deny。访客点它 = 把 trigger 当自己的消息发出。
export interface PublicSessionDockButton {
  readonly capability_id: string;
  readonly title: string;
  readonly trigger: string;
}

export interface PublicSessionToolSpec {
  readonly name: string;
  readonly description: string;
  // G-8: tool 跑过程中 frontend throbber 显的文案；空 / 缺失 → fallback
  // "running <name>"。让 label 跟 tool spec 同源 (backend single source)，
  // frontend ConversationDeck/ChatRoom 不再各自硬编码 THROBBER_LABELS 表。
  readonly progress_label?: string;
  readonly input_schema: unknown;
  // #134 / MCP Apps: 这个 tool 自带的 ui:// 卡片 HTML（插件经 tool `_meta.ui_resource`
  // 声明，宿主装配时 resources/read 进来）。空 / 缺失 → 无卡。
  readonly ui_html?: string;
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
  readonly ghosts?: readonly string[];
  // #109/#110: owner 在 role 上配的 ≤2 个 chat dock 按钮（冻结、过滤 code-deny 后）。
  readonly dock_buttons?: readonly PublicSessionDockButton[];
  // #122: owner 已配通 mail connector。前端据此决定约成卡要不要显
  // "发确认邮件" 那块(没配 → 整张确认卡不渲染,owner 根本发不了信)。
  readonly owner_can_deliver?: boolean;
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
