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

// publicRatePolicy —— 公开端点的 per-IP 每分钟上限。key = "METHOD PATH"，精确
// 匹配 r.Method+" "+r.URL.Path；未命中 → 不限流（GET 读放行）。
//
// 阈值留得比正常访客宽、比脚本滥用窄。e2e 在每个 spec reset 时 flushRedis，
// 单 spec 内的累计远低于这些上限，所以不会误伤测试。
//
// 这是一张刻意集中、可 grep 的公开滥用策略表；改公开路由路径时记得同步这里。
var publicRatePolicy = map[string]int64{
	"POST /api/v1/sessions":               120,
	"POST /api/v1/codes/intro":            120,
	"POST /api/v1/access-requests":        30,
	"POST /api/v1/agent/turn":             120,
	"POST /api/v1/account/reset-password": 20,
}

// PublicRateGuard —— 路由感知的 per-IP fixed-window 限流 middleware。挂在
// /api/v1 公开组上；按 publicRatePolicy 决定某请求是否计数 + 限流，超限返 429。
//
// redis 故障 fail-open（记 warn 放行）：公开访客面可用性优先。高危 auth 端点
// (login) 走 LoginGuard，那条 fail-closed —— 安全 > 可用。
//
// rdb 必填；nil 直接 panic（composition root bug）。
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

// incrWithinLimit —— fixed-window：INCR 后只在第一次（n==1）设 TTL，避免每次
// 刷新续命。返回 true=放行，false=已超限。
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
