// event.go —— what one recorded traffic event is (docs/design/traffic.md §3).
//
// A view is an event with an empty Name. That is not a shortcut: it is what lets the
// breakdown endpoint serve "which pages" and "which events" from one query shape, because
// both live in one table under one filter vocabulary (traffic.md §5).

package entity

// Surface —— which part of the product produced an event. A value, never a code path: a new
// surface must not require a new table, a new endpoint, or a new panel.
type Surface = string

// The surfaces a visitor can reach. One constant per part of the product that records traffic.
const (
	SurfaceIndex     Surface = "index"
	SurfaceGate      Surface = "gate"
	SurfaceLanding   Surface = "landing"
	SurfaceChat      Surface = "chat"
	SurfaceReader    Surface = "reader"
	SurfaceWritings  Surface = "writings"
	SurfaceMicrosite Surface = "microsite"
	SurfaceEmbed     Surface = "embed"
	SurfaceIM        Surface = "im"
	SurfaceSEO       Surface = "seo"
)

// Kind —— which corpus-shaped thing an event is about. Also a value, for the same
// reason: adding a corpus genre must cost one constant here and nothing else (traffic.md §6
// rule 3). If a new genre needs a new event name or a new panel, the instrumentation was
// written per-page instead of per-entity, and that is the defect.
type Kind = string

// The corpus genres an event can be about. Adding one costs a constant here and nothing else.
const (
	KindWiki      Kind = "wiki"
	KindOutput    Kind = "output"
	KindWriting   Kind = "writing"
	KindMicrosite Kind = "microsite"
	KindAsset     Kind = "asset"
)

// Event names. A view carries none. Every other name is fixed here so a typo cannot invent a
// second spelling of an existing event — the panel would show both, each with half the count.
const (
	EventScrollDepth       = "scroll_depth"
	EventPinClick          = "pin_click"
	EventHeroCTAClick      = "hero_cta_click"
	EventChatInputFocus    = "chat_input_focus"
	EventChatSubmitAnon    = "chat_submit_anonymous"
	EventContactClick      = "contact_click"
	EventLanguageSwitch    = "language_switch"
	EventCodeSubmit        = "code_submit"
	EventCodeAccepted      = "code_accepted"
	EventCodeRejected      = "code_rejected"
	EventBYOAIPanelOpen    = "byoai_panel_open"
	EventBYOAIConfigured   = "byoai_configured"
	EventAccessRequest     = "access_request_submit"
	EventIdentityPicked    = "identity_picked"
	EventCodeLanding       = "code_landing"
	EventCodeLandingBot    = "code_landing_bot"
	EventChatSessionStart  = "chat_session_start"
	EventChatTurnSent      = "chat_turn_sent"
	EventChatTurnAnswered  = "chat_turn_answered"
	EventChatTurnAbandoned = "chat_turn_abandoned"
	EventToolCall          = "tool_call"
	EventToolCardOpen      = "tool_card_open"
	EventGhostShown        = "ghost_shown"
	EventGhostAccepted     = "ghost_accepted"
	EventSuggestedQuestion = "suggested_question_click"
	EventSourceClick       = "source_click"
	EventQuotaHit          = "quota_hit"
	EventReportOpen        = "report_open"
	EventReportPDF         = "report_pdf_download"
	EventBookingSlotsView  = "booking_slots_viewed"
	EventBookingCreated    = "booking_created"
	EventBookingCancelled  = "booking_cancelled"
	EventReadComplete      = "read_complete"
	EventReadDwell         = "read_dwell"
	EventRelatedClick      = "related_click"
	EventCitedByClick      = "cited_by_click"
	EventAssetDownload     = "asset_download"
	EventLangSwitch        = "lang_switch"
	EventTreeExpand        = "tree_expand"
	EventSearch            = "search"
	EventSearchResultClick = "search_result_click"
	EventWidgetRender      = "widget_render"
	EventStoreWrite        = "store_write"
	EventEmbedView         = "embed_view"
	EventEmbedChatStart    = "embed_chat_start"
	EventEmbedBlockedOrig  = "embed_blocked_origin"
	EventIMTurn            = "im_turn"
	EventRobotsFetch       = "robots_fetch"
	EventSitemapFetch      = "sitemap_fetch"
)

// SrcQR / SrcLink —— how the visitor reached a coded landing page. Without this distinction a
// scan of a printed resume and a click in a mail client are the same row, and the job loop
// cannot tell which of its two channels worked.
const (
	SrcQR   = "qr"
	SrcLink = "link"
)

// Entity —— which corpus-shaped thing the event is about.
//
// ID is the immutable database id. It is never a slug: a slug can be renamed or reparented,
// and an aggregate keyed on a slug splits one entry's history into two rows that cannot be
// summed (traffic.md §6 rule 1).
//
// Title is a snapshot taken at event time. The panel prefers the live title and falls back to
// this one only when the entry has since been deleted (rule 2). It is therefore not a second
// source of truth — it is the only record left of a subject that no longer exists.
type Entity struct {
	Kind  Kind
	ID    string
	Title string
}

// Event —— one row, before it reaches storage.
type Event struct {
	Props  map[string]string
	Page   Page
	Entity Entity

	Surface       Surface
	Name          string
	CodeLabel     string
	MicrositeSlug string

	// The four historical references. Each is a plain id with no foreign key: revoking a code
	// or deleting a corpus entry must not erase the visits it brought in.
	CodeID        string
	RoleID        string
	ChatSessionID string
	EmbedID       string

	// Client last: it ends in a bool, and a trailing bool inside a struct that other structs
	// follow costs padding on every Event. govet's fieldalignment enforces this.
	Client Client
}

// IsView —— an event with no name records the display of a page or an entry.
func (e *Event) IsView() bool { return e.Name == "" }
