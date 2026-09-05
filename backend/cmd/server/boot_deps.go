// boot_deps.go — the composition root's repo bundle + assemble helpers.
// Split out of main.go to hold the 350-line max-lines gate.

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
	"github.com/atmaxmoj/standmeet/internal/infra/buildnotify"
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

// repoSet —— a bundle of every postgres Repository, so wireAndServe does not need
// a `xxxRepo := postgres.NewXxx(c.db)` line for each one. Cyclo / function-length friendly.
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

// deferredWiring —— runtime objects that can only be assembled after newRepos
// (the resolver depends on the owner repo; the setup token holder only has
// plaintext after ensureSetupToken; the storage client ensures its bucket at startup).
type deferredWiring struct {
	providerResolver inference.Resolver
	setupTokenHolder *session.SetupTokenHolder
	storageClient    *storage.Client
}

func assembleRuntimeDeps(
	log *slog.Logger, cfg *config.Config, c *conns, repos *repoSet, dw *deferredWiring,
) deps.Runtime {
	captchaVerifier := security.NewFromConfig(
		security.FromEnvLike(cfg.TurnstileSiteKey, cfg.TurnstileSecret), nil,
	)
	printStore := printsess.New(c.rdb, 0)
	searchClient := search.New(cfg.MeiliURL, cfg.MeiliKey)
	corpusIndexer := corpus.NewCorpusIndexer(searchClient, repos.vaultSync, log)
	rt := deps.Runtime{
		Log: log, DB: c.db, RDB: c.rdb,
		JobRegistry:        stats.NewJobRegistry(),
		Corpus:             corpus.NewCorpus(repos.raw, repos.wiki, repos.output, repos.writing),
		BuildNotifier:      buildnotify.New(),
		SelfStatPeers:      cfg.SelfStatPeers,
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
		SeedDefaultSources: cfg.SeedDefaultSources,
		BuildsRoot:         cfg.CustomPagesRoot,
		SessionKey:         cfg.SessionKey,
		PublicIP:           cfg.PublicIP,
		SandboxRunner:      sandbox.FromEnv(cfg.SandboxDriver),
		PrintStore:         printStore,
		PdfRenderer:        buildPDFRenderer(log, cfg, printStore),
		ReportPDFRenderer:  buildReportPDFRenderer(cfg),
		MarketplaceClient: marketplace.NewFromEnv(
			cfg.MarketplaceGitHubBaseURL, cfg.MarketplaceSkillsMPBaseURL,
		),
		AgentSkills: capreg.NewRegistry(),
		Upgrade:     upgradeSources(cfg),
		// The two probes built here: unsealer reachable only from deps.go's composition root.
		MCPProber:      &mcpServerProbe{servers: &dialableMCPServers{repo: repos.mcpServer}},
		ProviderModels: &providerModelLister{owners: repos.owner},
		// CapStores is filled per capability by wireCapabilityStorage; PageDocs is the per-page
		// document schema (capstore KindPage); pluginRegistry is backfilled by wirePluginRegistry.
		CapStores:     map[string]*capstore.Store{},
		PageDocs:      newPageDocStore(capstore.New(c.db)),
		SearchClient:  searchClient,
		CorpusIndexer: corpusIndexer,
	}
	setRuntimeRepos(&rt, repos)
	return rt
}

// setRuntimeRepos —— wire every postgres repo onto the runtime. Split out of assembleRuntimeDeps so
// that function stays a services/config assembler and this stays a flat repo passthrough — each
// under the function-length gate, each with one job.
func setRuntimeRepos(rt *deps.Runtime, repos *repoSet) {
	rt.InstanceRepo, rt.OwnerRepo, rt.KeypairRepo = repos.instance, repos.owner, repos.keypair
	rt.RawRepo, rt.WikiRepo, rt.SubjectivityRepo = repos.raw, repos.wiki, repos.subjectivity
	rt.VaultSyncRepo, rt.NoteRefRepo, rt.OutputRepo = repos.vaultSync, repos.noteRef, repos.output
	rt.GrowthRepo, rt.ActivityRepo = repos.growth, repos.activity
	rt.CodeRepo, rt.CodeDenialRepo, rt.ChatRepo = repos.code, repos.codeDenial, repos.chat
	rt.EmbedRepo, rt.SEORepo = repos.embed, repos.seo
	rt.CustomPageRepo, rt.CustomBuildRepo = repos.customPage, repos.customBuild
	rt.AccessRequestRepo = repos.accessRequest
	rt.JobSourceRepo, rt.ResumeDraftRepo = repos.jobSource, repos.resumeDraft
	rt.ApplicationRepo, rt.SkillRepo = repos.application, repos.skill
	rt.MCPServerRepo, rt.PromptRepo, rt.RoleRepo = repos.mcpServer, repos.prompt, repos.role
	rt.WritingRepo, rt.WritingRefRepo = repos.writing, repos.writingRef
	rt.AssetRepo, rt.NoteHeroRepo, rt.CapabilityRepo = repos.asset, repos.noteHero, repos.capability
	rt.GhostRepo, rt.ChatReportRepo = repos.ghost, repos.chatReport
	rt.InferenceUsageRepo, rt.BannedIPRepo = repos.inferenceUsage, repos.bannedIP
	rt.APIKeyRepo, rt.AppStateRepo, rt.ConnectorRepo = repos.apiKey, repos.appState, repos.connector
}

// buildPluginRegistry —— registers every outbound plugin currently enabled. From phase J
// on, each new outbound type adds one line here (reg.Register(pluginX.New(...))); wireup
// gets lifecycle by iterating the registry — don't scatter embedded logic across the
// composition root.
//
// Param *runtimeDeps: jobs.Plugin needs closures holding references to
// *jobsuc.JobsDeps / ResumeDeps / ApplicationsDeps etc.; those Deps fields are only
// complete after assembleRuntimeDeps finishes, so this function is called once more,
// after assemble.
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
	reg.Register(pluginjobs.New(&pluginjobs.Deps{
		Jobs:         &jobsDeps,
		Resume:       &resumeDeps,
		Applications: &appsDeps,
		DraftsRepo:   d.ResumeDraftRepo,
		AppsRepo:     d.ApplicationRepo,
		SourcesRepo:  d.JobSourceRepo,
		// The two builtins this plugin itself seeds (hiring prompt + role) go
		// through OwnerSeeder.
		Seed: jobsuc.SeedDeps{
			Prompts: d.PromptRepo, Roles: d.RoleRepo, Sources: d.JobSourceRepo,
			SeedDefaults: d.SeedDefaultSources,
		},
		Log: d.Log,
	}))
	// There used to be a line here for ownercore — the package that wrapped every
	// owner-MCP capability, a cross-domain grab-bag. Its last operation (writing long-form)
	// has moved back into the corpus domain, and the whole package was deleted.
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

// buildPDFRenderer —— resume PDFs now go through **Typst** (typst binary + embedded
// template, see resumepdf). Typesetting quality + customizable templates + content/
// presentation separation, all on one data-driven pipeline. The gotenberg path (React→
// Chromium print page) is retired for resumes, handed off to the report-download route
// (buildReportPDFRenderer still uses it). printsess.Store no longer takes part in resume
// rendering. When typst is missing this does not silently emit an empty PDF — compile
// errors, and commit fails loudly.
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
