// types.ts —— public-facing shape of every response @standmeet/sdk-core
// returns. Everything is readonly under a "server is authoritative"
// semantics; the caller should never mutate these objects and write them
// back. Naming follows the backend JSON protocol (snake_case).

// CorpusCard —— one published corpus entry as a home-page card (title + excerpt +
// reader path). Returned by GET /api/v1/corpus-cards: a custom page lists these to
// show corpus cards without hand-picking ids. Keyless + published-only, so it never
// surfaces an unpublished note.
export interface CorpusCard {
  readonly title: string;
  readonly excerpt: string;
  readonly path: string;
}

// MicrositeLink —— one of the owner's published custom pages, for a page to link the others
// (slug + title, nothing more). Served keyless by GET /api/v1/microsites.
export interface MicrositeLink {
  readonly slug: string;
  readonly title: string;
}

// PublicOwnerView —— the owner slice shown to visitors (handle / name / location),
// used by the visitor chat to label the owner. No email / password.
export interface PublicOwnerView {
  readonly handle: string;
  readonly full_name: string;
  readonly location: string;
}

export interface WikiLandingView {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly excerpt: string;
  readonly updated_at: string;
  readonly tags: readonly string[];
  // per-note cssclasses (a rendering hook): the reader adds this to the
  // .corpus-content container.
  readonly css_classes?: readonly string[];
  // outbound/inbound links (read next / cited by rail): each item points to
  // another wiki entry.
  readonly related: readonly { readonly path: string; readonly title: string }[];
  readonly cited_by: readonly { readonly path: string; readonly title: string }[];
  // how many raw entries this wiki entry was distilled from (N corpus sources).
  readonly sources_count: number;
  // asset_urls —— maps `standmeet-asset:<id>` references in the body + hero
  // image to reachable addresses. The reader swaps URIs for URLs against
  // this before rendering; skip it and react-markdown strips the
  // non-standard scheme, leaving an empty image slot with no error.
  readonly asset_urls?: Readonly<Record<string, string>>;
  // assets —— files attached to this entry (filename + actual byte size +
  // address). Images go through the asset URI in the body; kind='attachment'
  // ones render as a download area —— the size must show the real byte count,
  // since that's what the visitor decides whether to click on.
  readonly assets?: readonly WikiAssetView[];
  // The hero trio. cover_image_asset_id empty = owner set no cover, and the
  // reader falls back to a procedurally generated color swatch.
  readonly cover_image_asset_id?: string;
  readonly cover_headline?: string;
  readonly cover_hue?: string;
  // Multi-language: body is **already** the selected language's copy (chosen
  // server-side); lang says which one. languages empty = a single-language
  // note, and the reader shows no switcher.
  readonly lang?: string;
  readonly languages?: readonly LanguageOption[];
}

// LanguageOption —— one entry on the switcher: code + display label (the
// owner's lang-labels take priority; if unset, generated from the code:
// zh→中文 / fr→FR).
export interface LanguageOption {
  readonly code: string;
  readonly label: string;
}

// WikiAssetView —— how a file attached to a corpus entry looks from the
// visitor's side. **No storage key, no holder id**: what the visitor needs
// is "what's it called, how big, where to download it from".
export interface WikiAssetView {
  readonly asset_id: string;
  readonly kind: string;
  readonly content_type: string;
  readonly original_filename: string;
  readonly url: string;
  readonly size_bytes: number;
}

// OutputLandingView —— the /output/<path> SEO landing. output is the most
// refined of the three raw → wiki → output layers.
//
// The asset-related fields used to **not be here**, while the comment above
// claimed "structure matches WikiLandingView" —— that described the intent,
// not the result. So when a visitor read an output entry: standmeet-asset
// references in the body wouldn't render (empty image slot, no error), the
// owner's cover setting never reached the frontend, and attachments had no
// field to even carry them.
export interface OutputLandingView {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly excerpt: string;
  readonly updated_at: string;
  // Body references + hero image → reachable addresses. Swap URIs for URLs
  // against this before rendering.
  readonly asset_urls?: Readonly<Record<string, string>>;
  // Files attached to this entry (filename + actual byte size + address).
  // kind='attachment' ones render as a download area.
  readonly assets?: readonly WikiAssetView[];
  // The hero trio. cover_image_asset_id empty = owner set no cover.
  readonly cover_image_asset_id?: string;
  readonly cover_headline?: string;
  readonly cover_hue?: string;
}

