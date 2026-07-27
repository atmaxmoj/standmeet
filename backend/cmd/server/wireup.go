// wireup.go —— composition root 的 build*Deps helpers。从 main.go 拆出来
// 保持 main.go ≤ 350 行（lint cap）。所有函数都是 d *runtimeDeps → 一个
// sub-router 的 Deps struct，没业务逻辑。

package main

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"

	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

// buildServerDeps —— 把每个 sub-router 的 Deps 块组装出来。serve() 不再
// 直接铺开 50+ 行 struct literal，function-length lint 友好。
func buildServerDeps(d *runtimeDeps) *Deps {
	return &Deps{
		DB:                   d.db,
		Redis:                d.rdb,
		Log:                  d.log,
		Admin:                buildAdminDeps(d),
		Public:               buildPublicDeps(d),
		PubAPI:               buildPubAPIDeps(d),
		PublicPage:           buildPublicPageDeps(d),
		PublicSEO:            buildPublicSEODeps(d),
		PublicCustomPages:    buildPublicCustomPageDeps(d),
		PublicAccessRequests: buildPublicAccessRequestsDeps(d),
		PublicPasswordReset:  buildPublicPasswordResetDeps(d),
		PublicWritings: publicroutes.WritingHandlers{
			Writings: corpus.WritingsDeps{Writings: d.writingRepo},
			CrossLink: corpus.CrossLinkQueryDeps{
				Writings: d.writingRepo, WritingRefs: d.writingRefRepo,
			},
			Page:   owner.PageDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
			Assets: corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
			Log:    d.log,
		},
		Builds:       sysroutes.BuilderDeps{Log: d.log, Builds: d.customBuildRepo},
		TLSAsk:       sysroutes.TLSAskDeps{Log: d.log, Domains: d.instanceRepo},
		PrintSession: sysroutes.PrintSessionDeps{Log: d.log, Store: d.printStore},
		DiagRegistry: sysroutes.DiagRegistryDeps{Registry: d.agentSkills, Log: d.log},
		DiagSession:  buildDiagSessionDeps(d),
		DiagConnector: sysroutes.DiagConnectorDeps{
			Calendar:  d.connectorSlots.ConnectorCalendar,
			Mail:      d.connectorSlots.ConnectorMail,
			AgentCall: d.connectorSlots.AgentCall,
			Log:       d.log,
		},
		DiagSandbox: sysroutes.DiagSandboxDeps{
			Workspaces: d.sandboxWorkspaces, Log: d.log,
		},
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.captchaVerifier,
		CaptchaEnabled:  d.captchaEnabled,
		PluginRegistry:  d.pluginRegistry,
		BannedIPs:       d.bannedIPRepo,
	}
}

// runBootMaintenance —— boot 时一次性维护(best-effort,失败只 warn 不阻断启动)。
// #106: 清 >7 天的 inference_usage 老行(7 天小表,查询本就只看 7 天)。
func runBootMaintenance(ctx context.Context, d *runtimeDeps) {
	if cerr := d.inferenceUsageRepo.Cleanup(ctx); cerr != nil {
		d.log.Warn("inference usage cleanup", "err", cerr)
	}
}

