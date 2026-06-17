// wireup.go —— composition root 的 build*Deps helpers。从 main.go 拆出来
// 保持 main.go ≤ 350 行（lint cap）。所有函数都是 d *runtimeDeps → 一个
// sub-router 的 Deps struct，没业务逻辑。

package main

import (
	"github.com/atmaxmoj/standmeet/internal/mcp"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
	"github.com/atmaxmoj/standmeet/internal/server"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// buildServerDeps —— 把每个 sub-router 的 Deps 块组装出来。serve() 不再
// 直接铺开 50+ 行 struct literal，function-length lint 友好。
func buildServerDeps(d *runtimeDeps) *server.Deps {
	return &server.Deps{
		DB:                   d.db,
		Redis:                d.rdb,
		Log:                  d.log,
		Admin:                buildAdminDeps(d),
		Public:               buildPublicDeps(d),
		PublicPage:           buildPublicPageDeps(d),
		PublicSEO:            buildPublicSEODeps(d),
		PublicCustomPages:    buildPublicCustomPageDeps(d),
		PublicAccessRequests: buildPublicAccessRequestsDeps(d),
		PublicPasswordReset:  buildPublicPasswordResetDeps(d),
		PublicWritings: publicroutes.WritingHandlers{
			Writings: usecases.WritingsDeps{Writings: d.writingRepo},
			CrossLink: usecases.CrossLinkQueryDeps{
				Writings: d.writingRepo, WritingRefs: d.writingRefRepo,
			},
			Page:   usecases.PageDeps{Owners: d.ownerRepo},
			Assets: usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
			Log:    d.log,
		},
		Builds:          sysroutes.BuilderDeps{Log: d.log, Builds: d.customBuildRepo},
		TLSAsk:          sysroutes.TLSAskDeps{Log: d.log, Domains: d.instanceRepo},
		PrintSession:    sysroutes.PrintSessionDeps{Log: d.log, Store: d.printStore},
		DiagRegistry:    sysroutes.DiagRegistryDeps{Registry: d.agentSkills, Log: d.log},
		DiagSession:     buildDiagSessionDeps(d),
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.captchaVerifier,
		PluginRegistry:  d.pluginRegistry,
		BannedIPs:       d.bannedIPRepo,
	}
}

func buildAdminDeps(d *runtimeDeps) server.AdminDeps {
	return server.AdminDeps{
		Claim: usecases.ClaimDeps{
			Instance: d.instanceRepo, Skills: d.skillRepo,
			Prompts: d.promptRepo, Roles: d.roleRepo,
		},
		Login:    usecases.LoginDeps{Owners: d.ownerRepo, Sessions: d.sessionStore},
		Keypairs: usecases.KeypairDeps{Repo: d.keypairRepo, Log: d.log},
		Corpus: usecases.CorpusDeps{
			Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, WikiRefs: d.wikiRefRepo,
		},
		Conversations: usecases.ConversationsDeps{
			Chats: d.chatRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
		},
		Ghosts:         usecases.GhostDeps{Repo: d.ghostRepo},
		BYOAI:          usecases.BYOAIDeps{Owners: d.ownerRepo},
		Domains:        usecases.AllowedDomainsDeps{Instance: d.instanceRepo},
		AccessRequests: usecases.AccessRequestsDeps{Repo: d.accessRequestRepo, Owners: d.ownerRepo},
		HandleAdmin:    usecases.HandleDeps{Owners: d.ownerRepo},
		PublicURLAdmin: usecases.PublicURLDeps{Owners: d.ownerRepo},
		AccountAdmin:   usecases.AccountDeps{Owners: d.ownerRepo},
		AIProvider:     usecases.AIProviderDeps{Owners: d.ownerRepo},
		CustomPages:    usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Skills:         usecases.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		Prompts:        usecases.PromptsDeps{Prompts: d.promptRepo},
		Roles: usecases.RolesDeps{
			Roles: d.roleRepo, Prompts: d.promptRepo,
			Skills: d.skillRepo, MCPServers: d.mcpServerRepo,
		},
		MCPServers:   usecases.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Assets:       usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		Writings:     usecases.WritingsDeps{Writings: d.writingRepo},
		WritingRefs:  d.writingRefRepo,
		SEO:          d.seoRepo,
		Codes:        d.codeRepo,
		Owners:       d.ownerRepo,
		Drafts:       d.resumeDraftRepo,
		Applications: d.applicationRepo,
		Marketplace:  usecases.MarketplaceDeps{Client: d.marketplaceClient},
		Calendar: adminroutes.CalendarAdminDeps{
			Repo: d.calendarRepo, Owners: d.ownerRepo, GCal: d.gcalClient, Redis: d.rdb,
		},
		Mail: adminroutes.MailAdminDeps{Repo: d.mailRepo, Owners: d.ownerRepo},
		ApproveRequests: usecases.ApproveRequestDeps{
			Reqs: d.accessRequestRepo, Codes: d.codeRepo, Roles: d.roleRepo,
			Owners: d.ownerRepo, Mail: d.mailRepo,
		},
		Sessions:     d.sessionStore,
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
func registerAgentSkills(d *runtimeDeps) {
	visitor := buildPublicDeps(d).Visitor
	usecases.RegisterAgentSkills(d.agentSkills, &visitor)
	corpusDeps := usecases.CorpusDeps{
		Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, WikiRefs: d.wikiRefRepo,
	}
	convsDeps := usecases.ConversationsDeps{
		Chats: d.chatRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
	}
	promptsDeps := usecases.PromptsDeps{Prompts: d.promptRepo}
	rolesDeps := usecases.RolesDeps{
		Roles: d.roleRepo, Prompts: d.promptRepo,
		Skills: d.skillRepo, MCPServers: d.mcpServerRepo,
	}
	mcpServersDeps := usecases.MCPServersDeps{
		Servers: d.mcpServerRepo, Codes: d.codeRepo,
	}
	skillsDeps := usecases.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo}
	writingsDeps := usecases.WritingsDeps{Writings: d.writingRepo}
	writingsTxDeps := usecases.WritingsTxDeps{
		Writings:    d.writingRepo,
		WritingRefs: d.writingRefRepo,
		Assets:      usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
	}
	customPagesDeps := usecases.CustomPageDeps{
		Pages: d.customPageRepo, Builds: d.customBuildRepo,
	}
	handleDeps := usecases.HandleDeps{Owners: d.ownerRepo}
	calendarStore := calendarStoreAdapter{repo: d.calendarRepo}
	calendarClient := calendarClientAdapter{client: d.gcalClient}
	calendarDeps := &mcp.CalendarOwnerDeps{
		Client: calendarClient, Store: calendarStore,
	}
	mcp.RegisterAgentSkills(d.agentSkills, &mcp.RegisterDeps{
		Owners:        d.ownerRepo,
		SEO:           d.seoRepo,
		Codes:         d.codeRepo,
		Corpus:        &corpusDeps,
		Conversations: &convsDeps,
		Prompts:       &promptsDeps,
		Roles:         &rolesDeps,
		MCPServers:    &mcpServersDeps,
		Skills:        &skillsDeps,
		Writings:      &writingsDeps,
		WritingsTx:    &writingsTxDeps,
		CustomPages:   &customPagesDeps,
		Handle:        &handleDeps,
		Calendar:      calendarDeps,
		Log:           d.log,
	})
	// J.5: plugins 自己接管自家 owner-MCP capabilities (jobs / resume /
	// applications 3 套都搬到 plugins/jobs/jobs.Plugin)。core register 跑完
	// 再让 registry 把全部 plugin 的 CapabilityRegistrar 一次性注册到同一
	// agentskills.Registry，互不重 ID。
	d.pluginRegistry.RegisterAllCapabilities(d.agentSkills)
}

func buildPublicDeps(d *runtimeDeps) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor: usecases.VisitorDeps{
			Codes: d.codeRepo, Chats: d.chatRepo, Wiki: d.wikiRepo,
			Output: d.outputRepo, Skills: d.skillRepo,
			Writings:   d.writingRepo,
			MCPServers: d.mcpServerRepo,
			Roles:      d.roleRepo,
			Prompts:    d.promptRepo,
			Sandbox:    d.sandboxRunner,
			Owners:     d.ownerRepo, Sessions: d.visitorStore,
			Queue: d.queryQueue, Resolver: d.providerResolver,
			Calendar:    calendarStoreAdapter{repo: d.calendarRepo},
			GCal:        calendarClientAdapter{client: d.gcalClient},
			AgentSkills: d.agentSkills,
			Reports:     d.chatReportRepo,
			Notify: usecases.OwnerNotifyDeps{
				Mail: d.mailRepo, Owners: d.ownerRepo, Roles: d.roleRepo,
			},
		},
		Confirm: usecases.BookingConfirmDeps{
			Calendar: d.calendarRepo, Mail: d.mailRepo, Owners: d.ownerRepo,
		},
		Cancel: usecases.VisitorCancelDeps{
			Client: calendarClientAdapter{client: d.gcalClient},
			Store:  calendarStoreAdapter{repo: d.calendarRepo},
		},
		Sessions:    d.visitorStore,
		Corpus:      d.corpus,
		Ghosts:      usecases.GhostDeps{Repo: d.ghostRepo},
		PDFRenderer: d.reportPDFRenderer,
		Log:         d.log,
	}
}

