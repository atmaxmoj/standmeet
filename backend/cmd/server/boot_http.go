// boot_http.go —— composition root 的 HTTP 装配(原 internal/infra/server,按
// routes-not-imported/infra-not-domain 层次移进 cmd)。把各 routes 子包的 Mount 拉到一起,
// 加跨 sub-router 共享中间件(request id、slog request log、recovery)。不做业务。

package main

import (
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/cmd/server/wire"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// Deps 是 server 装配需要的依赖；composition root（cmd/server）填这个。
// AdminDeps 放最后让里面的 bool 字段在尾部 padding 上不浪费。
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
	// CaptchaVerifier —— login captcha 校验器；composition root 按 env
	// 装配（turnstile / noop）。
	CaptchaVerifier   security.Verifier
	Public            publicroutes.Handlers
	PublicPage        publicroutes.PageHandlers
	PublicSEO         publicroutes.SEOHandlers
	PublicCustomPages publicroutes.CustomPageHandlers
	// PublicCustomPagePreview —— owner 面板里那块预览。公开侧但**凭令牌**:
	// 它必须在没有 admin cookie 时也能服务(沙箱 iframe 的子资源不带 cookie)。
	PublicCustomPagePreview publicroutes.CustomPagePreviewHandlers
	PublicAccessRequests    publicroutes.AccessRequestsHandlers
	PublicPasswordReset     publicroutes.PasswordResetHandlers
	PublicWritings          publicroutes.WritingHandlers
	Builds                  sysroutes.BuilderDeps
	TLSAsk                  sysroutes.TLSAskDeps
	PrintSession            sysroutes.PrintSessionDeps
	DiagRegistry            sysroutes.DiagRegistryDeps
	DiagSession             sysroutes.DiagSessionDeps
	DiagConnector           sysroutes.DiagConnectorDeps
	DiagSandbox             sysroutes.DiagSandboxDeps
	// PluginRegistry —— J.5: outbound plugins 一次性注册全套 admin REST hook。
	// mountAdmin 在 WithOwner+RequireCSRF group 内调 MountAllAdminRoutes。
	PluginRegistry *capabilities.Registry
	// BannedIPs —— 封禁 IP repo；公开面 BanGuard 用（enforcement，不是 owner 能力）。
	BannedIPs *security.BannedIPRepo
	// Dispatch —— 出站收口。admin 面的能力只能从这儿 wire（路由形状仍照常手写）。
	Dispatch *dispatcher.Dispatcher
	// PubAPI —— the API-key facade (/api/pub/v1); api-key auth in its own middleware.
	PubAPI *pubapi.Handlers
	MCP    mcphandle.Deps
	Admin  AdminDeps
	// CaptchaEnabled —— captcha 是否真启用(非 noop);#169 code guard 的 captcha-escape。
	CaptchaEnabled bool
}

