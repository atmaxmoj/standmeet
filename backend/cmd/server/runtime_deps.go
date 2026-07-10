// runtime_deps.go —— composition-root 的依赖聚合结构。从 main.go 拆出来:main.go 是
// composition root,长期卡在 max-lines(350),每加一个依赖字段就顶破,逼着到处砍无关行。
// 把这个随功能增长的 god-struct 单独一文件,main.go 保持精简,字段增长不再牵连 main.go。

package main

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/captcha"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/jobregistry"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/plugins"
	jobcache "github.com/atmaxmoj/standmeet/internal/plugins/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/plugins/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/printsess"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
	"github.com/atmaxmoj/standmeet/internal/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/search"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/storage"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// runtimeDeps 把 serve 的依赖打包，避免函数参数列表超过 revive argument-limit。
type runtimeDeps struct {
	log                *slog.Logger
	sandboxWorkspaces  *sandboxws.Manager
	db                 *pgxpool.Pool
	rdb                *redis.Client
	instanceRepo       *postgres.InstanceRepo
	ownerRepo          *postgres.OwnerRepo
	keypairRepo        *postgres.OwnerKeypairRepo
	rawRepo            *postgres.RawRepo
	wikiRepo           *postgres.WikiRepo
	subjectivityRepo   *postgres.NoteRepo
	vaultSyncRepo      *postgres.VaultSyncRepo
	noteRefRepo        *postgres.NoteRefRepo
	outputRepo         *postgres.OutputRepo
	growthRepo         *postgres.GrowthRepo
	activityRepo       *postgres.ActivityRepo
	jobRegistry        *jobregistry.Registry
	corpus             *postgres.Corpus
	codeRepo           *postgres.CodeRepo
	codeDenialRepo     *postgres.CodeDenialRepo
	chatRepo           *postgres.ChatRepo
	seoRepo            *postgres.SEORepo
	customPageRepo     *postgres.CustomPageRepo
	customBuildRepo    *postgres.CustomBuildRepo
	accessRequestRepo  *postgres.AccessRequestRepo
	jobSourceRepo      *postgres.JobSourceRepo
	resumeDraftRepo    *postgres.ResumeDraftRepo
	applicationRepo    *postgres.ApplicationRepo
	skillRepo          *postgres.SkillRepo
	mcpServerRepo      *postgres.MCPServerRepo
	promptRepo         *postgres.PromptRepo
	roleRepo           *postgres.RoleRepo
	assetRepo          *postgres.AssetRepo
	writingRepo        *postgres.WritingRepo
	writingRefRepo     *postgres.WritingRefRepo
	calendarRepo       *postgres.CalendarRepo
	mailRepo           *postgres.MailRepo
	capabilityRepo     *postgres.CapabilityRepo
	ghostRepo          *postgres.GhostRepo
	chatReportRepo     *postgres.ChatReportRepo
	inferenceUsageRepo *postgres.InferenceUsageRepo
	bannedIPRepo       *postgres.BannedIPRepo
	appStateRepo       *postgres.AppStateRepo
	connectorRepo      *postgres.ConnectorRepo
	connectorSlots     *connector.Slots
	sandboxRunner      sandbox.Runner
	storageClient      *storage.Client
	jobCachePool       *jobcache.Pool
	jobFetchRegistry   *jobfetch.Registry
	pluginRegistry     *plugins.Registry
	sessionStore       *session.OwnerSessionStore
	visitorStore       *session.VisitorSessionStore
	queryQueue         *session.QueryQueue
	providerResolver   inference.Resolver
	setupTokenHolder   *session.SetupTokenHolder
	captchaVerifier    captcha.Verifier
	pdfRenderer        jobsuc.PDFRenderer
	reportPDFRenderer  publicroutes.ReportPDFRenderer
	printStore         *printsess.Store
	marketplaceClient  *marketplace.Client
	agentSkills        *capreg.Registry
	searchClient       *search.Client         // corpus 词法检索(Meili);nil = 未配 → 退 Postgres 全文
	corpusIndexer      usecases.CorpusIndexer // 写路径索引传播;nil = 未配 Meili
	captchaSiteKey     string
	buildsRoot         string
	secureCookie       bool
	captchaEnabled     bool // #169 captcha 是否真启用(非 noop)—— code guard 的 escape 层
}

// recoveryDeps —— #100 account recovery 的窄依赖(owner repo + session store + mail proxy)。
// 抽出来让 wireup 的 buildAdminDeps 保持 ≤350 行。
func recoveryDeps(d *runtimeDeps) usecases.RecoveryDeps {
	return usecases.RecoveryDeps{
		Owners: d.ownerRepo, Sessions: d.sessionStore, Proxy: d.connectorSlots.Mail(),
	}
}

// connectorsAdminDeps —— admin connectors 面板依赖(connectorsvc + mail slot)。抽出来让
// buildAdminDeps 保持 ≤70 行(funlen)。
func connectorsAdminDeps(d *runtimeDeps) adminroutes.ConnectorsAdminDeps {
	return adminroutes.ConnectorsAdminDeps{
		Svc:      newConnectorService(d),
		Mail:     d.connectorSlots.Mail(),
		MailKind: d.connectorSlots.MailKind,
	}
}
