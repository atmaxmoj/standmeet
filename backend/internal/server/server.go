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

	authmw "github.com/wangsijie/standmeet/internal/middleware"
	adminroutes "github.com/wangsijie/standmeet/internal/routes/admin"
	sysroutes "github.com/wangsijie/standmeet/internal/routes/sys"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// Deps 是 server 装配需要的依赖；composition root（cmd/server）填这个。
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
	Admin AdminDeps
}

// AdminDeps 把 admin sub-router 需要的业务依赖单独打包。
type AdminDeps struct {
	Claim    usecases.ClaimDeps
	Login    usecases.LoginDeps
	Sessions *session.OwnerSessionStore
}

// New 返回一个挂好路由的 chi router，可直接传给 http.Server。
func New(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(requestLogger(deps.Log))

	r.Route("/internal", func(r chi.Router) {
		sysroutes.Mount(r, sysroutes.Deps{
			DB:    deps.DB,
			Redis: deps.Redis,
			Log:   deps.Log,
		})
	})

	r.Route("/api/admin", func(r chi.Router) {
		adminDeps := adminroutes.Deps{
			Claim: deps.Admin.Claim,
			Auth:  adminroutes.AuthDeps{Login: deps.Admin.Login, Sessions: deps.Admin.Sessions},
			Log:   deps.Log,
		}
		// Unauthed: claim + login（CSRF 也不要，login 自己就要建 session）。
		adminroutes.MountUnauthed(r, adminDeps)
		// Authed: 需要 owner session。CSRF gate 用 RequireCSRF 包写操作。
		r.Group(func(r chi.Router) {
			r.Use(authmw.WithOwner(deps.Admin.Sessions))
			r.Use(authmw.RequireCSRF)
			adminroutes.MountAuthed(r, adminDeps)
		})
	})

	return r
}
