// facade.go —— what the rest of the instance calls to record traffic.
//
// Only the composition root imports this. No other domain does, and .go-arch-lint.yml enforces
// that: no component outside monitor lists a monitor component in mayDependOn
// (docs/design/monitor.md §0). Recording happens in internal/monitor/mw, which observes the
// public router from outside rather than being called from inside a handler.
//
// What this surface offers: the recorder handle, the surface names, the entity kinds, and the
// event vocabulary — and no access at all to the tables, the viewer hash, or the bot list. A
// caller therefore cannot record a client other than the one that made the request, which is
// the property that keeps the numbers honest.

package facade

import (
	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
	"github.com/atmaxmoj/standmeet/internal/monitor/ops"
	"github.com/atmaxmoj/standmeet/internal/monitor/repo"
)

// Deps / Input —— re-exported so a caller never names an internal package.
type (
	Deps  = ops.Deps
	Input = ops.Input
	// Entity —— which corpus-shaped thing an event is about. ID must be the immutable
	// database id, never a slug (monitor.md §6 rule 1).
	Entity = entity.Entity
	// Repo —— the storage handle, constructed once at the composition root.
	Repo = repo.Repo
	// The read shapes. Monitor deliberately declares no ops of its own and takes no dependency
	// on the parity vocabulary: it is the domain that watches the others, so the less it is
	// entangled with, the less it can disturb. The convergence point declares its two reads
	// instead (internal/routes/dispatcher/monitor_ops.go), where that vocabulary already lives.
	EventQuery = repo.EventQuery
	EventRow   = repo.EventRow
	EventsArgs = repo.EventsArgs
	EventsOut  = repo.EventsOut
	Summary    = repo.Summary
)

// The input schemas for those reads. Declared in the domain, next to the shapes they describe.
var (
	EventsInputSchema = repo.EventsInputSchema
	StatsInputSchema  = repo.StatsInputSchema
	StatsSince        = repo.StatsSince
	// EventsQueryFrom —— decoding and bounding, kept in the domain so the face stays a
	// declaration and a call.
	EventsQueryFrom = repo.EventsQueryFrom
)

// The domain's operations. Bound, never declared here: a facade re-exports, and a rule of its
// own on a boundary is a rule that lives in two places.
//
// Record is the single entry point for every instrumentation point, and it returns nothing on
// purpose. Recording may never fail the request that produced it, and a caller handed an error
// would eventually be written to react to one.
var (
	NewRepo = repo.New
	Record  = ops.RecordRequest
	View    = ops.View
	// PeriodicJobs —— this domain's scheduled work: dropping traffic past the retention window.
	PeriodicJobs = repo.PeriodicJobs
)

// Surfaces.
const (
	SurfaceIndex     = entity.SurfaceIndex
	SurfaceGate      = entity.SurfaceGate
	SurfaceLanding   = entity.SurfaceLanding
	SurfaceChat      = entity.SurfaceChat
	SurfaceReader    = entity.SurfaceReader
	SurfaceWritings  = entity.SurfaceWritings
	SurfaceMicrosite = entity.SurfaceMicrosite
	SurfaceEmbed     = entity.SurfaceEmbed
	SurfaceIM        = entity.SurfaceIM
	SurfaceSEO       = entity.SurfaceSEO
)

// Entity kinds.
const (
	KindWiki      = entity.KindWiki
	KindOutput    = entity.KindOutput
	KindWriting   = entity.KindWriting
	KindMicrosite = entity.KindMicrosite
	KindAsset     = entity.KindAsset
)

// Event names. Spelled once, in entity, so a typo cannot invent a second spelling of an
// existing event — the panel would show both, each holding half the count.
const (
	EventScrollDepth       = entity.EventScrollDepth
	EventPinClick          = entity.EventPinClick
	EventHeroCTAClick      = entity.EventHeroCTAClick
	EventChatInputFocus    = entity.EventChatInputFocus
	EventChatSubmitAnon    = entity.EventChatSubmitAnon
	EventContactClick      = entity.EventContactClick
	EventLanguageSwitch    = entity.EventLanguageSwitch
	EventCodeSubmit        = entity.EventCodeSubmit
	EventCodeAccepted      = entity.EventCodeAccepted
	EventCodeRejected      = entity.EventCodeRejected
	EventBYOAIPanelOpen    = entity.EventBYOAIPanelOpen
	EventBYOAIConfigured   = entity.EventBYOAIConfigured
	EventAccessRequest     = entity.EventAccessRequest
	EventIdentityPicked    = entity.EventIdentityPicked
	EventCodeLanding       = entity.EventCodeLanding
	EventCodeLandingBot    = entity.EventCodeLandingBot
	EventChatSessionStart  = entity.EventChatSessionStart
	EventChatTurnSent      = entity.EventChatTurnSent
	EventChatTurnAnswered  = entity.EventChatTurnAnswered
	EventChatTurnAbandoned = entity.EventChatTurnAbandoned
	EventToolCall          = entity.EventToolCall
	EventToolCardOpen      = entity.EventToolCardOpen
	EventGhostShown        = entity.EventGhostShown
	EventGhostAccepted     = entity.EventGhostAccepted
	EventSuggestedQuestion = entity.EventSuggestedQuestion
	EventSourceClick       = entity.EventSourceClick
	EventQuotaHit          = entity.EventQuotaHit
	EventReportOpen        = entity.EventReportOpen
	EventReportPDF         = entity.EventReportPDF
	EventBookingSlotsView  = entity.EventBookingSlotsView
	EventBookingCreated    = entity.EventBookingCreated
	EventBookingCancelled  = entity.EventBookingCancelled
	EventReadComplete      = entity.EventReadComplete
	EventReadDwell         = entity.EventReadDwell
	EventRelatedClick      = entity.EventRelatedClick
	EventCitedByClick      = entity.EventCitedByClick
	EventAssetDownload     = entity.EventAssetDownload
	EventLangSwitch        = entity.EventLangSwitch
	EventTreeExpand        = entity.EventTreeExpand
	EventSearch            = entity.EventSearch
	EventSearchResultClick = entity.EventSearchResultClick
	EventWidgetRender      = entity.EventWidgetRender
	EventStoreWrite        = entity.EventStoreWrite
	EventEmbedView         = entity.EventEmbedView
	EventEmbedChatStart    = entity.EventEmbedChatStart
	EventEmbedBlockedOrig  = entity.EventEmbedBlockedOrig
	EventIMTurn            = entity.EventIMTurn
	EventRobotsFetch       = entity.EventRobotsFetch
	EventSitemapFetch      = entity.EventSitemapFetch
)

// How a visitor reached a coded landing page.
const (
	SrcQR   = entity.SrcQR
	SrcLink = entity.SrcLink
)
