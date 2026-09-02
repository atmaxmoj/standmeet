// boot_deps.go —— composition root 的 repo bundle + assemble helpers。
// 从 main.go 拆出守 350 行 max-lines。

package main

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/connector"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/infra/gotenberg"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	pluginjobs "github.com/atmaxmoj/standmeet/internal/owner/jobs"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/printsess"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/resumepdf"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// repoSet —— 所有 postgres Repository 的 bundle，让 wireAndServe 不必逐行
// `xxxRepo := postgres.NewXxx(c.db)`，cyclo / function-length 友好。
type repoSet struct {
	instance       *owner.InstanceRepo
	owner          *owner.Repo
	keypair        *owner.KeypairRepo
	raw            *corpus.RawRepo
	wiki           *corpus.WikiRepo
	subjectivity   *corpus.NoteRepo
	vaultSync      *corpus.VaultSyncRepo
	noteRef        *corpus.NoteRefRepo
	output         *corpus.OutputRepo
	growth         *stats.GrowthRepo
	activity       *stats.ActivityRepo
	code           *access.CodeRepo
	embed          *access.EmbedRepo
	codeDenial     *access.CodeDenialRepo
	chat           *conversation.ChatRepo
	seo            *corpus.SEORepo
	customPage     *owner.CustomPageRepo
	customBuild    *owner.CustomBuildRepo
	accessRequest  *access.RequestRepo
	jobSource      *jobsuc.JobSourceRepo
	resumeDraft    *jobsuc.ResumeDraftRepo
	application    *jobsuc.ApplicationRepo
	skill          *marketplace.SkillRepo
	mcpServer      *marketplace.MCPServerRepo
	prompt         *owner.PromptRepo
	role           *access.RoleRepo
	asset          *corpus.AssetRepo
	noteHero       *corpus.NoteHeroRepo
	writing        *corpus.WritingRepo
	writingRef     *corpus.WritingRefRepo
	capability     *access.CapabilityRepo
	ghost          *conversation.GhostRepo
	chatReport     *conversation.ChatReportRepo
	inferenceUsage *stats.InferenceUsageRepo
	bannedIP       *security.BannedIPRepo
	apiKey         *access.APIKeyRepo
	appState       *conversation.AppStateRepo
	connector      *connector.Repo
}

func newRepos(db *pgstore.Pool) *repoSet {
	return &repoSet{
		instance:       owner.NewInstanceRepo(db),
		owner:          owner.NewRepo(db),
		keypair:        owner.NewKeypairRepo(db),
		raw:            corpus.NewRawRepo(db),
		wiki:           corpus.NewWikiRepo(db),
		subjectivity:   corpus.NewNoteRepo(db, "subjectivity"),
		vaultSync:      corpus.NewVaultSyncRepo(db),
		noteRef:        corpus.NewNoteRefRepo(db),
		output:         corpus.NewOutputRepo(db),
		growth:         stats.NewGrowthRepo(db),
		activity:       stats.NewActivityRepo(db),
		code:           access.NewCodeRepo(db),
		embed:          access.NewEmbedRepo(db),
		codeDenial:     access.NewCodeDenialRepo(db),
		chat:           conversation.NewChatRepo(db),
		seo:            corpus.NewSEORepo(db),
		customPage:     owner.NewCustomPageRepo(db),
		customBuild:    owner.NewCustomBuildRepo(db),
		accessRequest:  access.NewAccessRequestRepo(db),
		jobSource:      jobsuc.NewJobSourceRepo(db),
		resumeDraft:    jobsuc.NewResumeDraftRepo(db),
		application:    jobsuc.NewApplicationRepo(db),
		skill:          marketplace.NewSkillRepo(db),
		mcpServer:      marketplace.NewMCPServerRepo(db),
		prompt:         owner.NewPromptRepo(db),
		role:           access.NewRoleRepo(db),
		asset:          corpus.NewAssetRepo(db),
		noteHero:       corpus.NewNoteHeroRepo(db),
		writing:        corpus.NewWritingRepo(db),
		writingRef:     corpus.NewWritingRefRepo(db),
		capability:     access.NewCapabilityRepo(db),
		ghost:          conversation.NewGhostRepo(db),
		chatReport:     conversation.NewChatReportRepo(db),
		inferenceUsage: stats.NewInferenceUsageRepo(db),
		bannedIP:       security.NewBannedIPRepo(db),
		apiKey:         access.NewAPIKeyRepo(db),
		appState:       conversation.NewAppStateRepo(db),
		connector:      connector.NewRepo(db),
	}
}

// deferredWiring —— 在 newRepos 之后才能装的运行期对象（resolver 依赖
// owner repo；setup token holder 在 ensureSetupToken 后才有 plaintext；
// storage client 启动时 ensure bucket）。
type deferredWiring struct {
	providerResolver inference.Resolver
	setupTokenHolder *session.SetupTokenHolder
	storageClient    *storage.Client
}

