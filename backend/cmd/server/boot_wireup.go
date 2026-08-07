// boot_wireup.go —— composition root 的 build*Deps helpers。从 main.go 拆出来
// 保持 main.go ≤ 350 行（lint cap）。所有函数都是 d *runtimeDeps → 一个
// sub-router 的 Deps struct，没业务逻辑。

package main

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/axiscap"
	"github.com/atmaxmoj/standmeet/cmd/server/axisconn"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	"github.com/atmaxmoj/standmeet/cmd/server/wire"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

// buildServerDeps —— 把每个 sub-router 的 Deps 块组装出来。serve() 不再
// 直接铺开 50+ 行 struct literal，function-length lint 友好。
func buildServerDeps(d *deps.Runtime) *Deps {
	return &Deps{
		DB:                   d.DB,
		Redis:                d.RDB,
		Log:                  d.Log,
		Admin:                buildAdminDeps(d),
		Public:               buildPublicDeps(d),
		PubAPI:               buildPubAPIDeps(d),
		PublicPage:           buildPublicPageDeps(d),
		PublicSEO:            buildPublicSEODeps(d),
		PublicCustomPages:    buildPublicCustomPageDeps(d),
		PublicAccessRequests: buildPublicAccessRequestsDeps(d),
		PublicPasswordReset:  buildPublicPasswordResetDeps(d),
		PublicWritings: publicroutes.WritingHandlers{
			Writings: corpus.WritingsDeps{Writings: d.WritingRepo},
			CrossLink: corpus.CrossLinkQueryDeps{
				Writings: d.WritingRepo, WritingRefs: d.WritingRefRepo,
			},
			Page:   owner.PageDeps{Owners: d.OwnerRepo, Wiki: d.WikiRepo},
			Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
			Log:    d.Log,
		},
		Builds:       sysroutes.BuilderDeps{Log: d.Log, Builds: d.CustomBuildRepo},
		TLSAsk:       sysroutes.TLSAskDeps{Log: d.Log, Domains: d.InstanceRepo},
		PrintSession: sysroutes.PrintSessionDeps{Log: d.Log, Store: d.PrintStore},
		DiagRegistry: sysroutes.DiagRegistryDeps{Registry: d.AgentSkills, Log: d.Log},
		DiagSession:  buildDiagSessionDeps(d),
		DiagConnector: sysroutes.DiagConnectorDeps{
			Invoke:    diagCategoryInvoke(d),
			AgentCall: d.ConnectorSlots.AgentCall,
			Log:       d.Log,
		},
		DiagSandbox: sysroutes.DiagSandboxDeps{
			Workspaces: d.SandboxWorkspaces, Log: d.Log,
		},
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.CaptchaVerifier,
		CaptchaEnabled:  d.CaptchaEnabled,
		PluginRegistry:  d.PluginRegistry,
		BannedIPs:       d.BannedIPRepo,
		Dispatch:        d.Dispatch,
	}
}

// (boot 时那次一次性维护没了:清 inference_usage 老行现在是 stats 域声明的周期任务,
// 跟别的周期任务同一条路 —— 见 wire/periodic.go。periodic.Start 本来就会在起的时候先跑一遍,
// 所以"boot 清一次"这件事一点没少,只是不再是**唯一**的一次。)

