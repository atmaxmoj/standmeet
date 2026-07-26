// Package server 装配 chi 路由（不做业务）。把各 interfaces 子包的 Mount
// 拉到一起，加上跨 sub-router 共享的中间件（request id、slog request log、
// recovery）。
package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	authmw "github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/plugins"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
	"github.com/atmaxmoj/standmeet/internal/security"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// Deps 是 server 装配需要的依赖；composition root（cmd/server）填这个。
// AdminDeps 放最后让里面的 bool 字段在尾部 padding 上不浪费。
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
	// CaptchaVerifier —— login captcha 校验器；composition root 按 env
	// 装配（turnstile / noop）。
	CaptchaVerifier      security.Verifier
	Public               publicroutes.Handlers
	PublicPage           publicroutes.PageHandlers
	PublicSEO            publicroutes.SEOHandlers
	PublicCustomPages    publicroutes.CustomPageHandlers
	PublicAccessRequests publicroutes.AccessRequestsHandlers
	PublicPasswordReset  publicroutes.PasswordResetHandlers
	PublicWritings       publicroutes.WritingHandlers
	Builds               sysroutes.BuilderDeps
	TLSAsk               sysroutes.TLSAskDeps
	PrintSession         sysroutes.PrintSessionDeps
	DiagRegistry         sysroutes.DiagRegistryDeps
	DiagSession          sysroutes.DiagSessionDeps
	DiagConnector        sysroutes.DiagConnectorDeps
	DiagSandbox          sysroutes.DiagSandboxDeps
	// PluginRegistry —— J.5: outbound plugins 一次性注册全套 admin REST hook。
	// mountAdmin 在 WithOwner+RequireCSRF group 内调 MountAllAdminRoutes。
	PluginRegistry *plugins.Registry
	// BannedIPs —— 封禁 IP repo；公开面 BanGuard + admin ip-bans CRUD 共用。
	BannedIPs *security.BannedIPRepo
	// PubAPI —— the API-key facade (/api/pub/v1); api-key auth in its own middleware.
	PubAPI *pubapi.Handlers
	MCP    mcphandle.Deps
	Admin  AdminDeps
	// CaptchaEnabled —— captcha 是否真启用(非 noop);#169 code guard 的 captcha-escape。
	CaptchaEnabled bool
}

// AdminDeps 把 admin sub-router 需要的业务依赖单独打包。
type AdminDeps struct {
	Claim           usecases.ClaimDeps
	Login           usecases.LoginDeps
	Keypairs        usecases.KeypairDeps
	Corpus          usecases.CorpusDeps
	Conversations   usecases.ConversationsDeps
	Ghosts          usecases.GhostDeps
	BYOAI           usecases.BYOAIDeps
	Domains         usecases.AllowedDomainsDeps
	AccessRequests  usecases.AccessRequestsDeps
	HandleAdmin     usecases.HandleDeps
	PublicURLAdmin  usecases.PublicURLDeps
	AccountAdmin    usecases.AccountDeps
	Recovery        usecases.RecoveryDeps
	AIProvider      usecases.AIProviderDeps
	CustomPages     usecases.CustomPageDeps
	Skills          usecases.SkillsDeps
	Prompts         usecases.PromptsDeps
	Roles           usecases.RolesDeps
	MCPServers      usecases.MCPServersDeps
	Assets          usecases.AssetsDeps
	Writings        usecases.WritingsDeps
	WritingRefs     *corpus.WritingRefRepo
	SEO             *corpus.SEORepo
	Codes           *access.CodeRepo
	Booking         adminroutes.BookingQuotaStore // #135: booker 自管的 per-code 预约配额读写口
	CodeDenials     *access.CodeDenialRepo
	Owners          *owner.Repo
	Drafts          *postgres.ResumeDraftRepo
	Applications    *postgres.ApplicationRepo
	Marketplace     usecases.MarketplaceDeps
	Calendar        adminroutes.CalendarAdminDeps
	Connectors      adminroutes.ConnectorsAdminDeps
	Capabilities    adminroutes.CapabilityAdminDeps
	ApproveRequests usecases.ApproveRequestDeps
	Sessions        *session.OwnerSessionStore
	Usage           adminroutes.InferenceUsageSummarizer // #106 计费面板
	SystemInfo      adminroutes.SystemInfoProvider       // #101 system 面板
	Growth          adminroutes.GrowthProvider           // Monitor: SystemPulse
	Activity        adminroutes.ActivityProvider         // Monitor: ActivityTicker
	Jobs            adminroutes.JobsProvider             // Monitor: background jobs
	SecureCookie    bool
}

