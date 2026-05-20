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

	"github.com/wangsijie/standmeet/internal/mcp"
	authmw "github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
	adminroutes "github.com/wangsijie/standmeet/internal/routes/admin"
	publicroutes "github.com/wangsijie/standmeet/internal/routes/public"
	sysroutes "github.com/wangsijie/standmeet/internal/routes/sys"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// Deps 是 server 装配需要的依赖；composition root（cmd/server）填这个。
// AdminDeps 放最后让里面的 bool 字段在尾部 padding 上不浪费。
type Deps struct {
	DB                   *pgxpool.Pool
	Redis                *redis.Client
	Log                  *slog.Logger
	Public               publicroutes.Handlers
	PublicPage           publicroutes.PageHandlers
	PublicSEO            publicroutes.SEOHandlers
	PublicCustomPages    publicroutes.CustomPageHandlers
	PublicAccessRequests publicroutes.AccessRequestsHandlers
	Builds               sysroutes.BuilderDeps
	TLSAsk               sysroutes.TLSAskDeps
	MCP                  mcp.Deps
	Admin                AdminDeps
}

// AdminDeps 把 admin sub-router 需要的业务依赖单独打包。
type AdminDeps struct {
	Claim          usecases.ClaimDeps
	Login          usecases.LoginDeps
	APITokens      usecases.APITokenDeps
	Corpus         usecases.CorpusDeps
	Conversations  usecases.ConversationsDeps
	BYOAI          usecases.BYOAIDeps
	Domains        usecases.AllowedDomainsDeps
	AccessRequests usecases.AccessRequestsDeps
	HandleAdmin    usecases.HandleDeps
	AIProvider     usecases.AIProviderDeps
	Codes          *postgres.CodeRepo
	Pages          *postgres.PageRepo
	Sessions       *session.OwnerSessionStore
	SecureCookie   bool
}

// New 返回一个挂好路由的 chi router，可直接传给 http.Server。
// pointer 接收避免 gocritic hugeParam。
func New(deps *Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(requestLogger(deps.Log))

	mountInternal(r, deps)
	mountAdmin(r, deps)
	mountPublic(r, deps)
	mountRootSEO(r, deps)
	r.Mount("/mcp", mcp.New(&deps.MCP))
	return r
}

func mountInternal(r chi.Router, deps *Deps) {
	r.Route("/internal", func(r chi.Router) {
		sysroutes.Mount(r, sysroutes.Deps{DB: deps.DB, Redis: deps.Redis, Log: deps.Log})
		sysroutes.MountBuilds(r, deps.Builds)
		sysroutes.MountTLSAsk(r, deps.TLSAsk)
	})
}

func mountAdmin(r chi.Router, deps *Deps) {
	r.Route("/api/admin", func(r chi.Router) {
		adminH := buildAdminHandlers(deps)
		adminH.MountUnauthed(r)
		r.Group(func(r chi.Router) {
			r.Use(authmw.WithOwner(deps.Admin.Sessions))
			r.Use(authmw.RequireCSRF)
			adminH.MountAuthed(r)
		})
	})
}

func buildAdminHandlers(deps *Deps) *adminroutes.Handlers {
	return &adminroutes.Handlers{
		Claim: deps.Admin.Claim,
		Auth: adminroutes.AuthDeps{
			Login: deps.Admin.Login, Sessions: deps.Admin.Sessions,
		},
		APITokens:       deps.Admin.APITokens,
		Corpus:          adminroutes.CorpusDeps{Corpus: deps.Admin.Corpus},
		CodesAdmin:      adminroutes.CodesDeps{Codes: deps.Admin.Codes},
		PageAdmin:       adminroutes.PageAdminDeps{Pages: deps.Admin.Pages},
		Conversations:   adminroutes.ConversationsDeps{Conv: deps.Admin.Conversations},
		BYOAI:           adminroutes.BYOAIDeps{BYOAI: deps.Admin.BYOAI},
		Domains:         adminroutes.DomainsDeps{Domains: deps.Admin.Domains},
		AccessRequests:  adminroutes.AccessRequestsDeps{Reqs: deps.Admin.AccessRequests},
		HandleAdmin:     adminroutes.HandleDeps{Handle: deps.Admin.HandleAdmin},
		AIProviderAdmin: adminroutes.AIProviderDeps{AI: deps.Admin.AIProvider},
		Log:             deps.Log,
		SecureCookie:    deps.Admin.SecureCookie,
	}
}

func mountPublic(r chi.Router, deps *Deps) {
	r.Route("/api/v1", func(r chi.Router) {
		(&publicroutes.Handlers{
			Visitor:  deps.Public.Visitor,
			Sessions: deps.Public.Sessions,
			Log:      deps.Log,
		}).Mount(r)
		(&publicroutes.PageHandlers{Page: deps.PublicPage.Page, Log: deps.Log}).Mount(r)
		(&publicroutes.SEOHandlers{
			Deps: deps.PublicSEO.Deps, Log: deps.Log, PublicURL: deps.PublicSEO.PublicURL,
		}).Mount(r)
		(&publicroutes.CustomPageHandlers{
			Deps:       deps.PublicCustomPages.Deps,
			Owners:     deps.PublicCustomPages.Owners,
			Log:        deps.Log,
			BuildsRoot: deps.PublicCustomPages.BuildsRoot,
		}).Mount(r)
		(&publicroutes.AccessRequestsHandlers{
			Reqs: deps.PublicAccessRequests.Reqs, Log: deps.Log,
		}).Mount(r)
	})
}

func mountRootSEO(r chi.Router, deps *Deps) {
	// /robots.txt + /sitemap.xml 是 SEO 标准约定路径，不走 /api/v1。
	(&publicroutes.SEOHandlers{
		Deps: deps.PublicSEO.Deps, Log: deps.Log, PublicURL: deps.PublicSEO.PublicURL,
	}).MountRoot(r)
}