func assembleRuntimeDeps(
	log *slog.Logger, cfg *config.Config, c *conns, repos *repoSet, dw *deferredWiring,
) deps.Runtime {
	captchaVerifier := security.NewFromConfig(
		security.FromEnvLike(cfg.TurnstileSiteKey, cfg.TurnstileSecret), nil)
	printStore := printsess.New(c.rdb, 0)
	// 词法检索(Meili)。MEILI_URL 空 → searchClient/indexer 为 nil,检索退 Postgres 全文、写不索引。
	searchClient := search.New(cfg.MeiliURL, cfg.MeiliKey)
	corpusIndexer := corpus.NewCorpusIndexer(searchClient, repos.vaultSync, log)
	return deps.Runtime{
		Log: log, DB: c.db, RDB: c.rdb,
		InstanceRepo: repos.instance, OwnerRepo: repos.owner,
		KeypairRepo: repos.keypair, RawRepo: repos.raw, WikiRepo: repos.wiki,
		SubjectivityRepo: repos.subjectivity,
		VaultSyncRepo:    repos.vaultSync,
		NoteRefRepo:      repos.noteRef,
		OutputRepo:       repos.output,
		GrowthRepo:       repos.growth,
		ActivityRepo:     repos.activity,
		JobRegistry:      stats.NewJobRegistry(),
		Corpus:           corpus.NewCorpus(repos.raw, repos.wiki, repos.output, repos.writing),
		CodeRepo:         repos.code, CodeDenialRepo: repos.codeDenial, ChatRepo: repos.chat,
		EmbedRepo:          repos.embed,
		SEORepo:            repos.seo,
		CustomPageRepo:     repos.customPage,
		CustomBuildRepo:    repos.customBuild,
		AccessRequestRepo:  repos.accessRequest,
		JobSourceRepo:      repos.jobSource,
		ResumeDraftRepo:    repos.resumeDraft,
		ApplicationRepo:    repos.application,
		SkillRepo:          repos.skill,
		MCPServerRepo:      repos.mcpServer,
		PromptRepo:         repos.prompt,
		RoleRepo:           repos.role,
		WritingRepo:        repos.writing,
		WritingRefRepo:     repos.writingRef,
		AssetRepo:          repos.asset,
		NoteHeroRepo:       repos.noteHero,
		CapabilityRepo:     repos.capability,
		GhostRepo:          repos.ghost,
		ChatReportRepo:     repos.chatReport,
		InferenceUsageRepo: repos.inferenceUsage,
		BannedIPRepo:       repos.bannedIP,
		APIKeyRepo:         repos.apiKey,
		AppStateRepo:       repos.appState,
		ConnectorRepo:      repos.connector,
		StorageClient:      dw.storageClient,
		JobCachePool:       jobcache.New(c.rdb, 0),
		JobFetchRegistry:   newJobFetchRegistry(cfg),
		SessionStore:       session.NewOwnerSessionStore(c.rdb),
		VisitorStore:       access.NewVisitorSessionStore(c.rdb),
		QueryQueue:         session.NewQueryQueue(cfg.QueryQueueMaxConcurrent),
		ProviderResolver:   dw.providerResolver,
		SetupTokenHolder:   dw.setupTokenHolder,
		CaptchaVerifier:    captchaVerifier,
		CaptchaEnabled:     cfg.TurnstileSiteKey != "" && cfg.TurnstileSecret != "",
		CaptchaSiteKey:     captchaSiteKeyFor(cfg),
		SecureCookie:       cfg.SecureCookie,
		BuildsRoot:         cfg.CustomPagesRoot, SessionKey: cfg.SessionKey,
		SandboxRunner:     sandbox.FromEnv(cfg.SandboxDriver),
		PrintStore:        printStore,
		PdfRenderer:       buildPDFRenderer(log, cfg, printStore),
		ReportPDFRenderer: buildReportPDFRenderer(cfg),
		MarketplaceClient: marketplace.NewFromEnv(
			cfg.MarketplaceGitHubBaseURL, cfg.MarketplaceSkillsMPBaseURL),
		AgentSkills: capreg.NewRegistry(),
		Upgrade:     upgradeSources(cfg),
		// 两颗探针造在这里:开封器只在组装根拿得到(见 deps.go 上那两个字段)。
		MCPProber:      &mcpServerProbe{servers: &dialableMCPServers{repo: repos.mcpServer}},
		ProviderModels: &providerModelLister{owners: repos.owner},
		// capStores —— wireCapabilityStorage 按各能力的声明填(provision 一次)。
		CapStores:    map[string]*capstore.Store{},
		SearchClient: searchClient, CorpusIndexer: corpusIndexer,
		// J.5: pluginRegistry 在 assembleRuntimeDeps 返回后由 caller 用全
		// 套 deps 构造 (jobs.Plugin 需要 *jobsuc.JobsDeps 等闭包持引用)。
		// 这里留 nil 让 lint 看到字段被用；wirePluginRegistry 后再回填。
	}
}

