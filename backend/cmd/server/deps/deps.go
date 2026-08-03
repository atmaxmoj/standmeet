// deps.go —— Runtime 结构体本身。(包说明在 doc.go。)

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

// Runtime —— serve 的全部依赖。字段导出,因为组装根的各组是各自的包。
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
	// Dispatch —— 出站收口。assembleRuntime 之后由 main 回填(跟 PluginRegistry 同理);
	// 全进程唯一一个,各个面都从它投影。
	Dispatch *dispatcher.Dispatcher
	// CapStores —— 每个**声明了要存储**的能力自己的隔离存储(schema = mcp_<id>),
	// 启动期 provision 一次;之后 host 侧四条路都从这里取同一份。
	CapStores      map[string]*capstore.Store
	SearchClient   *search.Client // corpus 词法检索(Meili);nil = 未配 → 退 Postgres 全文
	CorpusIndexer  corpus.Indexer // 写路径索引传播;nil = 未配 Meili
	CaptchaSiteKey string
	BuildsRoot     string
	SecureCookie   bool
	CaptchaEnabled bool // #169 captcha 是否真启用(非 noop)—— code guard 的 escape 层
}
