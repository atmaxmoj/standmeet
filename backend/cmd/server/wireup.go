// wireup.go —— composition root 的 build*Deps helpers。从 main.go 拆出来
// 保持 main.go ≤ 350 行（lint cap）。所有函数都是 d *runtimeDeps → 一个
// sub-router 的 Deps struct，没业务逻辑。

package main

import (
	"github.com/wangsijie/standmeet/internal/mcp"
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
		PublicPosts: publicroutes.PostHandlers{
			Posts: usecases.PostsDeps{Posts: d.postRepo},
			CrossLink: usecases.CrossLinkQueryDeps{
				Posts: d.postRepo, PostLinks: d.postLinkRepo,
			},
			Page:   usecases.PageDeps{Owners: d.ownerRepo},
			Assets: usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
			Log:    d.log,
		},
		Builds:          sysroutes.BuilderDeps{Log: d.log, Builds: d.customBuildRepo},
		TLSAsk:          sysroutes.TLSAskDeps{Log: d.log, Domains: d.instanceRepo},
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.captchaVerifier,
	}
}

func buildAdminDeps(d *runtimeDeps) server.AdminDeps {
	return server.AdminDeps{
		Claim:     usecases.ClaimDeps{Instance: d.instanceRepo, Skills: d.skillRepo},
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
		MCPServers:     usecases.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Assets:         usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		Posts:          usecases.PostsDeps{Posts: d.postRepo},
		PostLinks:      d.postLinkRepo,
		Codes:          d.codeRepo,
		Owners:         d.ownerRepo,
		Drafts:         d.resumeDraftRepo,
		Applications:   d.applicationRepo,
		Sessions:       d.sessionStore,
		SecureCookie:   d.secureCookie,
	}
}

func buildPublicDeps(d *runtimeDeps) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor: usecases.VisitorDeps{
			Codes: d.codeRepo, Conv: d.convRepo, Wiki: d.wikiRepo,
			Output: d.outputRepo, Skills: d.skillRepo,
			Posts:      d.postRepo,
			MCPServers: d.mcpServerRepo,
			Sandbox:    d.sandboxRunner,
			Owners:     d.ownerRepo, Sessions: d.visitorStore,
			Queue: d.queryQueue, Resolver: d.providerResolver,
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
		},
		Conversations: usecases.ConversationsDeps{
			Conv: d.convRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
		},
		Skills:     usecases.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		MCPServers: usecases.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Posts:      usecases.PostsDeps{Posts: d.postRepo},
		PostsTx: usecases.PostsTxDeps{
			Posts:     d.postRepo,
			PostLinks: d.postLinkRepo,
			Assets:    usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		},
		Log: d.log,
	}
}