func buildAdminDeps(d *deps.Runtime) AdminDeps {
	return AdminDeps{
		Claim: owner.ClaimDeps{
			Instance: d.InstanceRepo, Skills: d.SkillRepo,
			Prompts: d.PromptRepo, Roles: d.RoleRepo,
		},
		Login:    owner.LoginDeps{Owners: d.OwnerRepo, Sessions: d.SessionStore},
		Keypairs: port.KeypairDeps(d),
		Corpus: corpus.Deps{
			Raw: d.RawRepo, Wiki: d.WikiRepo, Output: d.OutputRepo, NoteRefs: d.NoteRefRepo,
			Subjectivity: d.SubjectivityRepo, VaultSync: d.VaultSyncRepo, Index: d.CorpusIndexer,
		},
		Conversations: conversation.ConversationsDeps{
			Chats: d.ChatRepo, Wiki: d.WikiRepo, Writing: d.WritingRepo, Output: d.OutputRepo,
			Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		},
		Ghosts: conversation.GhostDeps{Repo: d.GhostRepo},
		BYOAI:  owner.BYOAIDeps{Owners: d.OwnerRepo},
		AccessRequests: access.RequestsDeps{
			Repo:   d.AccessRequestRepo,
			Owners: port.NewSoleOwnerLookup(d),
		},
		HandleAdmin:    owner.HandleDeps{Owners: d.OwnerRepo},
		PublicURLAdmin: owner.PublicURLDeps{Owners: d.OwnerRepo},
		AccountAdmin:   owner.AccountDeps{Owners: d.OwnerRepo},
		Recovery:       port.RecoveryDeps(d),
		AIProvider: owner.AIProviderDeps{
			Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
		},
		CustomPages: owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo},
		Skills:      marketplace.SkillsDeps{Skills: d.SkillRepo, Codes: d.CodeRepo},
		Prompts:     owner.PromptsDeps{Prompts: d.PromptRepo},
		Roles: access.RolesDeps{
			Roles: d.RoleRepo,
			Refs:  port.NewRoleRefValidator(d),
		},
		MCPServers:   marketplace.MCPServersDeps{Servers: d.MCPServerRepo, Codes: d.CodeRepo},
		Assets:       corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
		Writings:     corpus.WritingsDeps{Writings: d.WritingRepo},
		WritingRefs:  d.WritingRefRepo,
		SEO:          d.SEORepo,
		Codes:        d.CodeRepo,
		CodeDenials:  d.CodeDenialRepo,
		Owners:       d.OwnerRepo,
		Drafts:       d.ResumeDraftRepo,
		Applications: d.ApplicationRepo,
		Marketplace:  marketplace.SearchDeps{Client: d.MarketplaceClient},
		Connectors:   connectorsAdminDeps(d),
		ApproveRequests: owner.ApproveRequestDeps{
			Reqs: d.AccessRequestRepo, Codes: d.CodeRepo, Roles: d.RoleRepo,
			Owners: d.OwnerRepo, Proxy: port.OutboundSender(d),
		},
		Sessions:     d.SessionStore,
		SecureCookie: d.SecureCookie,
	}
}

// buildDiagSessionDeps —— deps for /internal/diag/session.
// Capability 自身闭包持 deps，本 deps 只装 session store + registry。
func buildDiagSessionDeps(d *deps.Runtime) sysroutes.DiagSessionDeps {
	return sysroutes.DiagSessionDeps{
		Sessions: d.VisitorStore,
		Registry: d.AgentSkills,
		Log:      d.Log,
	}
}

