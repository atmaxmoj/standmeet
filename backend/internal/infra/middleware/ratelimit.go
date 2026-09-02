package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	publicRateKeyPfx = "ratelimit:pub:"
	publicRateWindow = time.Minute
)

// publicRatePolicy is the per-IP per-minute cap for public endpoints. key =
// "METHOD PATH", matched exactly against r.Method+" "+r.URL.Path; no match
// → not rate-limited (GET reads pass through).
//
// Thresholds are set wider than a normal visitor, narrower than scripted
// abuse. e2e flushRedis on every spec reset, and a single spec's cumulative
// count stays well under these caps, so tests aren't caught by mistake.
//
// This is a deliberately centralized, grep-able table of public abuse
// policy; remember to keep it in sync when a public route's path changes.
var publicRatePolicy = map[string]int64{
	"POST /api/v1/sessions":    120,
	"POST /api/v1/codes/intro": 120,
	// access-requests already has `RequestGuard` in front of it (5 per 15
	// minutes, see request_guard.go) — **the 30 here is effectively
	// unreachable**, it's only a backstop at this "per-minute window"
	// layer, don't read it as this endpoint's real cap.
	"POST /api/v1/access-requests":        30,
	"POST /api/v1/agent/turn":             120,
	"POST /api/v1/account/reset-password": 20,
}

// PublicRateGuard is a route-aware per-IP fixed-window rate-limit
// middleware. Mounted on the /api/v1 public group; publicRatePolicy decides
// whether a given request is counted + rate-limited, returning 429 over
// the limit.
//
// Fail-open on a redis failure (logged as warn, then allowed): the public
// visitor surface prioritizes availability. The high-risk auth endpoint
// (login) goes through LoginGuard instead, which fails closed — there,
// security beats availability.
//
// rdb is required; nil panics immediately (a composition root bug).
func PublicRateGuard(rdb *redis.Client) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("PublicRateGuard: redis client is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			servePublicRate(w, r, rdb, next)
		})
	}
}

func servePublicRate(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, next http.Handler,
) {
	maxN, ok := publicRatePolicy[r.Method+" "+r.URL.Path]
	if !ok {
		next.ServeHTTP(w, r)
		return
	}
	key := publicRateKeyPfx + r.URL.Path + ":" + clientIP(r)
	allowed, err := incrWithinLimit(r.Context(), rdb, key, maxN, publicRateWindow)
	if err != nil {
		slog.Default().Warn("public rate-limit check failed, allowing",
			"err", err, "path", r.URL.Path)
		next.ServeHTTP(w, r)
		return
	}
	if !allowed {
		slog.Default().Warn("public rate-limited", "path", r.URL.Path, "ip", clientIP(r))
		writeRateError(
			w, http.StatusTooManyRequests, "rate_limited",
			"too many requests, slow down and try again",
		)
		return
	}
	next.ServeHTTP(w, r)
}

// incrWithinLimit is fixed-window: TTL is set only on the first INCR
// (n==1), so a refresh doesn't keep extending the window. Returns
// true=allowed, false=over the limit.
func incrWithinLimit(
	ctx context.Context, rdb *redis.Client, key string, maxN int64, window time.Duration,
) (bool, error) {
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("redis incr: %w", err)
	}
	if n == 1 {
		if eerr := rdb.Expire(ctx, key, window).Err(); eerr != nil {
			return false, fmt.Errorf("redis expire: %w", eerr)
		}
	}
	return n <= maxN, nil
}
