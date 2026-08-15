package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
)

// CaptchaVerifier —— middleware 需要的 captcha 校验窄口。不 import security 域(叶子基建不依赖域);
// composition root 用 CaptchaVerifier(结构一致)满足它。
type CaptchaVerifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

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
// 时传 security.NewFromConfig(Config{Provider: ProviderNone}, nil) 即可。
func LoginGuard(
	rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool,
) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("LoginGuard: redis client is nil")
	}
	if verifier == nil {
		panic("LoginGuard: captcha verifier is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveLoginGuard(w, r, &loginGuardCtx{
				rdb: rdb, verifier: verifier, next: next, captchaOn: captchaOn,
			})
		})
	}
}

// loginGuardCtx —— LoginGuard 闭包里要传递的 4 个 ref；打包让 serveLoginGuard
// 不超 4 参（revive argument-limit）。
type loginGuardCtx struct {
	rdb      *redis.Client
	verifier CaptchaVerifier
	next     http.Handler
	// captchaOn —— 这台实例配没配 captcha（部署事实）。它决定超限时说哪句话，也决定
	// 那条出路存不存在。两句话见 `tooManyAttemptsWait/Captcha`。
	captchaOn bool
}

// tooManyAttemptsWait / tooManyAttemptsCaptcha —— 超限的两句话。说「稍后再试」而那道校验就在
// 屏幕上，等于让 owner 干等五分钟；说「过一次校验」而这台实例没配 captcha，指的是一个页面上
// 不存在的控件（F-G-7 的同一条规矩，第三扇门）。
const (
	tooManyAttemptsWait    = "too many login attempts, try again later"
	tooManyAttemptsCaptcha = "too many login attempts — clear the human check and try again"
)

func serveLoginGuard(w http.ResponseWriter, r *http.Request, c *loginGuardCtx) {
	ip := clientIP(r)
	if !checkRateOrWrite(w, r, c, ip) {
		return
	}
	if !checkCaptchaOrWrite(w, r, c.verifier, ip) {
		return
	}
	equalTimeServe(w, r, c.next)
}

// checkRateOrWrite —— 命中 rate-limit / redis 故障 → 写响应并返 false；放行返 true。
//
// **超限也有一条出路，只要这台实例给得出**：配了 captcha 时，一张验得过的票就放行并清零。
// gate 上那两扇门（码 / 留言）早就是这个规矩，而 owner 自己这扇门原来没有钥匙 —— 密码完全
// 正确、校验也解开了，照样被挡在自己的实例外面，直到窗口自己过去（F-G-8）。
//
// 这不是把防线拆了：captcha 开着时，**每一次**登录本来就要过那道校验，爆破者早就在为每次
// 尝试付代价，这时的次数上限挡不住他，只挡得住那个该进来的人。captcha 关着时没有票可验，
// 硬锁照旧 —— 那时它是唯一的防线。
func checkRateOrWrite(
	w http.ResponseWriter, r *http.Request, c *loginGuardCtx, ip string,
) bool {
	outcome, err := checkLoginRate(r.Context(), c.rdb, ip)
	if err != nil {
		handleRateError(w, ip, err)
		return false
	}
	if outcome {
		return true
	}
	return liftOrRefuse(w, r, c, ip)
}

// liftOrRefuse —— 超限之后：票验得过就抬闸清零；否则拒绝，并且**只承诺这里真有的下一步**。
func liftOrRefuse(
	w http.ResponseWriter, r *http.Request, c *loginGuardCtx, ip string,
) bool {
	token := r.Header.Get(captchaTokenHeader)
	// `c.captchaOn` 必须在前：captcha 关着时装的是 noop verifier，而它对**任何**票都返回
	// 成功 —— 少了这一半，默认部署上这道限流会被自己的 no-op 一路抬开，等于没有。
	// `ipTally.captchaFails` 早就是这么写的，这里差点漏掉同一条（同族：一条道理只修了一处）。
	if c.captchaOn && c.verifier.Verify(r.Context(), token, ip) == nil {
		slog.Default().Info("login rate lifted by a solved check", "ip", ip)
		c.rdb.Del(r.Context(), loginRateLimitKeyPfx+ip)
		return true
	}
	slog.Default().Warn("login rate-limited", "ip", ip)
	refusal := tooManyAttemptsWait
	if c.captchaOn {
		refusal = tooManyAttemptsCaptcha
	}
	writeRateError(w, http.StatusTooManyRequests, "rate_limited", refusal)
	return false
}

// checkCaptchaOrWrite —— captcha 验证未过 → 写 401 并返 false；通过返 true。
// noop verifier 永远返 true（feature off）。
//
// **说的是那道校验，不是凭据**（F-G-5）。这一关短路在凭据校验之前，所以密码完全正确的 owner
// 只要 widget 没加载出来（网络被挡、provider 抖、拦截插件）也会走到这里 —— 上一版回的是
// `invalid credentials`，于是他去改密码，而真因在别处。
//
// 「防枚举」不适用：密码错 vs 用户不存在要含糊，是为了不泄露账号是否存在；「人机校验没过」
// 不是账号预言机，说出来不泄露任何东西。隔壁限流那条分支早就说了真话，这条照做。
//
// 也不回 provider 的错误码数组：那是第三方的内部措辞，不是产品该说的话。
func checkCaptchaOrWrite(
	w http.ResponseWriter, r *http.Request, v CaptchaVerifier, ip string,
) bool {
	token := r.Header.Get(captchaTokenHeader)
	if err := v.Verify(r.Context(), token, ip); err != nil {
		slog.Default().Warn("captcha verify failed", "err", err, "ip", ip)
		writeRateError(
			w, http.StatusUnauthorized, "captcha_failed",
			"the human check didn’t go through — reload the page and try again",
		)
		return false
	}
	return true
}

// captchaTokenHeader —— 前端 LoginForm 走 X-Captcha-Token 把 widget token 送来。
// 不挪进 body，让 LoginGuard 不用解 JSON；header 跟 CSRF 同套路。
// gosec G101 看到 "Token" 误判 hardcoded credential —— 这只是 header 名。
const captchaTokenHeader = "X-Captcha-Token" //nolint:gosec // header name, not a credential

// clientIP —— 登录限流的分桶键。结论来自 clientaddr 中间件：要么是来访者自己的
// 地址，要么是空串（不知道）。**不知道时所有人共用一个桶**，那是 fail-closed 的
// 取舍（关掉限流等于把 owner 的登录交给爆破），但它必须是**明说**的一个桶，而不是
// 悄悄挂在 app 容器的地址上假装按 IP 分（F-F-5）。
func clientIP(r *http.Request) string {
	if addr := clientaddr.Of(r.Context()); addr != "" {
		return addr
	}
	return unknownIPBucket
}

// unknownIPBucket —— 来源地址不可见时的共用桶名。取一个说人话的名字，让运维在
// redis 里看到 `login:rate:<unknown-source>` 就知道这不是某个访客的地址。
const unknownIPBucket = "<unknown-source>"

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