// registerAgentSkills —— 把 visitor-side + owner-side 内建 capability 都
// 注册进 d.agentSkills。跟 build*Deps 共享底层 repo 引用；run() 阶段调用
// 一次，capability 闭包持 deps，server 跑期间 deps 不再变。
func registerAgentSkills(ctx context.Context, d *deps.Runtime) {
	axiscap.SandboxWorkspaces(d)
	// connector 命名依赖注册表一处建、一处 set：ext-mcp dep-grant 闸（工具 _meta.requires
	// 按 grant+connected 放行）与 registerDiscoveredPlugins 的 Requires 校验共用同一份。
	depReg := axisconn.DepRegistry(ctx, d)
	d.AgentSkills.SetDepRegistry(depReg)
	skills := buildVisitorSkillsDeps(d)
	skills.DepConnected = depReg
	capload.RegisterVisitorSkills(d.AgentSkills, &skills, d.ChatRepo)
	// 插件把自己的能力注册进同一个 capreg.Registry(重 ID 由 capreg 兜底 panic)。
	// owner-MCP 那一整套已经不在这条路上了:每个操作由自己的域声明,经出站收口投影到 MCP 面。
	d.PluginRegistry.RegisterAllCapabilities(d.AgentSkills)
	// 入站收口:每个能力在自己的 manifest 里按名字点单,这一句照着发。原来这里是四个手写
	// 网关(summarize / booker / mail-sender / retrieval),各自站一个 socket、各自挂动词。
	wire.HostDesk(ctx, d, &skills)
	wire.SearchIndex(ctx, d)
	hooks := map[string]capload.CapHooks{
		"corpus.retrieval": {Fragment: capload.CorpusScopeVisible},
	}
	// 用量闸按各能力 manifest 里的 Quota 声明装上(闸 + 余量共用一条计数)。
	axiscap.CapabilityQuotaHooks(d, hooks)
	axiscap.RegisterDiscoveredPlugins(d, depReg, hooks)
	axiscap.CapabilityEnableGate(d)
	// 周期任务:各处声明,一份调度。放最后 —— 插件都注册完了,声明才齐。
	wire.PeriodicJobs(ctx, d)
}

// buildVisitorSkillsDeps —— #131: capability 注册所需的原料(各 capability 的窄 deps
// 由 RegisterVisitorSkills 从这里取)。registerAgentSkills 用,不进 Handlers。
func buildVisitorSkillsDeps(d *deps.Runtime) conversation.VisitorSkillsDeps {
	return conversation.VisitorSkillsDeps{
		Wiki: d.WikiRepo, Output: d.OutputRepo, Writings: d.WritingRepo,
		Skills:          d.SkillRepo,
		Sandbox:         d.SandboxRunner,
		MCPServers:      &dialableMCPServers{repo: d.MCPServerRepo},
		Reports:         d.ChatReportRepo,
		Resolver:        d.ProviderResolver,
		AgentConnectors: axisconn.NewAgentConnectorSource(d),
	}
}

// apiKeyDefaultRPM —— instance default rate ceiling for API keys (per-key rate_limit_rpm wins).
const apiKeyDefaultRPM = 120

// newVisitorSessionDeps —— the role-snapshot / assembly dependency bundle shared by the visitor
// public routes and the API-key facade (both freeze a RoleSnapshot the same way).
func newVisitorSessionDeps(d *deps.Runtime) conversation.VisitorSessionDeps {
	return conversation.VisitorSessionDeps{
		Codes: d.CodeRepo, Chats: d.ChatRepo,
		Owners: d.OwnerRepo, Skills: d.SkillRepo,
		Roles: d.RoleRepo, Prompts: d.PromptRepo,
		Sessions:    d.VisitorStore,
		Wiki:        d.WikiRepo,
		Writing:     d.WritingRepo,
		Output:      d.OutputRepo,
		AgentSkills: d.AgentSkills,
		CodeDenials: d.CodeDenialRepo,
		// 冻 role snapshot 时读各能力在这个 role 上的配置。冻结那一步在域里,
		// 而"有哪些能力、各声明了什么"只有这一层知道。
		RoleCapConfig: axiscap.RoleCapConfig(d),
		// 油表(#7):油箱在 owner 域、用量在 stats 域,这一层只问"还剩多少"。
		Gas: port.OwnerGas{Providers: owner.ProvidersUseDeps{
			Owners: d.OwnerRepo, Spend: d.InferenceUsageRepo,
		}},
	}
}

// buildPubAPIDeps —— the API-key facade handlers (/api/pub/v1). Reuses the same visitor assembly +
// role-snapshot machinery so ACL/denial/quota parity with codes holds by construction.
func buildPubAPIDeps(d *deps.Runtime) *pubapi.Handlers {
	vs := newVisitorSessionDeps(d)
	return pubapi.New(&pubapi.Deps{
		Keys:        d.APIKeyRepo,
		Visitor:     &vs,
		AgentSkills: d.AgentSkills,
		Redis:       d.RDB,
		Log:         d.Log,
		DefaultRPM:  apiKeyDefaultRPM,
	})
}