// New 返回一个挂好路由的 chi router，可直接传给 http.Server。
// pointer 接收避免 gocritic hugeParam。
func New(deps *Deps) http.Handler {
	// QUERY (RFC 10008) 是 chi 默认方法表外的扩展方法；注册后 r.Method("QUERY", ...) 才不 panic。
	// 只读工具的 dispatch 路由用它（routes/public/chat.go）。必须在挂路由前调。
	chi.RegisterMethod("QUERY")
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(requestLogger(deps.Log))

	mountInternal(r, deps)
	mountAdmin(r, deps)
	mountPublic(r, deps)
	mountRootSEO(r, deps)
	if deps.PubAPI != nil {
		deps.PubAPI.Mount(r)
	}
	r.Mount("/mcp", mcphandle.New(&deps.MCP))
	return r
}

func mountInternal(r chi.Router, deps *Deps) {
	r.Route("/internal", func(r chi.Router) {
		sysroutes.Mount(r, sysroutes.Deps{DB: deps.DB, Redis: deps.Redis, Log: deps.Log})
		sysroutes.MountBuilds(r, deps.Builds)
		sysroutes.MountTLSAsk(r, deps.TLSAsk)
		sysroutes.MountPrintSession(r, deps.PrintSession)
		sysroutes.MountDiagRegistry(r, deps.DiagRegistry)
		sysroutes.MountDiagSandbox(r, deps.DiagSandbox)
		sysroutes.MountDiagSession(r, deps.DiagSession)
	})
}

func mountAdmin(r chi.Router, deps *Deps) {
	r.Route("/api/admin", func(r chi.Router) {
		adminH := buildAdminHandlers(deps)
		adminH.MountUnauthed(r, authmw.LoginGuard(deps.Redis, deps.CaptchaVerifier))
		r.Group(func(r chi.Router) {
			r.Use(authmw.WithOwner(deps.Admin.Sessions))
			r.Use(authmw.RequireCSRF)
			adminH.MountAuthed(r)
			// 连接器 diag（owner-authed，session cookie path=/api/admin 才到这）。
			sysroutes.MountDiagConnector(r, deps.DiagConnector)
			// #147 沙箱管理面（owner-authed；复用 diag handler，路径 /api/admin/sandbox/*）。
			sysroutes.MountAdminSandbox(r, deps.DiagSandbox)
			deps.PluginRegistry.MountAllAdminRoutes(r)
		})
	})
}