// PublicSessionQuota —— the turn quota the server hands out when a session
// is issued. max_turns=0 means unlimited (owner set no max_turns_per_session
// on the code, or it's not code mode).
export interface PublicSessionQuota {
  readonly max_turns: number;
  readonly used_turns: number;
  // max_members —— how many names this code allows at most (0 = unlimited).
  // The backend always sends it (0 for non-code sessions too), required ——
  // read it directly, no fallback. Paired with members.length to render
  // "N of M names".
  readonly max_members: number;
}

// PublicSessionMember —— one existing name (member) under this code.
export interface PublicSessionMember {
  readonly name: string;
  readonly last_seen: string;
}

export interface PublicSessionCapability {
  readonly id: string;
  readonly enabled: boolean;
  // title —— passes through the MCP tool's human-readable display name
  // (the #109/#110 dock button label). Absent if not implemented.
  readonly title?: string;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
}

// PublicSessionDockButton —— #109/#110's renderable chat dock button:
// capability id + display name + trigger phrase. The owner configures it on
// the role, already filtered for code-deny. Visitor clicking it = sending
// the trigger as their own message.
export interface PublicSessionDockButton {
  readonly capability_id: string;
  readonly title: string;
  readonly trigger: string;
}

export interface PublicSessionToolSpec {
  readonly name: string;
  readonly description: string;
  // G-8: the text the frontend throbber shows while the tool runs; empty /
  // missing → fallback "running <name>". Keeps the label sourced from the
  // same place as the tool spec (backend single source), so the frontend
  // ConversationDeck/ChatRoom no longer hardcode their own THROBBER_LABELS
  // table.
  readonly progress_label?: string;
  readonly input_schema: unknown;
  // #134 / MCP Apps: this tool's own ui:// card HTML (declared by the plugin
  // via the tool's `_meta.ui_resource`, pulled in by the host at assembly
  // time via resources/read). Empty / missing → no card.
  readonly ui_html?: string;
}

export interface PublicSessionResponse {
  readonly session_token: string;
  readonly conversation_id: string;
  readonly code?: string;
  // code_label —— the name the owner gave this code ("OpenAI eng loop"). The
  // session strip and welcome message use it to tell the visitor which slice
  // they entered (design source: docs/design/project/app.js). The backend
  // has always sent it; this field just wasn't declared here, so it got
  // dropped by the whole frontend chain and fell back to 'invited' (UX-68).
  readonly code_label?: string;
  // microsite_slug —— which page scanning this code lands on; empty string
  // = the default chat. The landing decision travels with the issuance, so
  // every path that picks up the code gets the same answer.
  readonly microsite_slug?: string;
  readonly visitor_name?: string;
  // member_id —— the member id resolved this time; the client stores it and
  // brings it along next time to continue the session (especially for
  // anonymous visitors).
  readonly member_id?: string;
  // quota / members —— the backend always sends these (public/byoai also get
  // a zero-value quota + [] members), required: read directly, don't mask
  // "should be there but isn't" with `?.` + `?? 0` fallbacks.
  readonly quota: PublicSessionQuota;
  readonly members: readonly PublicSessionMember[];
  // D-2 / D-5: pi-pivot fields. Used by pi-agent-core to assemble the system
  // prompt + tool registry. Old callers don't read these fields; optional
  // for compatibility.
  readonly capabilities?: readonly PublicSessionCapability[];
  readonly tool_specs?: readonly PublicSessionToolSpec[];
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
  // H.13.b: when a code-mode visitor enters chat, the browser gets an
  // initial ghost-text list —— the suggested questions the owner filled in
  // while creating the code, passed straight through. Outside code-mode
  // it's an empty array (backend forces [] rather than null).
  readonly ghosts?: readonly string[];
  // #109/#110: up to 2 chat dock buttons the owner configured on the role
  // (frozen, filtered for code-deny).
  readonly dock_buttons?: readonly PublicSessionDockButton[];
  // #122: whether the owner has a mail connector configured. The frontend
  // uses this to decide whether the booking-confirmation card should show
  // the "send confirmation email" section (unconfigured → the whole
  // confirmation card doesn't render, since the owner can't send mail at all).
  readonly owner_can_deliver?: boolean;
}

export type SSETokenEvent = { readonly kind: 'token'; readonly text: string };

// CitedRef —— the citation info an SSE done event gives the frontend: id +
// title. Lets visitor chat render an "↑ from: <title>" footer without
// having to fetch the individual wiki/output entry.
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