// AdminDeps 把 admin sub-router 需要的业务依赖单独打包。
type AdminDeps struct {
	Corpus          corpus.Deps
	ApproveRequests owner.ApproveRequestDeps
	Conversations   conversation.ConversationsDeps
	Marketplace     marketplace.SearchDeps
	Keypairs        owner.KeypairDeps
	Claim           owner.ClaimDeps
	MCPServers      marketplace.MCPServersDeps
	Recovery        owner.RecoveryDeps
	AccessRequests  access.RequestsDeps
	EmailChange     owner.EmailChangeDeps
	AIProvider      owner.AIProviderDeps
	Roles           access.RolesDeps
	Login           owner.LoginDeps
	Connectors      adminroutes.ConnectorsAdminDeps
	Assets          corpus.AssetsDeps
	Skills          marketplace.SkillsDeps
	Prompts         owner.PromptsDeps
	Owners          *owner.Repo
	AccountAdmin    owner.AccountDeps
	PublicURLAdmin  owner.PublicURLDeps
	Writings        corpus.WritingsDeps
	WritingRefs     *corpus.WritingRefRepo
	SEO             *corpus.SEORepo
	Codes           *access.CodeRepo
	CodeDenials     *access.CodeDenialRepo
	Sessions        *session.OwnerSessionStore
	Drafts          *jobsuc.ResumeDraftRepo
	Applications    *jobsuc.ApplicationRepo
	HandleAdmin     owner.HandleDeps
	BYOAI           owner.BYOAIDeps
	Ghosts          conversation.GhostDeps
	CustomPages     owner.CustomPageDeps
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
	// RealIP 之后：判一次来源地址到底是不是访客的。没有转发头时 RemoteAddr 停在
	// app 那一跳上，拿它冒充访客会让 IP 栏 / 封禁 / 暴力锁全部改变含义 —— 见 clientaddr。
	r.Use(clientaddr.Middleware(deps.Log))
	r.Use(chimw.Recoverer)
	r.Use(requestLogger(deps.Log))

	mountInternal(r, deps)
	mountAdmin(r, deps)
	mountPublic(r, deps)
	mountRootSEO(r, deps)
	if deps.PubAPI != nil {
		deps.PubAPI.Mount(r)
	}
	// 两个 MCP 面，两个平面：`/mcp` 是 owner 自己的（Sigv1 验签），
	// `/mcp/visitor` 是**拿着码的人**的（Bearer 那张码）。
	// 先挂访客那条：chi 的 Mount 按前缀匹配，`/mcp` 挂在前面会把它一起吃掉。
	r.Mount("/mcp/visitor",
		deps.Public.MountVisitorMCP(paritymanifest.APIRenderableTools()))
	r.Mount("/mcp", mcphandle.New(&deps.MCP))
	assertDispatcherConformance(deps)
	return r
}

// assertDispatcherConformance —— 全部面都挂完之后,拿每个 op 的 Reach 跟各个面实际投影的对一遍。
// 有欠账就**不让这个进程活下去**。
//
// 为什么是 panic 而不是日志:少一个面的能力不会让任何请求报错 —— 它只是安静地不存在。这种缺陷
// 只有人去用的时候才会发现,而那时它已经上线了。启动即失败,是唯一能把它挡在上线之前的形态。
//
// 这也是那张手写对照表被替换掉的东西:它只在有人跑测试时才对账,而且要有人记得往里加行。
func assertDispatcherConformance(deps *Deps) {
	if deps.Dispatch == nil {
		return // 测试里可以不接收口
	}
	if report := deps.Dispatch.ConformReport(); report != "" {
		panic("dispatcher: a face does not match the outbound convergence point — " +
			"some capability is not projected onto a face it is owed on:\n" + report)
	}
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
		adminH.MountUnauthed(r, authmw.LoginGuard(
			deps.Redis, deps.CaptchaVerifier, deps.CaptchaEnabled,
		))
		r.Group(func(r chi.Router) {
			r.Use(authmw.WithOwner(deps.Admin.Sessions))
			r.Use(authmw.RequireCSRF)
			adminH.MountAuthed(r, authmw.CredentialGuard(deps.Redis))
			// 连接器 diag（owner-authed，session cookie path=/api/admin 才到这）。
			sysroutes.MountDiagConnector(r, deps.DiagConnector)
			// #147 沙箱管理面（owner-authed；复用 diag handler，路径 /api/admin/sandbox/*）。
			sysroutes.MountAdminSandbox(r, deps.DiagSandbox)
			deps.PluginRegistry.MountAllAdminRoutes(r)
		})
	})
}

