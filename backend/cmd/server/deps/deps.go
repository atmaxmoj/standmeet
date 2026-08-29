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
	// Upgrade —— /admin/system 的升级那一格:去哪儿问有没有新版,以及请谁重新部署这台实例。
	// 两个都在组装根构造(port/upgrade.go),因为它们一个走出站 HTTP、
	// 一个拿的是 owner 填的部署凭据,都不属于 stats 域。
	Upgrade stats.UpgradeSources
	// DepRegistry —— 命名依赖(连接器)注册表。registerAgentSkills 建好后回填:
	// 装配期的 Requires 闸、ext-mcp 的 dep-grant 闸、市场卡的「还缺哪个连接器」共用这一份。
	DepRegistry *capreg.DepRegistry
	// ConnectorNeeds —— 市场搜索问的那句「这张卡还缺哪几个连接器」(F-F-4)。
	// 实现在组装根(connector_needs.go),它持 Runtime,到调用时才去取上面那两张表。
	ConnectorNeeds marketplace.ConnectorNeeds
	// MCPProber —— 去问一台已注册的外部 MCP server:答不答话、有哪些工具(F-D-8)。
	// 域声明这个端口,实现在组装根(mcp_probe.go)—— 那台 server 的认证头是密文,
	// 只有根这一侧开得了。两个装配点(收口和插件注册表)必须拿**同一个**实现,
	// 所以它挂在 Runtime 上,而不是各自 new 一个。
	MCPProber marketplace.MCPServerProber
	// ProviderModels —— 去问 owner 已配好的那条 provider:有哪些模型(F-R-11)。
	// 同一条规矩:那把 key 在库里是密文,只有根这一侧开得了,所以域只声明端口。
	ProviderModels owner.ProviderModelLister
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
