package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/wangsijie/standmeet/internal/captcha"
)

const (
	loginRateLimitKeyPfx = "ratelimit:login:"
	loginRateLimitWindow = 5 * time.Minute
	// 30/5min/IP：足够 owner 重试 / e2e 跑光，不足 brute-force。
	loginRateLimitMax = 30
	// 统一最小响应时间。所有 login 响应（200/401/429）都拉齐到这个 floor。
	loginMinResponseTime = 200 * time.Millisecond
)

// LoginGuard 是 chi middleware 工厂；包到 /api/admin/login 一个 handler 上。
//
// 防护：
//  1. per-IP Redis rate-limit（fixed window，INCR+EXPIRE）。超限返 429。
//     redis 故障 fail-closed（503）—— 不让 brute-forcer 在 redis 抖动时白嫖。
//  2. captcha verify（opt-in）—— 若装配 verifier 非 noop，验
//     `X-Captcha-Token` header；失败统一返 401，跟密码错对齐，不告知攻击者
//     哪一关挂了。
//  3. equal-time response：next handler 的写入先 buffer，sleep 到 ≥ 200ms
//     才 flush。timing 不再泄漏 email-exists vs wrong-password 的差别。
//
// 不接管 /api/admin/claim —— setup token 单次使用且 hash 校验；brute force
// 一个 ~22 字符 random token 不实际。
//
// rdb / verifier 必填；nil 直接 panic（composition root bug）。captcha 关闭
// 时传 captcha.NewFromConfig(Config{Provider: ProviderNone}, nil) 即可。
func LoginGuard(rdb *redis.Client, verifier captcha.Verifier) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("LoginGuard: redis client is nil")
	}
	if verifier == nil {
		panic("LoginGuard: captcha verifier is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveLoginGuard(w, r, &loginGuardCtx{rdb: rdb, verifier: verifier, next: next})
		})
	}
}

// loginGuardCtx —— LoginGuard 闭包里要传递的 4 个 ref；打包让 serveLoginGuard
// 不超 4 参（revive argument-limit）。
type loginGuardCtx struct {
	rdb      *redis.Client
	verifier captcha.Verifier
	next     http.Handler
}

func serveLoginGuard(w http.ResponseWriter, r *http.Request, c *loginGuardCtx) {
	ip := clientIP(r)
	if !checkRateOrWrite(w, r, c.rdb, ip) {
		return
	}
	if !checkCaptchaOrWrite(w, r, c.verifier, ip) {
		return
	}
	equalTimeServe(w, r, c.next)
}

// checkRateOrWrite —— 命中 rate-limit / redis 故障 → 写响应并返 false；放行
// 返 true。
func checkRateOrWrite(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, ip string,
) bool {
	outcome, err := checkLoginRate(r.Context(), rdb, ip)
	if err != nil {
		handleRateError(w, ip, err)
		return false
	}
	if !outcome {
		slog.Default().Warn("login rate-limited", "ip", ip)
		writeRateError(
			w, http.StatusTooManyRequests, "rate_limited",
			"too many login attempts, try again later",
		)
		return false
	}
	return true
}

// checkCaptchaOrWrite —— captcha 验证未过 → 写 401 并返 false；通过返 true。
// noop verifier 永远返 true（feature off）。
func checkCaptchaOrWrite(
	w http.ResponseWriter, r *http.Request, v captcha.Verifier, ip string,
) bool {
	token := r.Header.Get(captchaTokenHeader)
	if err := v.Verify(r.Context(), token, ip); err != nil {
		slog.Default().Warn("captcha verify failed", "err", err, "ip", ip)
		writeRateError(
			w, http.StatusUnauthorized, "unauthorized",
			"invalid credentials",
		)
		return false
	}
	return true
}

// captchaTokenHeader —— 前端 LoginForm 走 X-Captcha-Token 把 widget token 送来。
// 不挪进 body，让 LoginGuard 不用解 JSON；header 跟 CSRF 同套路。
// gosec G101 看到 "Token" 误判 hardcoded credential —— 这只是 header 名。
const captchaTokenHeader = "X-Captcha-Token" //nolint:gosec // header name, not a credential

// clientIP —— chi.RealIP 已经把 X-Forwarded-For 解到 RemoteAddr 上了，这里
// 只需去 port。SplitHostPort 失败说明 RemoteAddr 本身就是裸 IP（dev/test），
// 直接用即可。
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// checkLoginRate fixed-window：INCR 后第一次 INCR=1 才 EXPIRE，避免每次刷新
// 续命。返回 true=放行，false=已超限。
func checkLoginRate(ctx context.Context, rdb *redis.Client, ip string) (bool, error) {
	key := loginRateLimitKeyPfx + ip
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("redis incr: %w", err)
	}
	if n == 1 {
		if eerr := rdb.Expire(ctx, key, loginRateLimitWindow).Err(); eerr != nil {
			return false, fmt.Errorf("redis expire: %w", eerr)
		}
	}
	return n <= loginRateLimitMax, nil
}

func handleRateError(w http.ResponseWriter, ip string, err error) {
	slog.Default().Error("login rate-limit check", "err", err, "ip", ip)
	writeRateError(
		w, http.StatusServiceUnavailable, "rate_limit_unavailable",
		"login service temporarily unavailable, try again",
	)
}

// equalTimeServe wrap ResponseWriter，截 next handler 的 write，sleep 到
// loginMinResponseTime 后才往真 writer flush。next 的 SetCookie 走的是
// b.Header()，直接转发到真 writer 的 header map —— flush 时 WriteHeader
// 把 header 一起发出去。
func equalTimeServe(w http.ResponseWriter, r *http.Request, next http.Handler) {
	start := time.Now()
	buf := &bufferedWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: http.StatusOK}
	next.ServeHTTP(buf, r)
	if remaining := loginMinResponseTime - time.Since(start); remaining > 0 {
		select {
		case <-time.After(remaining):
		case <-r.Context().Done():
		}
	}
	buf.flushTo(w)
}

// bufferedWriter ——
//
//	WriteHeader 截 status；
//	Write 截 body；
//	Header 直接 delegate（这样 SetCookie/Set Content-Type 一切照常走真 writer
//	的 header map —— 等 flushTo 真正调 WriteHeader 时 headers 一起发）。
type bufferedWriter struct {
	http.ResponseWriter

	body        *bytes.Buffer
	status      int
	wroteHeader bool
}

func (b *bufferedWriter) WriteHeader(status int) {
	if b.wroteHeader {
		return
	}
	b.status = status
	b.wroteHeader = true
}

func (b *bufferedWriter) Write(p []byte) (int, error) {
	if !b.wroteHeader {
		b.WriteHeader(http.StatusOK)
	}
	return b.body.Write(p)
}

func (b *bufferedWriter) flushTo(w http.ResponseWriter) {
	w.WriteHeader(b.status)
	if _, err := w.Write(b.body.Bytes()); err != nil {
		slog.Default().Warn("login_guard flush write", "err", err)
	}
}

func writeRateError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	payload := map[string]map[string]string{
		"error": {"code": code, "message": msg},
	}
	err := json.NewEncoder(w).Encode(payload)
	if err != nil && !errors.Is(err, http.ErrHandlerTimeout) {
		slog.Default().Warn("encode rate-limit error", "err", err)
	}
}