func buildAdminDeps(d *runtimeDeps) AdminDeps {
	return AdminDeps{
		Claim: owner.ClaimDeps{
			Instance: d.instanceRepo, Skills: d.skillRepo,
			Prompts: d.promptRepo, Roles: d.roleRepo,
		},
		Login:    owner.LoginDeps{Owners: d.ownerRepo, Sessions: d.sessionStore},
		Keypairs: keypairDeps(d),
		Corpus: corpus.Deps{
			Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, NoteRefs: d.noteRefRepo,
			Subjectivity: d.subjectivityRepo, VaultSync: d.vaultSyncRepo, Index: d.corpusIndexer,
		},
		Conversations: conversation.ConversationsDeps{
			Chats: d.chatRepo, Wiki: d.wikiRepo, Writing: d.writingRepo, Output: d.outputRepo,
			Subjectivity: corpus.NewSubjectivityCiteResolver(d.subjectivityRepo),
		},
		Ghosts:  conversation.GhostDeps{Repo: d.ghostRepo},
		BYOAI:   owner.BYOAIDeps{Owners: d.ownerRepo},
		Domains: owner.AllowedDomainsDeps{Instance: d.instanceRepo},
		AccessRequests: access.RequestsDeps{
			Repo:   d.accessRequestRepo,
			Owners: soleOwnerLookup{owners: d.ownerRepo},
		},
		HandleAdmin:    owner.HandleDeps{Owners: d.ownerRepo},
		PublicURLAdmin: owner.PublicURLDeps{Owners: d.ownerRepo},
		AccountAdmin:   owner.AccountDeps{Owners: d.ownerRepo},
		Recovery:       recoveryDeps(d),
		AIProvider:     owner.AIProviderDeps{Owners: d.ownerRepo, Providers: inferenceProviders{}},
		CustomPages:    owner.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Skills:         marketplace.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		Prompts:        owner.PromptsDeps{Prompts: d.promptRepo},
		Roles: access.RolesDeps{
			Roles: d.roleRepo,
			Refs: roleRefValidator{
				prompts: d.promptRepo, skills: d.skillRepo, servers: d.mcpServerRepo,
			},
		},
		MCPServers:   marketplace.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Assets:       corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		Writings:     corpus.WritingsDeps{Writings: d.writingRepo},
		WritingRefs:  d.writingRefRepo,
		SEO:          d.seoRepo,
		Codes:        d.codeRepo,
		Booking:      newBookerQuotaStore(d),
		CodeDenials:  d.codeDenialRepo,
		Owners:       d.ownerRepo,
		Drafts:       d.resumeDraftRepo,
		Applications: d.applicationRepo,
		Marketplace:  marketplace.SearchDeps{Client: d.marketplaceClient},
		Calendar: adminroutes.CalendarAdminDeps{
			Repo: newCapstoreBookingStore(d), Policy: newBookerPolicyStore(d),
		},
		Connectors: connectorsAdminDeps(d),
		Capabilities: adminroutes.CapabilityAdminDeps{
			Registry: d.agentSkills, Settings: d.capabilityRepo,
			Skills: d.skillRepo, Connectors: d.connectorRepo,
		},
		ApproveRequests: owner.ApproveRequestDeps{
			Reqs: d.accessRequestRepo, Codes: d.codeRepo, Roles: d.roleRepo,
			Owners: d.ownerRepo, Proxy: outboundSender(d),
		},
		Sessions:     d.sessionStore,
		Usage:        d.inferenceUsageRepo,
		SystemInfo:   newSysInfoProvider(d),
		Growth:       d.growthRepo,
		Activity:     d.activityRepo,
		Jobs:         d.jobRegistry,
		SecureCookie: d.secureCookie,
	}
}

// buildDiagSessionDeps —— deps for /internal/diag/session.
// Capability 自身闭包持 deps，本 deps 只装 session store + registry。
func buildDiagSessionDeps(d *runtimeDeps) sysroutes.DiagSessionDeps {
	return sysroutes.DiagSessionDeps{
		Sessions: d.visitorStore,
		Registry: d.agentSkills,
		Log:      d.log,
	}
}

