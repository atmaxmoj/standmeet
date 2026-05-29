// repos.go —— composition root 的 repo bundle + assemble helpers。
// 从 main.go 拆出守 350 行 max-lines。

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"

	"github.com/wangsijie/standmeet/internal/captcha"
	"github.com/wangsijie/standmeet/internal/config"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/gcal"
	"github.com/wangsijie/standmeet/internal/gotenberg"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/jobcache"
	"github.com/wangsijie/standmeet/internal/jobfetch"
	"github.com/wangsijie/standmeet/internal/marketplace"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/printsess"
	"github.com/wangsijie/standmeet/internal/sandbox"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/storage"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// repoSet —— 所有 postgres Repository 的 bundle，让 wireAndServe 不必逐行
// `xxxRepo := postgres.NewXxx(c.db)`，cyclo / function-length 友好。
type repoSet struct {
	instance      *postgres.InstanceRepo
	owner         *postgres.OwnerRepo
	token         *postgres.APITokenRepo
	raw           *postgres.RawRepo
	wiki          *postgres.WikiRepo
	output        *postgres.OutputRepo
	code          *postgres.CodeRepo
	conv          *postgres.ConversationRepo
	seo           *postgres.SEORepo
	customPage    *postgres.CustomPageRepo
	customBuild   *postgres.CustomBuildRepo
	accessRequest *postgres.AccessRequestRepo
	jobSource     *postgres.JobSourceRepo
	resumeDraft   *postgres.ResumeDraftRepo
	application   *postgres.ApplicationRepo
	skill         *postgres.SkillRepo
	mcpServer     *postgres.MCPServerRepo
	asset         *postgres.AssetRepo
	post          *postgres.PostRepo
	postLink      *postgres.PostLinkRepo
	calendar      *postgres.CalendarRepo
}

func newRepos(db *postgres.Pool) *repoSet {
	return &repoSet{
		instance:      postgres.NewInstanceRepo(db),
		owner:         postgres.NewOwnerRepo(db),
		token:         postgres.NewAPITokenRepo(db),
		raw:           postgres.NewRawRepo(db),
		wiki:          postgres.NewWikiRepo(db),
		output:        postgres.NewOutputRepo(db),
		code:          postgres.NewCodeRepo(db),
		conv:          postgres.NewConversationRepo(db),
		seo:           postgres.NewSEORepo(db),
		customPage:    postgres.NewCustomPageRepo(db),
		customBuild:   postgres.NewCustomBuildRepo(db),
		accessRequest: postgres.NewAccessRequestRepo(db),
		jobSource:     postgres.NewJobSourceRepo(db),
		resumeDraft:   postgres.NewResumeDraftRepo(db),
		application:   postgres.NewApplicationRepo(db),
		skill:         postgres.NewSkillRepo(db),
		mcpServer:     postgres.NewMCPServerRepo(db),
		asset:         postgres.NewAssetRepo(db),
		post:          postgres.NewPostRepo(db),
		postLink:      postgres.NewPostLinkRepo(db),
		calendar:      postgres.NewCalendarRepo(db),
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
		tokenRepo: repos.token, rawRepo: repos.raw, wikiRepo: repos.wiki,
		outputRepo: repos.output,
		codeRepo:   repos.code, convRepo: repos.conv,
		seoRepo:           repos.seo,
		customPageRepo:    repos.customPage,
		customBuildRepo:   repos.customBuild,
		accessRequestRepo: repos.accessRequest,
		jobSourceRepo:     repos.jobSource,
		resumeDraftRepo:   repos.resumeDraft,
		applicationRepo:   repos.application,
		skillRepo:         repos.skill,
		mcpServerRepo:     repos.mcpServer,
		postRepo:          repos.post,
		postLinkRepo:      repos.postLink,
		assetRepo:         repos.asset,
		calendarRepo:      repos.calendar,
		gcalClient: gcal.New(gcal.Config{
			AuthURL:         cfg.GoogleAuthURL,
			TokenURL:        cfg.GoogleTokenURL,
			CalendarBase:    cfg.GoogleCalendarBase,
			DefaultRedirect: cfg.GCalRedirectURI,
		}),
		storageClient:    dw.storageClient,
		jobCachePool:     jobcache.New(c.rdb, 0),
		jobFetchRegistry: newJobFetchRegistry(cfg),
		sessionStore:     session.NewOwnerSessionStore(c.rdb),
		visitorStore:     session.NewVisitorSessionStore(c.rdb),
		queryQueue:       session.NewQueryQueue(cfg.QueryQueueMaxConcurrent),
		providerResolver: dw.providerResolver,
		setupTokenHolder: dw.setupTokenHolder,
		captchaVerifier:  captchaVerifier,
		captchaSiteKey:   captchaSiteKeyFor(cfg),
		secureCookie:     cfg.SecureCookie,
		buildsRoot:       cfg.CustomPagesRoot,
		sandboxRunner:    sandbox.FromEnv(cfg.SandboxDriver),
		printStore:       printStore,
		pdfRenderer:      buildPDFRenderer(log, cfg, printStore),
		marketplaceClient: marketplace.NewFromEnv(
			cfg.MarketplaceGitHubBaseURL, cfg.MarketplaceSkillsMPBaseURL,
		),
	}
}

// buildPDFRenderer —— gotenberg.Client adapter when both GOTENBERG_URL and
// PRINT_BASE_URL are set; falls back to a noop that errors on commit if
// either is empty (lets dev / e2e start without the sidecar).
//
//nolint:ireturn // composition root deliberately returns interface
func buildPDFRenderer(
	log *slog.Logger, cfg *config.Config, store *printsess.Store,
) usecases.PDFRenderer {
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

// gotenbergPDFRenderer —— bridges usecases.PDFRenderer to the gotenberg
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
	})
}