func buildAdminHandlers(deps *Deps) *adminroutes.Handlers {
	pins := owner.PagePinDeps{Owners: deps.Admin.Owners, Wiki: deps.Admin.Corpus.Wiki}
	return &adminroutes.Handlers{
		Claim: deps.Admin.Claim,
		Auth: adminroutes.AuthDeps{
			Login: deps.Admin.Login, Sessions: deps.Admin.Sessions,
		},
		KeypairsAdmin: adminroutes.KeypairsAdminDeps{
			Deps: deps.Admin.Keypairs, Log: deps.Log,
		},
		Corpus: adminroutes.CorpusDeps{
			Corpus: deps.Admin.Corpus, Face: wire.AdminFace(deps.Dispatch),
		},
		CodesAdmin: adminroutes.CodesDeps{Face: wire.AdminFace(deps.Dispatch)},
		// APIKeysAdmin —— 外发 key 的网页面(F-K-1)。同一个 AdminFace:它按 op 的 reach 过滤,
		// 而那四个 op 现在声明的是 OwnerRead/OwnerAction(两个 owner 面都长),不再是 mcp-only。
		APIKeysAdmin:   adminroutes.APIKeysAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		PageAdmin:      adminroutes.PageAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		SEOAdmin:       adminroutes.SEOAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		Conversations:  adminroutes.ConversationsDeps{Face: wire.AdminFace(deps.Dispatch)},
		BYOAI:          adminroutes.BYOAIDeps{Face: wire.AdminFace(deps.Dispatch)},
		Domains:        adminroutes.DomainsDeps{Face: wire.AdminFace(deps.Dispatch)},
		AccessRequests: adminroutes.AccessRequestsDeps{Face: wire.AdminFace(deps.Dispatch)},
		HandleAdmin:    adminroutes.HandleDeps{Face: wire.AdminFace(deps.Dispatch)},
		PublicURLAdmin: adminroutes.PublicURLDeps{Face: wire.AdminFace(deps.Dispatch)},
		AccountAdmin:   adminroutes.AccountDeps{Face: wire.AdminFace(deps.Dispatch)},
		Recovery:       deps.Admin.Recovery,

		// 插件那份 builtin 由装配根递进去 —— 注册表住在这儿，路由层够不到它。
		SeedPlugins:      deps.PluginRegistry.SeedAllOwners,
		AIProviderAdmin:  adminroutes.AIProviderDeps{Face: wire.AdminFace(deps.Dispatch)},
		ProvidersAdmin:   adminroutes.ProvidersAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		CustomPagesAdmin: adminroutes.CustomPagesDeps{Face: wire.AdminFace(deps.Dispatch)},
		// 预览走域，不走 dispatcher：它发的是**文件字节**，而收口那条路是
		// JSON op。跟公开侧 /p/{slug} 同一个理由。
		SkillsAdmin:     adminroutes.SkillsAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		PromptsAdmin:    adminroutes.PromptsAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		RolesAdmin:      adminroutes.RolesAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		MCPServersAdmin: adminroutes.MCPServersAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		WritingsAdmin: adminroutes.WritingsAdminDeps{
			Face: wire.AdminFace(deps.Dispatch),
			WritingsTx: corpus.WritingsTxDeps{
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
			WritingsTx: corpus.WritingsTxDeps{
				Writings: deps.Admin.Writings.Writings, WritingRefs: deps.Admin.WritingRefs,
				Assets: deps.Admin.Assets,
			},
			PagePins: pins,
			// 同一个 owners 仓储：它已经是 CSS 的落点，导入回执（UX-62）也挂在 owner 上 ——
			// 一个实例只有一份 vault。
			ImportReceipt: deps.Admin.Owners,
			Log:           deps.Log,
		},
		MarketplaceAdmin:  adminroutes.MarketplaceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		ConnectorsAdmin:   deps.Admin.Connectors,
		CapabilitiesAdmin: adminroutes.CapabilityAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		IPBansAdmin:       adminroutes.IPBansAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		InstanceAdmin:     adminroutes.InstanceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		AppearanceAdmin:   adminroutes.AppearanceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		CapabilityConfigAdmin: adminroutes.CapabilityConfigAdminDeps{
			Face: wire.AdminFace(deps.Dispatch),
		},
		Log:          deps.Log,
		SecureCookie: deps.Admin.SecureCookie,
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
	// 留言口那道闸（F-G-4）：同一处装配、同一套零件，只是数的东西不同 —— 那边数猜错的码，
	// 这边数发出来的留言。少了它，owner 亲手读的那个队列前面只有一层 fail-open 限流。
	deps.PublicAccessRequests.Guard = authmw.NewRequestGuard(
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
		(&deps.PublicCustomPagePreview).Mount(r) // 预览:公开侧但凭令牌
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