// registerAgentSkills —— 把 visitor-side + owner-side 内建 capability 都
// 注册进 d.agentSkills。跟 build*Deps 共享底层 repo 引用；run() 阶段调用
// 一次，capability 闭包持 deps，server 跑期间 deps 不再变。
func registerAgentSkills(ctx context.Context, d *runtimeDeps) {
	wireSandboxWorkspaces(ctx, d)
	wireResumeDraftSweeper(ctx, d)
	// connector 命名依赖注册表一处建、一处 set：ext-mcp dep-grant 闸（工具 _meta.requires
	// 按 grant+connected 放行）与 registerDiscoveredPlugins 的 Requires 校验共用同一份。
	depReg := connectorDepRegistry(ctx, d)
	d.agentSkills.SetDepRegistry(depReg)
	skills := buildVisitorSkillsDeps(d)
	skills.DepConnected = depReg
	capload.RegisterVisitorSkills(d.agentSkills, &skills, d.chatRepo)
	wireSummarizeGateway(ctx, d, &skills)
	// #135: owner-MCP caps are no longer core-registered here — the ownercore plugin (+ jobs)
	// register them via RegisterAllCapabilities below, into the same capreg.Registry, no dup IDs.
	d.pluginRegistry.RegisterAllCapabilities(d.agentSkills)
	// #135: booker 外置到沙箱 —— host 只挂固定词表 reach-back 网关(booker_gateway.go),
	// 不再跑 booker 业务逻辑,也不再有 quota Gate/State(booker 自己在沙箱按 capstore 计数
	// 做配额闸;connector-connected 仍由 manifest Requires:["calendar"] 的 global 闸把住)。
	wireBookerGateway(ctx, d)
	wireMailSenderGateway(ctx, d)
	wireRetrievalSocket(ctx, d, &corpus.IndexDeps{
		Wiki: skills.Wiki, Output: skills.Output, Writings: skills.Writings,
		Subjectivity: d.subjectivityRepo, VaultSync: d.vaultSyncRepo,
		NoteRefs: d.noteRefRepo, Searcher: d.searchClient,
	})
	wireSearchIndex(ctx, d)
	wireSearchReconcile(ctx, d)
	registerDiscoveredPlugins(d, depReg, map[string]capload.CapHooks{
		// booker quota 闸(host 侧,经 capstore.count 数 booker 隔离预约;concretes 只在此组装根)。
		"calendar.book":    {Gate: bookerQuotaGate(d)},
		"corpus.retrieval": {Fragment: capload.CorpusScopeVisible},
	})
	wireCapabilityEnableGate(d)
}

// wireCapabilityEnableGate —— Phase H: 把 owner-enable 闸接到 registry。访客
// 装配时 registry 据此把 owner 关掉的 capability 摘掉。DB 错 → fail-open
// (返 nil = 全开)，保 availability，不让一次读失败把所有能力都拦了。
func wireCapabilityEnableGate(d *runtimeDeps) {
	d.agentSkills.SetEnableGate(func(ctx context.Context, ownerID string) map[string]bool {
		disabled, err := d.capabilityRepo.DisabledSet(ctx, ownerID)
		if err != nil {
			d.log.Warn("capability enable-gate load", "err", err, "owner", ownerID)
			return map[string]bool{}
		}
		return disabled
	})
}

// buildVisitorSkillsDeps —— #131: capability 注册所需的原料(各 capability 的窄 deps
// 由 RegisterVisitorSkills 从这里取)。registerAgentSkills 用,不进 Handlers。
func buildVisitorSkillsDeps(d *runtimeDeps) conversation.VisitorSkillsDeps {
	return conversation.VisitorSkillsDeps{
		Wiki: d.wikiRepo, Output: d.outputRepo, Writings: d.writingRepo,
		Skills:          d.skillRepo,
		Sandbox:         d.sandboxRunner,
		MCPServers:      d.mcpServerRepo,
		Reports:         d.chatReportRepo,
		Resolver:        d.providerResolver,
		AgentConnectors: &agentConnectorSource{repo: d.connectorRepo, slots: d.connectorSlots},
	}
}

// apiKeyDefaultRPM —— instance default rate ceiling for API keys (per-key rate_limit_rpm wins).
const apiKeyDefaultRPM = 120

// newVisitorSessionDeps —— the role-snapshot / assembly dependency bundle shared by the visitor
// public routes and the API-key facade (both freeze a RoleSnapshot the same way).
func newVisitorSessionDeps(d *runtimeDeps) conversation.VisitorSessionDeps {
	return conversation.VisitorSessionDeps{
		Codes: d.codeRepo, Chats: d.chatRepo,
		Owners: d.ownerRepo, Skills: d.skillRepo,
		Roles: d.roleRepo, Prompts: d.promptRepo,
		Sessions:    d.visitorStore,
		Wiki:        d.wikiRepo,
		Writing:     d.writingRepo,
		Output:      d.outputRepo,
		AgentSkills: d.agentSkills,
		CodeDenials: d.codeDenialRepo,
	}
}