func buildPublicPageDeps(d *runtimeDeps) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: usecases.PageDeps{Owners: d.ownerRepo},
		Log:  d.log,
		TokenIssuer: &setupTokenIssuerAdapter{
			log: d.log, repo: d.instanceRepo, holder: d.setupTokenHolder,
		},
		CaptchaSiteKey: d.captchaSiteKey,
		MailStatus:     usecases.MailStatusDeps{Mail: d.mailRepo},
	}
}

func buildPublicSEODeps(d *runtimeDeps) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: usecases.SEODeps{
			Owners: d.ownerRepo, SEO: d.seoRepo,
			Wiki: d.wikiRepo, Output: d.outputRepo,
			WikiRefs: d.wikiRefRepo,
		},
		Sessions: d.visitorStore,
		Log:      d.log,
	}
}

func buildPublicCustomPageDeps(d *runtimeDeps) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Owners:     d.ownerRepo,
		Log:        d.log,
		BuildsRoot: d.buildsRoot,
	}
}

func buildPublicAccessRequestsDeps(d *runtimeDeps) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: usecases.AccessRequestsDeps{Repo: d.accessRequestRepo, Owners: d.ownerRepo},
		Log:  d.log,
	}
}

func buildPublicPasswordResetDeps(d *runtimeDeps) publicroutes.PasswordResetHandlers {
	return publicroutes.PasswordResetHandlers{
		Deps: usecases.PasswordResetDeps{Owners: d.ownerRepo},
		Log:  d.log,
	}
}