func buildPublicDeps(d *deps.Runtime) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor:      newVisitorSessionDeps(d),
		SecureCookie: d.SecureCookie,
		Outbound:     port.OutboundSender(d),
		Resolver:     d.ProviderResolver,
		Reports:      d.ChatReportRepo,
		Sessions:     d.VisitorStore,
		QueryQueue:   d.QueryQueue,
		Corpus:       d.Corpus,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		Ledger:       conversation.NewWaypointLedger(d.VaultSyncRepo, d.VisitorStore, d.Log),
		Ghosts:       conversation.GhostDeps{Repo: d.GhostRepo},
		PDFRenderer:  d.ReportPDFRenderer,
		AppState:     d.AppStateRepo,
		Usage:        d.InferenceUsageRepo,
		Log:          d.Log,
	}
}

func buildPublicPageDeps(d *deps.Runtime) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: owner.PageDeps{Owners: d.OwnerRepo, Wiki: d.WikiRepo},
		Log:  d.Log,
		TokenIssuer: &setupTokenIssuerAdapter{
			log: d.Log, repo: d.InstanceRepo, holder: d.SetupTokenHolder,
		},
		CaptchaSiteKey: d.CaptchaSiteKey,
		AppVersion:     port.AppVersion(),
		Outbound:       owner.OutboundStatusDeps{Proxy: port.OutboundSender(d)},
	}
}

func buildPublicSEODeps(d *deps.Runtime) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: owner.SEODeps{
			Owners: d.OwnerRepo, SEO: d.SEORepo,
			Wiki: d.WikiRepo, Output: d.OutputRepo,
			NoteRefs: d.NoteRefRepo,
			// 素材:reader 要把正文里的 standmeet-asset 引用解析成可访问地址。
			Media: &corpus.NoteAssetsDeps{
				Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
				Hero:   d.NoteHeroRepo,
			},
			// 多语:身份语言 + 切换器标签(读时补一次,跟 cssclasses 同一个形态)。
			Vault: d.VaultSyncRepo,
		},
		Sessions: d.VisitorStore,
		Log:      d.Log,
	}
}

func buildPublicCustomPageDeps(d *deps.Runtime) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo},
		Owners:     d.OwnerRepo,
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
	}
}

func buildPublicAccessRequestsDeps(d *deps.Runtime) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: access.RequestsDeps{
			Repo:   d.AccessRequestRepo,
			Owners: port.NewSoleOwnerLookup(d),
		},
		Log: d.Log,
	}
}

func buildPublicPasswordResetDeps(d *deps.Runtime) publicroutes.PasswordResetHandlers {
	return publicroutes.PasswordResetHandlers{
		Deps: owner.PasswordResetDeps{Owners: d.OwnerRepo},
		Log:  d.Log,
	}
}

func buildMCPDeps(d *deps.Runtime) mcphandle.Deps {
	// 工具两个来源:capreg(能力轴上真正的能力,如 booker 的 OwnerTools)+ dispatcher
	// (出站收口,MCP 面是它的投影)。两者不重叠:前者是插件自带的,后者是域声明的。
	return mcphandle.Deps{
		AgentSkills: d.AgentSkills,
		Dispatcher:  d.Dispatch,
		Keypairs:    port.KeypairDeps(d),
		Log:         d.Log,
	}
}

// connectorsAdminDeps —— admin connectors 面板依赖:能力经收口取,编排服务只剩浏览器专属的
// 那几条(OAuth 跳转、明文凭据表单)还在直连。
func connectorsAdminDeps(d *deps.Runtime) adminroutes.ConnectorsAdminDeps {
	return adminroutes.ConnectorsAdminDeps{
		Svc: axisconn.NewService(d), Face: wire.AdminFace(d.Dispatch),
	}
}