// buildPubAPIDeps —— the API-key facade handlers (/api/pub/v1). Reuses the same visitor assembly +
// role-snapshot machinery so ACL/denial/quota parity with codes holds by construction.
func buildPubAPIDeps(d *runtimeDeps) *pubapi.Handlers {
	vs := newVisitorSessionDeps(d)
	return pubapi.New(&pubapi.Deps{
		Keys:        d.apiKeyRepo,
		Visitor:     &vs,
		AgentSkills: d.agentSkills,
		Redis:       d.rdb,
		Log:         d.log,
		DefaultRPM:  apiKeyDefaultRPM,
	})
}

func buildPublicDeps(d *runtimeDeps) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor:      newVisitorSessionDeps(d),
		SecureCookie: d.secureCookie,
		MailStatus:   outboundSender(d),
		Cancel: booker.VisitorCancelDeps{
			Proxy: d.connectorSlots.Calendar(),
			Store: newCapstoreBookingStore(d),
		},
		Resolver:     d.providerResolver,
		Reports:      d.chatReportRepo,
		Sessions:     d.visitorStore,
		QueryQueue:   d.queryQueue,
		Corpus:       d.corpus,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.subjectivityRepo),
		Ledger:       conversation.NewWaypointLedger(d.vaultSyncRepo, d.visitorStore, d.log),
		Ghosts:       conversation.GhostDeps{Repo: d.ghostRepo},
		PDFRenderer:  d.reportPDFRenderer,
		AppState:     d.appStateRepo,
		Usage:        d.inferenceUsageRepo,
		Log:          d.log,
		// CodeGuard 由 internal/server 装配(middleware wiring 归 server 层,cmd 不引 middleware)。
	}
}

func buildPublicPageDeps(d *runtimeDeps) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: owner.PageDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
		Log:  d.log,
		TokenIssuer: &setupTokenIssuerAdapter{
			log: d.log, repo: d.instanceRepo, holder: d.setupTokenHolder,
		},
		CaptchaSiteKey: d.captchaSiteKey,
		MailStatus:     owner.MailStatusDeps{Proxy: outboundSender(d)},
	}
}

func buildPublicSEODeps(d *runtimeDeps) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: owner.SEODeps{
			Owners: d.ownerRepo, SEO: d.seoRepo,
			Wiki: d.wikiRepo, Output: d.outputRepo,
			NoteRefs: d.noteRefRepo,
		},
		Sessions: d.visitorStore,
		Log:      d.log,
	}
}

func buildPublicCustomPageDeps(d *runtimeDeps) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       owner.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Owners:     d.ownerRepo,
		Log:        d.log,
		BuildsRoot: d.buildsRoot,
	}
}

func buildPublicAccessRequestsDeps(d *runtimeDeps) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: access.RequestsDeps{
			Repo:   d.accessRequestRepo,
			Owners: soleOwnerLookup{owners: d.ownerRepo},
		},
		Log: d.log,
	}
}

func buildPublicPasswordResetDeps(d *runtimeDeps) publicroutes.PasswordResetHandlers {
	return publicroutes.PasswordResetHandlers{
		Deps: owner.PasswordResetDeps{Owners: d.ownerRepo},
		Log:  d.log,
	}
}

func buildMCPDeps(d *runtimeDeps) mcphandle.Deps {
	// #135: owner tools all live in the ownercore plugin now; the MCP server only needs auth
	// (Keypairs) + the capreg registry (AgentSkills) it walks for the tool list.
	return mcphandle.Deps{
		AgentSkills: d.agentSkills,
		Keypairs:    keypairDeps(d),
		Log:         d.log,
	}
}
