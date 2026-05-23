// repos.go —— composition root 的 repo bundle + assemble helpers。
// 从 main.go 拆出守 350 行 max-lines。

package main

import (
	"log/slog"

	"github.com/wangsijie/standmeet/internal/captcha"
	"github.com/wangsijie/standmeet/internal/config"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/jobcache"
	"github.com/wangsijie/standmeet/internal/jobfetch"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
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
	}
}

// deferredWiring —— 在 newRepos 之后才能装的运行期对象（resolver 依赖
// owner repo；setup token holder 在 ensureSetupToken 后才有 plaintext）。
type deferredWiring struct {
	providerResolver inference.Resolver
	setupTokenHolder *session.SetupTokenHolder
}

func assembleRuntimeDeps(
	log *slog.Logger, cfg *config.Config, c *conns, repos *repoSet, dw *deferredWiring,
) runtimeDeps {
	captchaVerifier := captcha.NewFromConfig(
		captcha.FromEnvLike(cfg.TurnstileSiteKey, cfg.TurnstileSecret), nil,
	)
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
		jobCachePool:      jobcache.New(c.rdb, 0),
		jobFetchRegistry:  newJobFetchRegistry(cfg),
		sessionStore:      session.NewOwnerSessionStore(c.rdb),
		visitorStore:      session.NewVisitorSessionStore(c.rdb),
		providerResolver:  dw.providerResolver,
		setupTokenHolder:  dw.setupTokenHolder,
		captchaVerifier:   captchaVerifier,
		captchaSiteKey:    captchaSiteKeyFor(cfg),
		secureCookie:      cfg.SecureCookie,
		buildsRoot:        cfg.CustomPagesRoot,
	}
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
