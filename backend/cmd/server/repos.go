// repos.go —— composition root 的 repo bundle + assemble helpers。
// 从 main.go 拆出守 350 行 max-lines。

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/captcha"
	"github.com/atmaxmoj/standmeet/internal/config"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gotenberg"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/jobregistry"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/plugins"
	pluginjobs "github.com/atmaxmoj/standmeet/internal/plugins/jobs"
	jobcache "github.com/atmaxmoj/standmeet/internal/plugins/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/plugins/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/printsess"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/storage"
)

// repoSet —— 所有 postgres Repository 的 bundle，让 wireAndServe 不必逐行
// `xxxRepo := postgres.NewXxx(c.db)`，cyclo / function-length 友好。
type repoSet struct {
	instance       *postgres.InstanceRepo
	owner          *postgres.OwnerRepo
	keypair        *postgres.OwnerKeypairRepo
	raw            *postgres.RawRepo
	wiki           *postgres.WikiRepo
	subjectivity   *postgres.NoteRepo
	vaultSync      *postgres.VaultSyncRepo
	wikiRef        *postgres.WikiRefRepo
	output         *postgres.OutputRepo
	growth         *postgres.GrowthRepo
	activity       *postgres.ActivityRepo
	code           *postgres.CodeRepo
	codeDenial     *postgres.CodeDenialRepo
	chat           *postgres.ChatRepo
	seo            *postgres.SEORepo
	customPage     *postgres.CustomPageRepo
	customBuild    *postgres.CustomBuildRepo
	accessRequest  *postgres.AccessRequestRepo
	jobSource      *postgres.JobSourceRepo
	resumeDraft    *postgres.ResumeDraftRepo
	application    *postgres.ApplicationRepo
	skill          *postgres.SkillRepo
	mcpServer      *postgres.MCPServerRepo
	prompt         *postgres.PromptRepo
	role           *postgres.RoleRepo
	asset          *postgres.AssetRepo
	writing        *postgres.WritingRepo
	writingRef     *postgres.WritingRefRepo
	calendar       *postgres.CalendarRepo
	mailConnector  *postgres.MailRepo
	capability     *postgres.CapabilityRepo
	ghost          *postgres.GhostRepo
	chatReport     *postgres.ChatReportRepo
	inferenceUsage *postgres.InferenceUsageRepo
	bannedIP       *postgres.BannedIPRepo
	appState       *postgres.AppStateRepo
	connector      *postgres.ConnectorRepo
}

