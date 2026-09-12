// deps.go —— the Runtime struct itself. (Package doc lives in doc.go.)

package deps

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/infra/buildnotify"
	"github.com/atmaxmoj/standmeet/internal/infra/sandbox"
	"github.com/atmaxmoj/standmeet/internal/infra/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	pluginjobs "github.com/atmaxmoj/standmeet/internal/owner/jobs"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/printsess"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// Runtime —— all of serve's dependencies. Fields are exported because the composition
// root's groups each live in their own package.
type Runtime struct {
	Upgrade           stats.UpgradeSources
	SandboxRunner     sandbox.Runner
	CorpusIndexer     corpus.Indexer
	ProviderModels    owner.ProviderModelLister
	MCPProber         marketplace.MCPServerProber
	SeamNeeds         marketplace.SeamNeeds
	ReportPDFRenderer publicroutes.ReportPDFRenderer
	PdfRenderer       jobsuc.PDFRenderer
	CaptchaVerifier   security.Verifier
	ProviderResolver  inference.Resolver
	CodeDenialRepo    *access.CodeDenialRepo
	Credentials       *credentials.Repo
	// Assembly —— what the owner installed, grouped into bundles, plus the blocks that
	// failed to start. The grant source for any code that carries a bundle.
	Assembly           *assembly.Repo
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
	MicrositeRepo      *owner.MicrositeRepo
	MicrositeBuildRepo *owner.MicrositeBuildRepo
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
	BlockEnableRepo    *access.BlockEnableRepo
	GhostRepo          *conversation.GhostRepo
	ChatReportRepo     *conversation.ChatReportRepo
	InferenceUsageRepo *stats.InferenceUsageRepo
	BannedIPRepo       *security.BannedIPRepo
	MonitorRepo        *monitor.Repo
	APIKeyRepo         *access.APIKeyRepo
	AppStateRepo       *conversation.AppStateRepo
	NoteRefRepo        *corpus.NoteRefRepo
	// BlockDispatch — seam name → the owner's supplier, then verb + JSON.
	//
	// This used to be a registry object plus a per-seam typed accessor. Both are gone —
	// resolution is by name in the substrate, so the composition root holds one
	// dispatcher and no registry at all.
	BlockDispatch *adapters.Dispatcher
	// BlockSuppliers — the assembled blocks this instance has, by id.
	//
	// Held next to the dispatcher because the two are one mechanism split by direction:
	// boot writes into this table, and every call reads through the dispatcher's lookup
	// into it. It used to be a registry type in a package of its own.
	BlockSuppliers    *adapters.Suppliers
	VaultSyncRepo     *corpus.VaultSyncRepo
	StorageClient     *storage.Client
	JobCachePool      *jobcache.Pool
	JobFetchRegistry  *jobfetch.Registry
	JobsModule        *pluginjobs.Plugin
	SessionStore      *session.OwnerSessionStore
	VisitorStore      *access.VisitorSessionStore
	QueryQueue        *session.QueryQueue
	SubjectivityRepo  *corpus.NoteRepo
	SetupTokenHolder  *session.SetupTokenHolder
	WikiRepo          *corpus.WikiRepo
	RawRepo           *corpus.RawRepo
	KeypairRepo       *owner.KeypairRepo
	PrintStore        *printsess.Store
	MarketplaceClient *marketplace.Client
	AgentSkills       *registry.Registry
	OwnerRepo         *owner.Repo
	DepRegistry       *registry.DepRegistry
	InstanceRepo      *owner.InstanceRepo
	RDB               *redis.Client
	DB                *pgxpool.Pool
	Dispatch          *dispatcher.Dispatcher
	BlockStores       map[string]*blockstore.Store
	// MicrositeDocs —— per-microsite document store (blockstore KindMicrosite); one schema
	// per microsite.
	MicrositeDocs  owner.MicrositeDocStore
	SearchClient   *search.Client
	CaptchaSiteKey string
	BuildsRoot     string
	PublicIP       string
	SessionKey     string
	// StorageSecretKey — carried so the composition root can derive the monitor domain's
	// viewer salt from it (one-way; see monitor_wireup.go). Never used as a credential here.
	StorageSecretKey string
	SelfStatPeers    []string
	SecureCookie     bool
	CaptchaEnabled   bool
	// SeedDefaultSources — seed the built-in job aggregators on a fresh claim (config knob).
	SeedDefaultSources bool
}
