// deps.go —— the Runtime struct itself. (Package doc lives in doc.go.)

package deps

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/connector"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/printsess"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// Runtime —— all of serve's dependencies. Fields are exported because the composition
// root's groups each live in their own package.
type Runtime struct {
	Log                *slog.Logger
	SandboxWorkspaces  *sandboxws.Manager
	DB                 *pgxpool.Pool
	RDB                *redis.Client
	InstanceRepo       *owner.InstanceRepo
	OwnerRepo          *owner.Repo
	KeypairRepo        *owner.KeypairRepo
	RawRepo            *corpus.RawRepo
	WikiRepo           *corpus.WikiRepo
	SubjectivityRepo   *corpus.NoteRepo
	VaultSyncRepo      *corpus.VaultSyncRepo
	NoteRefRepo        *corpus.NoteRefRepo
	OutputRepo         *corpus.OutputRepo
	GrowthRepo         *stats.GrowthRepo
	ActivityRepo       *stats.ActivityRepo
	JobRegistry        *stats.JobRegistry
	Corpus             *corpus.Corpus
	CodeRepo           *access.CodeRepo
	EmbedRepo          *access.EmbedRepo
	CodeDenialRepo     *access.CodeDenialRepo
	ChatRepo           *conversation.ChatRepo
	SEORepo            *corpus.SEORepo
	CustomPageRepo     *owner.CustomPageRepo
	CustomBuildRepo    *owner.CustomBuildRepo
	AccessRequestRepo  *access.RequestRepo
	JobSourceRepo      *jobsuc.JobSourceRepo
	ResumeDraftRepo    *jobsuc.ResumeDraftRepo
	ApplicationRepo    *jobsuc.ApplicationRepo
	SkillRepo          *marketplace.SkillRepo
	MCPServerRepo      *marketplace.MCPServerRepo
	PromptRepo         *owner.PromptRepo
	RoleRepo           *access.RoleRepo
	AssetRepo          *corpus.AssetRepo
	NoteHeroRepo       *corpus.NoteHeroRepo
	WritingRepo        *corpus.WritingRepo
	WritingRefRepo     *corpus.WritingRefRepo
	CapabilityRepo     *access.CapabilityRepo
	GhostRepo          *conversation.GhostRepo
	ChatReportRepo     *conversation.ChatReportRepo
	InferenceUsageRepo *stats.InferenceUsageRepo
	BannedIPRepo       *security.BannedIPRepo
	APIKeyRepo         *access.APIKeyRepo
	AppStateRepo       *conversation.AppStateRepo
	ConnectorRepo      *connector.Repo
	ConnectorHub       *connector.Hub
	ConnectorSlots     *connector.Slots
	SandboxRunner      sandbox.Runner
	StorageClient      *storage.Client
	JobCachePool       *jobcache.Pool
	JobFetchRegistry   *jobfetch.Registry
	PluginRegistry     *capabilities.Registry
	SessionStore       *session.OwnerSessionStore
	VisitorStore       *access.VisitorSessionStore
	QueryQueue         *session.QueryQueue
	ProviderResolver   inference.Resolver
	SetupTokenHolder   *session.SetupTokenHolder
	CaptchaVerifier    security.Verifier
	PdfRenderer        jobsuc.PDFRenderer
	ReportPDFRenderer  publicroutes.ReportPDFRenderer
	PrintStore         *printsess.Store
	MarketplaceClient  *marketplace.Client
	AgentSkills        *capreg.Registry
	// Upgrade —— the upgrade section of /admin/system: where to ask whether a newer
	// version exists, and who to ask to redeploy this instance. Both are constructed in
	// the composition root (port/upgrade.go), because one makes outbound HTTP calls and
	// the other reads deploy credentials the owner entered — neither belongs to the
	// stats domain.
	Upgrade stats.UpgradeSources
	// DepRegistry —— the named-dependency (connector) registry. Backfilled once
	// registerAgentSkills finishes building it: the assembly-time Requires gate, the
	// ext-mcp dep-grant gate, and the marketplace card's "which connector is still
	// missing" all share this one instance.
	DepRegistry *capreg.DepRegistry
	// ConnectorNeeds —— answers marketplace search's question "which connectors is
	// this card still missing" (F-F-4). Implemented in the composition root
	// (connector_needs.go), which holds Runtime and reads the two tables above only
	// when called.
	ConnectorNeeds marketplace.ConnectorNeeds
	// MCPProber —— asks a registered external MCP server whether it responds and what
	// tools it has (F-D-8). The domain declares this port; the implementation lives in
	// the composition root (mcp_probe.go) because that server's auth header is stored
	// encrypted and only the root side can decrypt it. Both call sites (the convergence
	// point and the plugin registry) must use the **same** implementation, so it hangs
	// off Runtime instead of each constructing its own.
	MCPProber marketplace.MCPServerProber
	// ProviderModels —— asks the owner's configured provider which models it has
	// (F-R-11). Same rule: that key is stored encrypted and only the root side can
	// decrypt it, so the domain only declares the port.
	ProviderModels owner.ProviderModelLister
	// Dispatch —— the outbound convergence point. Backfilled by main after
	// assembleRuntime (same pattern as PluginRegistry); one per process, every facade
	// projects from it.
	Dispatch *dispatcher.Dispatcher
	// CapStores —— the isolated storage (schema = mcp_<id>) for each capability that
	// **declares it needs storage**, provisioned once at startup; all four host-side
	// paths then read the same instance from here.
	CapStores      map[string]*capstore.Store
	SearchClient   *search.Client // corpus lexical search (Meili); nil = unset, falls to Postgres
	CorpusIndexer  corpus.Indexer // write-path index propagation; nil = Meili unconfigured
	CaptchaSiteKey string
	BuildsRoot     string
	// SessionKey —— the server's own signing key. Preview tokens are signed with it
	// (HMAC-derived, never stored in a table).
	SessionKey   string
	SecureCookie bool
	// #169 whether captcha is really on (not noop) — escape hatch for code guard
	CaptchaEnabled bool
}