func newRepos(db *postgres.Pool) *repoSet {
	return &repoSet{
		instance:       postgres.NewInstanceRepo(db),
		owner:          postgres.NewOwnerRepo(db),
		keypair:        postgres.NewOwnerKeypairRepo(db),
		raw:            postgres.NewRawRepo(db),
		wiki:           postgres.NewWikiRepo(db),
		subjectivity:   postgres.NewNoteRepo(db, "subjectivity"),
		vaultSync:      postgres.NewVaultSyncRepo(db),
		wikiRef:        postgres.NewWikiRefRepo(db),
		output:         postgres.NewOutputRepo(db),
		growth:         postgres.NewGrowthRepo(db),
		activity:       postgres.NewActivityRepo(db),
		code:           postgres.NewCodeRepo(db),
		codeDenial:     postgres.NewCodeDenialRepo(db),
		chat:           postgres.NewChatRepo(db),
		seo:            postgres.NewSEORepo(db),
		customPage:     postgres.NewCustomPageRepo(db),
		customBuild:    postgres.NewCustomBuildRepo(db),
		accessRequest:  postgres.NewAccessRequestRepo(db),
		jobSource:      postgres.NewJobSourceRepo(db),
		resumeDraft:    postgres.NewResumeDraftRepo(db),
		application:    postgres.NewApplicationRepo(db),
		skill:          postgres.NewSkillRepo(db),
		mcpServer:      postgres.NewMCPServerRepo(db),
		prompt:         postgres.NewPromptRepo(db),
		role:           postgres.NewRoleRepo(db),
		asset:          postgres.NewAssetRepo(db),
		writing:        postgres.NewWritingRepo(db),
		writingRef:     postgres.NewWritingRefRepo(db),
		calendar:       postgres.NewCalendarRepo(db),
		mailConnector:  postgres.NewMailRepo(db),
		capability:     postgres.NewCapabilityRepo(db),
		ghost:          postgres.NewGhostRepo(db),
		chatReport:     postgres.NewChatReportRepo(db),
		inferenceUsage: postgres.NewInferenceUsageRepo(db),
		bannedIP:       postgres.NewBannedIPRepo(db),
		appState:       postgres.NewAppStateRepo(db),
		connector:      postgres.NewConnectorRepo(db),
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
) runtimeDeps {
	captchaVerifier := captcha.NewFromConfig(
		captcha.FromEnvLike(cfg.TurnstileSiteKey, cfg.TurnstileSecret), nil,
	)
	printStore := printsess.New(c.rdb, 0)
	return runtimeDeps{
		log: log, db: c.db, rdb: c.rdb,
		instanceRepo: repos.instance, ownerRepo: repos.owner,
		keypairRepo: repos.keypair, rawRepo: repos.raw, wikiRepo: repos.wiki,
		subjectivityRepo: repos.subjectivity,
		vaultSyncRepo:    repos.vaultSync,
		wikiRefRepo:      repos.wikiRef,
		outputRepo:       repos.output,
		growthRepo:       repos.growth,
		activityRepo:     repos.activity,
		jobRegistry:      jobregistry.New(),
		corpus:           postgres.NewCorpus(repos.raw, repos.wiki, repos.output, repos.writing),
		codeRepo:         repos.code, codeDenialRepo: repos.codeDenial, chatRepo: repos.chat,
		seoRepo:            repos.seo,
		customPageRepo:     repos.customPage,
		customBuildRepo:    repos.customBuild,
		accessRequestRepo:  repos.accessRequest,
		jobSourceRepo:      repos.jobSource,
		resumeDraftRepo:    repos.resumeDraft,
		applicationRepo:    repos.application,
		skillRepo:          repos.skill,
		mcpServerRepo:      repos.mcpServer,
		promptRepo:         repos.prompt,
		roleRepo:           repos.role,
		writingRepo:        repos.writing,
		writingRefRepo:     repos.writingRef,
		assetRepo:          repos.asset,
		calendarRepo:       repos.calendar,
		mailRepo:           repos.mailConnector,
		capabilityRepo:     repos.capability,
		ghostRepo:          repos.ghost,
		chatReportRepo:     repos.chatReport,
		inferenceUsageRepo: repos.inferenceUsage,
		bannedIPRepo:       repos.bannedIP,
		appStateRepo:       repos.appState,
		connectorRepo:      repos.connector,
		storageClient:      dw.storageClient,
		jobCachePool:       jobcache.New(c.rdb, 0),
		jobFetchRegistry:   newJobFetchRegistry(cfg),
		sessionStore:       session.NewOwnerSessionStore(c.rdb),
		visitorStore:       session.NewVisitorSessionStore(c.rdb),
		queryQueue:         session.NewQueryQueue(cfg.QueryQueueMaxConcurrent),
		providerResolver:   dw.providerResolver,
		setupTokenHolder:   dw.setupTokenHolder,
		captchaVerifier:    captchaVerifier,
		captchaEnabled:     cfg.TurnstileSiteKey != "" && cfg.TurnstileSecret != "",
		captchaSiteKey:     captchaSiteKeyFor(cfg),
		secureCookie:       cfg.SecureCookie,
		buildsRoot:         cfg.CustomPagesRoot,
		sandboxRunner:      sandbox.FromEnv(cfg.SandboxDriver),
		printStore:         printStore,
		pdfRenderer:        buildPDFRenderer(log, cfg, printStore),
		reportPDFRenderer:  buildReportPDFRenderer(cfg),
		marketplaceClient: marketplace.NewFromEnv(
			cfg.MarketplaceGitHubBaseURL, cfg.MarketplaceSkillsMPBaseURL,
		),
		agentSkills: capreg.NewRegistry(),
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
func buildPluginRegistry(d *runtimeDeps) *plugins.Registry {
	reg := plugins.NewRegistry()
	jobsDeps := jobsuc.JobsDeps{
		Sources: d.jobSourceRepo, Cache: d.jobCachePool, Registry: d.jobFetchRegistry,
	}
	resumeDeps := jobsuc.ResumeDeps{Drafts: d.resumeDraftRepo, Cache: d.jobCachePool}
	appsDeps := jobsuc.ApplicationsDeps{
		Apps: d.applicationRepo, Owners: d.ownerRepo,
		Roles: d.roleRepo, Renderer: d.pdfRenderer,
	}
	reg.Register(pluginjobs.New(pluginjobs.Deps{
		Jobs:         &jobsDeps,
		Resume:       &resumeDeps,
		Applications: &appsDeps,
		DraftsRepo:   d.resumeDraftRepo,
		AppsRepo:     d.applicationRepo,
		SourcesRepo:  d.jobSourceRepo,
		Log:          d.log,
	}))
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

//nolint:ireturn // composition root deliberately returns interface
func buildPDFRenderer(
	log *slog.Logger, cfg *config.Config, store *printsess.Store,
) jobsuc.PDFRenderer {
	if cfg.GotenbergURL == "" || cfg.PrintBaseURL == "" {
		log.Info("pdf renderer: disabled (set GOTENBERG_URL + PRINT_BASE_URL to enable)")
		return noopPDFRenderer{}
	}
	log.Info("pdf renderer: gotenberg",
		"endpoint", cfg.GotenbergURL, "print_base", cfg.PrintBaseURL,
	)
	return gotenbergPDFRenderer{
		client:    gotenberg.New(cfg.GotenbergURL),
		store:     store,
		printBase: cfg.PrintBaseURL,
	}
}

// gotenbergPDFRenderer —— bridges jobsuc.PDFRenderer to the gotenberg
// sidecar. The flow:
//  1. Stash (Application + qrURL) in Redis via printsess.Store, get token
//  2. Build print URL: <printBase>/print/application/<id>?t=<token>
//  3. POST it to gotenberg; sidecar's Chromium fetches the print URL,
//     which server-renders <ResumePage/> after calling back to
//     /internal/print-session/<token> for the payload (one-shot, TTL 60s)
//  4. PDF bytes stream back through MCP to Claude
//
// printBase example: http://app:3000 (in-cluster app service URL).
type gotenbergPDFRenderer struct {
	client    gotenberg.Renderer
	store     *printsess.Store
	printBase string
}

func (r gotenbergPDFRenderer) RenderApplicationPDF(
	ctx context.Context, app *domain.Application, qrURL string,
) ([]byte, error) {
	token, err := r.store.Stash(ctx, &printsess.Payload{
		ApplicationID: app.ID,
		ResumeContent: app.ResumeContent,
		JobSnapshot:   app.JobSnapshot,
		QRURL:         qrURL,
	})
	if err != nil {
		return nil, fmt.Errorf("stash print session: %w", err)
	}
	printURL := r.printBase + "/print/application/" + app.ID +
		"?t=" + url.QueryEscape(token)
	pdf, rerr := r.client.RenderURL(ctx, printURL)
	if rerr != nil {
		return nil, fmt.Errorf("render application %s: %w", app.ID, rerr)
	}
	return pdf, nil
}

// noopPDFRenderer —— surfaces gotenberg.ErrNotConfigured so commit fails
// loudly when env vars are missing instead of producing an empty PDF.
type noopPDFRenderer struct{}

func (noopPDFRenderer) RenderApplicationPDF(
	_ context.Context, _ *domain.Application, _ string,
) ([]byte, error) {
	return nil, gotenberg.ErrNotConfigured
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
	})
}
