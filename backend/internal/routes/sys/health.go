// Package sys 提供 /internal/* 系统路由：healthz、tls-ask、log 等。
// 只对 instance 内部 / Caddy / 运维系统暴露，不在公开 surface。
//
// 命名注意：路由 prefix 是 /internal/* 但 Go 包名用 sys（避开 Go 关键字
// `internal` 目录的 import 隔离规则）。
package sys

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/wangsijie/standmeet/internal/postgres"
)

const (
	healthCheckTimeout = 3 * time.Second
	statusUp           = "ok"
	statusDown         = "down"
)

// Deps 是 sys handlers 需要的依赖。
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
}

// Mount 把所有 sys 路由挂到 r（已经被父 router 加了 /internal 前缀）。
func Mount(r chi.Router, deps Deps) {
	r.Get("/healthz", healthz(deps))
}

// healthResponse 字段顺序按 pointer/string/bool 对齐到 govet
// fieldalignment 友好的内存排布。
type healthResponse struct {
	DB    string `json:"db"`
	Redis string `json:"redis"`
	OK    bool   `json:"ok"`
}

// healthz 是个薄派发：跑 health check helper + log 异常 + 写响应。
// handler 自己 cyclo 必须 ≤ 3（routes 层强制，见 check-routes-cyclo.sh）。
func healthz(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthCheckTimeout)
		defer cancel()

		resp := computeHealth(ctx, deps)
		logUnhealthy(deps.Log, resp)

		status := http.StatusServiceUnavailable
		if resp.OK {
			status = http.StatusOK
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			deps.Log.Error("encode healthz", "err", err)
		}
	}
}

// computeHealth ping 各依赖，组装 response。
// 拆成两个 helper 每个 cyclo ≤ 3（routes 层强制），避免 flag-parameter
// 又满足 add-constant（statusUp/statusDown 走 const）。
func computeHealth(ctx context.Context, deps Deps) healthResponse {
	db := pingDB(ctx, deps.DB)
	rds := pingRedis(ctx, deps.Redis)
	return healthResponse{DB: db, Redis: rds, OK: db == statusUp && rds == statusUp}
}

func pingDB(ctx context.Context, pool *pgxpool.Pool) string {
	if postgres.Ping(ctx, pool) == nil {
		return statusUp
	}
	return statusDown
}

func pingRedis(ctx context.Context, rdb *redis.Client) string {
	if rdb.Ping(ctx).Err() == nil {
		return statusUp
	}
	return statusDown
}

func logUnhealthy(log *slog.Logger, resp healthResponse) {
	if resp.DB != statusUp {
		log.Warn("healthz pg down")
	}
	if resp.Redis != statusUp {
		log.Warn("healthz redis down")
	}
}