// buildPluginRegistry —— 注册当前启用的所有 outbound plugins。J 期起新增
// outbound type 都往这里加一行 (reg.Register(pluginX.New(...)))，wireup 通
// 过 registry 迭代拿 lifecycle，不要在 composition root 散嵌入逻辑。
//
// 入参 *runtimeDeps：jobs.Plugin 需要 *jobsuc.JobsDeps / ResumeDeps /
// ApplicationsDeps 等闭包持引用；这些 Deps 字段在 assembleRuntimeDeps
// 跑完之后才齐，所以本函数在 assemble 之后再调一次。
func buildPluginRegistry(d *deps.Runtime) *capabilities.Registry {
	reg := capabilities.NewRegistry()
	jobsDeps := jobsuc.JobsDeps{
		Sources: d.JobSourceRepo, Cache: d.JobCachePool, Registry: d.JobFetchRegistry,
	}
	resumeDeps := jobsuc.ResumeDeps{Drafts: d.ResumeDraftRepo, Cache: d.JobCachePool}
	appsDeps := jobsuc.ApplicationsDeps{
		Apps: d.ApplicationRepo, Owners: d.OwnerRepo,
		Roles: d.RoleRepo, Prompts: port.PromptsByName(d),
		CVCheck: port.SubjectivityPresence(d), Renderer: d.PdfRenderer,
	}
	reg.Register(pluginjobs.New(pluginjobs.Deps{
		Jobs:         &jobsDeps,
		Resume:       &resumeDeps,
		Applications: &appsDeps,
		DraftsRepo:   d.ResumeDraftRepo,
		AppsRepo:     d.ApplicationRepo,
		SourcesRepo:  d.JobSourceRepo,
		// 这个插件自己要种的那两条 builtin（hiring prompt + role）走 OwnerSeeder。
		Seed: jobsuc.SeedDeps{Prompts: d.PromptRepo, Roles: d.RoleRepo},
		Log:  d.Log,
	}))
	// 这儿曾经还有一句 ownercore —— 那个包装着全部 owner-MCP 能力,一个跨域的大杂烩。
	// 它的最后一个操作(写长文)已经回 corpus 域了,包整个删掉。
	return reg
}

// buildPDFRenderer —— gotenberg.Client adapter when both GOTENBERG_URL and
// PRINT_BASE_URL are set; falls back to a noop that errors on commit if
// either is empty (lets dev / e2e start without the sidecar).
//
// buildReportPDFRenderer —— the report-download path uses gotenberg's
// convert/html directly (simple HTML doc, no print-page/printsess dance), so
// the public Handlers get a raw gotenberg client (or Noop when unconfigured →
// the route returns a friendly 503).
//
//nolint:ireturn // composition root deliberately returns interface
func buildReportPDFRenderer(cfg *config.Config) publicroutes.ReportPDFRenderer {
	if cfg.GotenbergURL == "" {
		return gotenberg.NoopClient{}
	}
	return gotenberg.New(cfg.GotenbergURL)
}

// buildPDFRenderer —— resume PDF 现在走 **Typst**（typst binary + 内嵌模板，见 resumepdf）。
// 排版质量 + 可定制模板 + 内容/呈现分离，都在一条数据驱动的管线上。gotenberg 那条（React→
// Chromium 打印页）退役给 report 下载路（buildReportPDFRenderer 仍用它）。printsess.Store 不再
// 参与简历渲染。typst 缺失时不静默出空 PDF —— compile 报错，commit 响亮失败。
//
//nolint:ireturn // composition root deliberately returns interface
func buildPDFRenderer(
	log *slog.Logger, cfg *config.Config, _ *printsess.Store,
) jobsuc.PDFRenderer {
	log.Info("pdf renderer: typst", "bin", cfg.TypstBin, "font_path", cfg.ResumeFontPath)
	return resumepdf.New(cfg.TypstBin, cfg.ResumeFontPath)
}

func newJobFetchRegistry(cfg *config.Config) *jobfetch.Registry {
	return jobfetch.New(&jobfetch.BaseURLs{
		Greenhouse:      cfg.JobFetchGreenhouseBaseURL,
		Lever:           cfg.JobFetchLeverBaseURL,
		Ashby:           cfg.JobFetchAshbyBaseURL,
		RemoteOK:        cfg.JobFetchRemoteOKBaseURL,
		WWR:             cfg.JobFetchWWRBaseURL,
		HN:              cfg.JobFetchHNBaseURL,
		SmartRecruiters: cfg.JobFetchSmartRecruitersBaseURL,
		Workable:        cfg.JobFetchWorkableBaseURL,
		JBA:             cfg.JobFetchJBABaseURL,
		Workday:         cfg.JobFetchWorkdayBaseURL,
		BambooHR:        cfg.JobFetchBambooHRBaseURL,
		Jobicy:          cfg.JobFetchJobicyBaseURL,
		Remotive:        cfg.JobFetchRemotiveBaseURL,
		Himalayas:       cfg.JobFetchHimalayasBaseURL,
		WorkingNomads:   cfg.JobFetchWorkingNomadsBaseURL,
		Recruitee:       cfg.JobFetchRecruiteeBaseURL,
	})
}
