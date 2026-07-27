// runtime_deps.go —— composition-root 的依赖聚合结构。从 main.go 拆出来:main.go 是
// composition root,长期卡在 max-lines(350),每加一个依赖字段就顶破,逼着到处砍无关行。
// 把这个随功能增长的 god-struct 单独一文件,main.go 保持精简,字段增长不再牵连 main.go。

package main

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/owner"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/printsess"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	"github.com/atmaxmoj/standmeet/internal/stats"
)

// runtimeDeps 把 serve 的依赖打包，避免函数参数列表超过 revive argument-limit。
type runtimeDeps struct {
	log                *slog.Logger
	sandboxWorkspaces  *sandboxws.Manager
	db                 *pgxpool.Pool
	rdb                *redis.Client
	instanceRepo       *owner.InstanceRepo
	ownerRepo          *owner.Repo
	keypairRepo        *owner.KeypairRepo
	rawRepo            *corpus.RawRepo
	wikiRepo           *corpus.WikiRepo
	subjectivityRepo   *corpus.NoteRepo
	vaultSyncRepo      *corpus.VaultSyncRepo
	noteRefRepo        *corpus.NoteRefRepo
	outputRepo         *corpus.OutputRepo
	growthRepo         *stats.GrowthRepo
	activityRepo       *stats.ActivityRepo
	jobRegistry        *stats.JobRegistry
	corpus             *corpus.Corpus
	codeRepo           *access.CodeRepo
	codeDenialRepo     *access.CodeDenialRepo
	chatRepo           *conversation.ChatRepo
	seoRepo            *corpus.SEORepo
	customPageRepo     *owner.CustomPageRepo
	customBuildRepo    *owner.CustomBuildRepo
	accessRequestRepo  *access.RequestRepo
	jobSourceRepo      *jobsuc.JobSourceRepo
	resumeDraftRepo    *jobsuc.ResumeDraftRepo
	applicationRepo    *jobsuc.ApplicationRepo
	skillRepo          *marketplace.SkillRepo
	mcpServerRepo      *marketplace.MCPServerRepo
	promptRepo         *owner.PromptRepo
	roleRepo           *access.RoleRepo
	assetRepo          *corpus.AssetRepo
	writingRepo        *corpus.WritingRepo
	writingRefRepo     *corpus.WritingRefRepo
	mailRepo           *connector.MailRepo
	capabilityRepo     *access.CapabilityRepo
	ghostRepo          *conversation.GhostRepo
	chatReportRepo     *conversation.ChatReportRepo
	inferenceUsageRepo *stats.InferenceUsageRepo
	bannedIPRepo       *security.BannedIPRepo
	apiKeyRepo         *access.APIKeyRepo
	appStateRepo       *conversation.AppStateRepo
	connectorRepo      *connector.Repo
	connectorHub       *connector.Hub
	connectorSlots     *connector.Slots
	sandboxRunner      sandbox.Runner
	storageClient      *storage.Client
	jobCachePool       *jobcache.Pool
	jobFetchRegistry   *jobfetch.Registry
	pluginRegistry     *capabilities.Registry
	sessionStore       *session.OwnerSessionStore
	visitorStore       *access.VisitorSessionStore
	queryQueue         *session.QueryQueue
	providerResolver   inference.Resolver
	setupTokenHolder   *session.SetupTokenHolder
	captchaVerifier    security.Verifier
	pdfRenderer        jobsuc.PDFRenderer
	reportPDFRenderer  publicroutes.ReportPDFRenderer
	printStore         *printsess.Store
	marketplaceClient  *marketplace.Client
	agentSkills        *capreg.Registry
	searchClient       *search.Client // corpus 词法检索(Meili);nil = 未配 → 退 Postgres 全文
	corpusIndexer      corpus.Indexer // 写路径索引传播;nil = 未配 Meili
	captchaSiteKey     string
	buildsRoot         string
	secureCookie       bool
	captchaEnabled     bool // #169 captcha 是否真启用(非 noop)—— code guard 的 escape 层
}

// recoveryDeps —— #100 account recovery 的窄依赖(owner repo + session store + mail proxy)。
// 抽出来让 wireup 的 buildAdminDeps 保持 ≤350 行。
func recoveryDeps(d *runtimeDeps) owner.RecoveryDeps {
	return owner.RecoveryDeps{
		Owners: d.ownerRepo, Sessions: d.sessionStore, Proxy: outboundSender(d),
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
