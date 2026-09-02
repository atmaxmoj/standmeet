// Package sys provides /internal/* system routes: healthz, tls-ask, log, etc.
// Exposed only to the instance's internals / Caddy / ops systems, not on the public
// surface.
//
// Naming note: the route prefix is /internal/* but the Go package is named sys
// (avoiding the import-isolation rule Go applies to a directory literally named
// `internal`, a reserved keyword).
package sys

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	healthCheckTimeout = 3 * time.Second
	statusUp           = "ok"
	statusDown         = "down"
)

// Deps holds the dependencies sys handlers need.
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
}

// Mount mounts all sys routes onto r (the parent router has already added the /internal
// prefix).
func Mount(r chi.Router, deps Deps) {
	r.Get("/healthz", healthz(deps))
}

// healthResponse field order follows pointer/string/bool to align with a memory
// layout govet fieldalignment is happy with.
type healthResponse struct {
	DB    string `json:"db"`
	Redis string `json:"redis"`
	OK    bool   `json:"ok"`
}

// healthz is a thin dispatch: runs the health-check helper, logs anomalies, writes the
// response. The handler itself must keep cyclo <= 3 (enforced at the routes layer,
// see check-routes-cyclo.sh).
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

// computeHealth pings each dependency and assembles the response.
// Split into two helpers, each cyclo <= 3 (enforced at the routes layer), to avoid a
// flag-parameter while also satisfying add-constant (statusUp/statusDown go through
// const).
func computeHealth(ctx context.Context, deps Deps) healthResponse {
	db := pingDB(ctx, deps.DB)
	rds := pingRedis(ctx, deps.Redis)
	return healthResponse{DB: db, Redis: rds, OK: db == statusUp && rds == statusUp}
}

func pingDB(ctx context.Context, pool *pgxpool.Pool) string {
	if pgstore.Ping(ctx, pool) == nil {
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
