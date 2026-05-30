// wireup.go —— composition root 的 build*Deps helpers。从 main.go 拆出来
// 保持 main.go ≤ 350 行（lint cap）。所有函数都是 d *runtimeDeps → 一个
// sub-router 的 Deps struct，没业务逻辑。

package main

import (
	"github.com/wangsijie/standmeet/internal/mcp"
	adminroutes "github.com/wangsijie/standmeet/internal/routes/admin"
	publicroutes "github.com/wangsijie/standmeet/internal/routes/public"
	sysroutes "github.com/wangsijie/standmeet/internal/routes/sys"
	"github.com/wangsijie/standmeet/internal/server"
	"github.com/wangsijie/standmeet/internal/usecases"
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
		Builds:        sysroutes.BuilderDeps{Log: d.log, Builds: d.customBuildRepo},
		TLSAsk:        sysroutes.TLSAskDeps{Log: d.log, Domains: d.instanceRepo},
		PrintSession:  sysroutes.PrintSessionDeps{Log: d.log, Store: d.printStore},
		TestToolSpecs: buildTestToolSpecsDeps(d),
		TestGCalExpire: sysroutes.TestGCalExpireDeps{
			Owners: d.ownerRepo, DB: d.db, Log: d.log,
		},
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.captchaVerifier,
	}
}

func buildAdminDeps(d *runtimeDeps) server.AdminDeps {
	return server.AdminDeps{
		Claim: usecases.ClaimDeps{
			Instance: d.instanceRepo, Skills: d.skillRepo,
			Prompts: d.promptRepo, Roles: d.roleRepo,
		},
		Login:     usecases.LoginDeps{Owners: d.ownerRepo, Sessions: d.sessionStore},
		APITokens: usecases.APITokenDeps{Tokens: d.tokenRepo, Owners: d.ownerRepo, Log: d.log},
		Corpus:    usecases.CorpusDeps{Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo},
		Conversations: usecases.ConversationsDeps{
			Conv: d.convRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
		},
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
		Codes:        d.codeRepo,
		Owners:       d.ownerRepo,
		Drafts:       d.resumeDraftRepo,
		Applications: d.applicationRepo,
		Marketplace:  usecases.MarketplaceDeps{Client: d.marketplaceClient},
		Calendar: adminroutes.CalendarAdminDeps{
			Repo: d.calendarRepo, GCal: d.gcalClient, Redis: d.rdb,
		},
		Sessions:     d.sessionStore,
		SecureCookie: d.secureCookie,
	}
}

// buildTestToolSpecsDeps —— compose visitor deps for the /test/visitor-tool-specs
// sys route. Visitor deps shape matches what publicroutes.Handlers uses but
// is also reusable here without a deep-copy.
func buildTestToolSpecsDeps(d *runtimeDeps) sysroutes.TestToolSpecsDeps {
	visitor := buildPublicDeps(d).Visitor
	return sysroutes.TestToolSpecsDeps{
		Sessions: d.visitorStore,
		Visitor:  &visitor,
		Log:      d.log,
	}
}

func buildPublicDeps(d *runtimeDeps) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor: usecases.VisitorDeps{
			Codes: d.codeRepo, Conv: d.convRepo, Wiki: d.wikiRepo,
			Output: d.outputRepo, Skills: d.skillRepo,
			Writings:   d.writingRepo,
			MCPServers: d.mcpServerRepo,
			Roles:      d.roleRepo,
			Prompts:    d.promptRepo,
			Sandbox:    d.sandboxRunner,
			Owners:     d.ownerRepo, Sessions: d.visitorStore,
			Queue: d.queryQueue, Resolver: d.providerResolver,
			Calendar: calendarStoreAdapter{repo: d.calendarRepo},
			GCal:     calendarClientAdapter{client: d.gcalClient},
		},
		Sessions: d.visitorStore,
		Log:      d.log,
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
	}
}

func buildPublicSEODeps(d *runtimeDeps) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: usecases.SEODeps{Owners: d.ownerRepo, SEO: d.seoRepo},
		Log:  d.log,
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
		APITokens:   usecases.APITokenDeps{Tokens: d.tokenRepo, Owners: d.ownerRepo, Log: d.log},
		Owners:      d.ownerRepo,
		Corpus:      usecases.CorpusDeps{Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo},
		SEO:         d.seoRepo,
		CustomPages: usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Jobs: usecases.JobsDeps{
			Sources: d.jobSourceRepo, Cache: d.jobCachePool, Registry: d.jobFetchRegistry,
		},
		Resume: usecases.ResumeDeps{Drafts: d.resumeDraftRepo, Cache: d.jobCachePool},
		Applications: usecases.ApplicationsDeps{
			Apps: d.applicationRepo, Owners: d.ownerRepo,
			Roles:    d.roleRepo,
			Renderer: d.pdfRenderer,
		},
		Conversations: usecases.ConversationsDeps{
			Conv: d.convRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
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
