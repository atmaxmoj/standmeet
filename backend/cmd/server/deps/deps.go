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
	"github.com/atmaxmoj/standmeet/internal/infra/buildnotify"
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
	Upgrade            stats.UpgradeSources
	SandboxRunner      sandbox.Runner
	CorpusIndexer      corpus.Indexer
	ProviderModels     owner.ProviderModelLister
	MCPProber          marketplace.MCPServerProber
	ConnectorNeeds     marketplace.ConnectorNeeds
	ReportPDFRenderer  publicroutes.ReportPDFRenderer
	PdfRenderer        jobsuc.PDFRenderer
	CaptchaVerifier    security.Verifier
	ProviderResolver   inference.Resolver
	CodeDenialRepo     *access.CodeDenialRepo
	ConnectorRepo      *connector.Repo
	OutputRepo         *corpus.OutputRepo
	GrowthRepo         *stats.GrowthRepo
	ActivityRepo       *stats.ActivityRepo
	JobRegistry        *stats.JobRegistry
	Corpus             *corpus.Corpus
	CodeRepo           *access.CodeRepo
	EmbedRepo          *access.EmbedRepo
	Log                *slog.Logger
	ChatRepo           *conversation.ChatRepo
	SEORepo            *corpus.SEORepo
	CustomPageRepo     *owner.CustomPageRepo
	CustomBuildRepo    *owner.CustomBuildRepo
	BuildNotifier      *buildnotify.Notifier
	SandboxWorkspaces  *sandboxws.Manager
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
	NoteRefRepo        *corpus.NoteRefRepo
	ConnectorHub       *connector.Hub
	ConnectorSlots     *connector.Slots
	VaultSyncRepo      *corpus.VaultSyncRepo
	StorageClient      *storage.Client
	JobCachePool       *jobcache.Pool
	JobFetchRegistry   *jobfetch.Registry
	PluginRegistry     *capabilities.Registry
	SessionStore       *session.OwnerSessionStore
	VisitorStore       *access.VisitorSessionStore
	QueryQueue         *session.QueryQueue
	SubjectivityRepo   *corpus.NoteRepo
	SetupTokenHolder   *session.SetupTokenHolder
	WikiRepo           *corpus.WikiRepo
	RawRepo            *corpus.RawRepo
	KeypairRepo        *owner.KeypairRepo
	PrintStore         *printsess.Store
	MarketplaceClient  *marketplace.Client
	AgentSkills        *capreg.Registry
	OwnerRepo          *owner.Repo
	DepRegistry        *capreg.DepRegistry
	InstanceRepo       *owner.InstanceRepo
	RDB                *redis.Client
	DB                 *pgxpool.Pool
	Dispatch           *dispatcher.Dispatcher
	CapStores          map[string]*capstore.Store
	// PageDocs —— per-custom-page document store (capstore KindPage); each page its own schema.
	PageDocs       owner.PageDocStore
	SearchClient   *search.Client
	CaptchaSiteKey string
	BuildsRoot     string
	PublicIP       string
	SessionKey     string
	SelfStatPeers  []string
	SecureCookie   bool
	CaptchaEnabled bool
	// SeedDefaultSources — seed the built-in job aggregators on a fresh claim (config knob).
	SeedDefaultSources bool
}
