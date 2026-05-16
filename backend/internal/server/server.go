// Package server 装配 chi 路由（不做业务）。把各 interfaces 子包的 Mount
// 拉到一起，加上跨 sub-router 共享的中间件（request id、slog request log、
// recovery）。
package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	sysroutes "github.com/wangsijie/standmeet/internal/routes/sys"
)

// Deps 是 server 装配需要的依赖；composition root（cmd/server）填这个。
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
}

// New 返回一个挂好路由的 chi router，可直接传给 http.Server。
func New(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(requestLogger(deps.Log))

	r.Route("/internal", func(r chi.Router) {
		sysroutes.Mount(r, sysroutes.Deps{
			DB:    deps.DB,
			Redis: deps.Redis,
			Log:   deps.Log,
		})
	})

	return r
}