func buildAdminHandlers(deps *Deps) *adminroutes.Handlers {
	pins := usecases.PagePinDeps{
		Owners: deps.Admin.Owners, Wiki: deps.Admin.Corpus.Wiki,
	}
	return &adminroutes.Handlers{
		Claim: deps.Admin.Claim,
		Auth: adminroutes.AuthDeps{
			Login: deps.Admin.Login, Sessions: deps.Admin.Sessions,
		},
		KeypairsAdmin: adminroutes.KeypairsAdminDeps{
			Deps: deps.Admin.Keypairs, Log: deps.Log,
		},
		Corpus: adminroutes.CorpusDeps{Corpus: deps.Admin.Corpus},
		CodesAdmin: adminroutes.CodesDeps{
			Codes: deps.Admin.Codes, Roles: deps.Admin.Roles.Roles,
			Sessions: deps.Public.Sessions, Denials: deps.Admin.CodeDenials,
			Booking: deps.Admin.Booking,
		},
		PageAdmin: adminroutes.PageAdminDeps{Owners: deps.Admin.Owners, Pins: pins},
		SEOAdmin:  adminroutes.SEOAdminDeps{SEO: deps.Admin.SEO, Pins: pins},
		Conversations: adminroutes.ConversationsDeps{
			Chats:  deps.Admin.Conversations,
			Ghosts: deps.Admin.Ghosts,
		},
		BYOAI:   adminroutes.BYOAIDeps{BYOAI: deps.Admin.BYOAI},
		Domains: adminroutes.DomainsDeps{Domains: deps.Admin.Domains},
		AccessRequests: adminroutes.AccessRequestsDeps{
			Reqs: deps.Admin.AccessRequests, Approve: deps.Admin.ApproveRequests,
		},
		HandleAdmin:     adminroutes.HandleDeps{Handle: deps.Admin.HandleAdmin},
		PublicURLAdmin:  adminroutes.PublicURLDeps{PublicURL: deps.Admin.PublicURLAdmin},
		AccountAdmin:    adminroutes.AccountDeps{Account: deps.Admin.AccountAdmin},
		Recovery:        deps.Admin.Recovery,
		AIProviderAdmin: adminroutes.AIProviderDeps{AI: deps.Admin.AIProvider},
		CustomPages:     deps.Admin.CustomPages,
		SkillsAdmin:     adminroutes.SkillsAdminDeps{Skills: deps.Admin.Skills},
		PromptsAdmin:    adminroutes.PromptsAdminDeps{Prompts: deps.Admin.Prompts},
		RolesAdmin:      adminroutes.RolesAdminDeps{Roles: deps.Admin.Roles},
		MCPServersAdmin: adminroutes.MCPServersAdminDeps{Servers: deps.Admin.MCPServers},
		WritingsAdmin: adminroutes.WritingsAdminDeps{
			Writings: deps.Admin.Writings,
			WritingsTx: usecases.WritingsTxDeps{
				Writings: deps.Admin.Writings.Writings, WritingRefs: deps.Admin.WritingRefs,
				Assets: deps.Admin.Assets,
			},
			Tree: deps.Admin.Writings.Writings,
		},
		Obsidian: adminroutes.ObsidianDeps{
			Writings: deps.Admin.Writings.Writings,
			Assets:   deps.Admin.Assets.Repo,
			Storage:  deps.Admin.Assets.Storage,
			Corpus:   deps.Admin.Corpus, // sync face: VaultSync + Raw + WikiRefs 都在这
			CSS:      deps.Admin.Owners, // .obsidian/snippets harvest → owner CSS
			WritingsTx: usecases.WritingsTxDeps{
				Writings: deps.Admin.Writings.Writings, WritingRefs: deps.Admin.WritingRefs,
				Assets: deps.Admin.Assets,
			},
			PagePins: pins,
			Log:      deps.Log,
		},
		MarketplaceAdmin:  adminroutes.MarketplaceAdminDeps{Deps: deps.Admin.Marketplace},
		CalendarAdmin:     deps.Admin.Calendar,
		ConnectorsAdmin:   deps.Admin.Connectors,
		CapabilitiesAdmin: deps.Admin.Capabilities,
		IPBansAdmin:       adminroutes.IPBansAdminDeps{Repo: deps.BannedIPs},
		Usage:             deps.Admin.Usage,
		SystemInfo:        deps.Admin.SystemInfo,
		Growth:            deps.Admin.Growth,
		Activity:          deps.Admin.Activity,
		Jobs:              deps.Admin.Jobs,
		Log:               deps.Log,
		SecureCookie:      deps.Admin.SecureCookie,
	}
}

func mountPublic(r chi.Router, deps *Deps) {
	// 直接挂 wireup 构好的 Handlers 值，不再字段一个个重抄 (G-1.5 smell E:
	// 之前 Handlers 加字段 wireup 改了但 mount 漏抄 → silent nil 跑了一阵)。
	// #169 访问码兑换失败锁定：middleware wiring 归 server 层(cmd 不引 middleware),跟
	// LoginGuard 同处装配。注入进 public Handlers 的窄 CodeGuard 接口。
	deps.Public.CodeGuard = authmw.NewCodeGuard(
		deps.Redis, deps.CaptchaVerifier, deps.CaptchaEnabled,
	)
	r.Route("/api/v1", func(r chi.Router) {
		// CORS 最外层：embed 从任意 origin 跨源加载，preflight + ACAO 头得先于
		// Ban/Rate 挂上（即便后面 403/429 也要能被跨源 JS 读到）。D.2 wide-open。
		r.Use(authmw.PublicCORS)
		// 封禁 IP 先挡（403），再 per-IP 限流公开滥用面（429）。
		r.Use(authmw.BanGuard(deps.BannedIPs))
		r.Use(authmw.PublicRateGuard(deps.Redis))
		(&deps.Public).Mount(r)
		(&deps.PublicPage).Mount(r)
		(&deps.PublicSEO).Mount(r)
		(&deps.PublicCustomPages).Mount(r)
		(&deps.PublicAccessRequests).Mount(r)
		(&deps.PublicPasswordReset).Mount(r)
		(&deps.PublicWritings).Mount(r)
		// Fallback 让 /prompts/{id} 在 embed .md 未命中时返 registry 里外置能力的
		// fragment 文本（capabilities/<id> 已搬进插件 instructions，无 .md）。
		(&publicroutes.PromptsHandlers{
			Log:      deps.Log,
			Fallback: deps.DiagRegistry.Registry.PromptFragmentText,
		}).Mount(r)
	})
}

func mountRootSEO(r chi.Router, deps *Deps) {
	// /robots.txt + /sitemap.xml 是 SEO 标准约定路径，不走 /api/v1。
	(&publicroutes.SEOHandlers{Deps: deps.PublicSEO.Deps, Log: deps.Log}).MountRoot(r)
}