func buildMCPDeps(d *runtimeDeps) mcp.Deps {
	return mcp.Deps{
		AgentSkills: d.agentSkills,
		Keypairs:    usecases.KeypairDeps{Repo: d.keypairRepo, Log: d.log},
		Owners:      d.ownerRepo,
		Corpus: usecases.CorpusDeps{
			Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, WikiRefs: d.wikiRefRepo,
		},
		SEO:         d.seoRepo,
		CustomPages: usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Jobs: jobsuc.JobsDeps{
			Sources: d.jobSourceRepo, Cache: d.jobCachePool, Registry: d.jobFetchRegistry,
		},
		Resume: jobsuc.ResumeDeps{Drafts: d.resumeDraftRepo, Cache: d.jobCachePool},
		Applications: jobsuc.ApplicationsDeps{
			Apps: d.applicationRepo, Owners: d.ownerRepo,
			Roles:    d.roleRepo,
			Renderer: d.pdfRenderer,
		},
		Conversations: usecases.ConversationsDeps{
			Chats: d.chatRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
		},
		Skills:  usecases.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		Prompts: usecases.PromptsDeps{Prompts: d.promptRepo},
		Roles: usecases.RolesDeps{
			Roles: d.roleRepo, Prompts: d.promptRepo,
			Skills: d.skillRepo, MCPServers: d.mcpServerRepo,
		},
		MCPServers: usecases.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Writings:   usecases.WritingsDeps{Writings: d.writingRepo},
		WritingsTx: usecases.WritingsTxDeps{
			Writings:    d.writingRepo,
			WritingRefs: d.writingRefRepo,
			Assets:      usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		},
		Log: d.log,
	}
}
