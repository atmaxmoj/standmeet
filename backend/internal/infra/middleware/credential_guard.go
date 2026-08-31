// credential_guard.go —— 改凭据那两条路的爆破防护。
//
// **为什么 LoginGuard 不够**：前门 `/login` 和 `/recover` 早就有 LoginGuard 了，而
// `/account/email` 和 `/account/password` 一条都没有。会有人说这两条在 session 后面、
// 攻击者得先有 session —— **那正是问题所在**：当前密码闸门存在的全部理由就是
// "偷到 session 也不等于接管账号"。而现在偷到 session 的人可以对着 `/account/password`
// 无限次、全速试密码，一次限速都不吃。前门装了锁，里面那道保险柜的密码盘可以随便转。
//
// 跟 LoginGuard 的三处不同，每一处都是刻意的：
//
//  1. **键是 owner，不是 IP。** 这里的请求都带着 session，session 就说明了是谁。
//     按 IP 计的话，拿着同一个偷来的 cookie 换台机器就重新计数
//     （[[read-the-key-not-the-name]]：说"按 X 分"的机制，要去看它真正拿什么当键）。
//  2. **只数失败。** 数全部请求的话，owner 正常改几次邮箱就把自己关在外面 ——
//     那是把系统的限制转嫁成用户的纪律。所以 next 的响应先 buffer，4xx 才计数。
//  3. **没有 captcha。** captcha 防的是"自动化的东西替 owner 操作 owner 自己的实例"，
//     而这里 owner 本人就在自己的后台里。
//
// 阈值比前门紧得多：改凭据是低频动作，5 次/15 分钟对真人绰绰有余，对爆破没有意义。

package middleware

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// redis key 前缀,不是凭据本身 —— gosec 只看到 "credential" 这个词。
	credRateLimitKeyPfx = "ratelimit:credential:" //nolint:gosec // redis key prefix
	credRateLimitWindow = 15 * time.Minute
	// 5/15min/owner：真人改凭据一次就成，失败 5 次已经说明不是本人在改。
	credRateLimitMax = 5
	// 没有 owner id 时的兜底桶。到不了这里（middleware 排在 WithOwner 之后），
	// 真到了也得有个桶，不能变成"没 id 就不限速"。
	credUnknownOwner = "<unknown-owner>"
)

// CredentialGuard —— 包在 /account/email 和 /account/password 上。
// 两条路通向同一件事（改凭据），所以**两条都要包** ——
// 只包一条等于没包（[[gate-after-early-return-is-walkable]]：换个入口就绕开）。
func CredentialGuard(rdb *redis.Client) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("CredentialGuard: redis client is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveCredentialGuard(w, r, rdb, next)
		})
	}
}

func serveCredentialGuard(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, next http.Handler,
) {
	owner := credOwnerBucket(r.Context())
	blocked, err := credOverLimit(r.Context(), rdb, owner)
	if err != nil {
		// redis 抖动时 fail-closed —— 不让爆破者在故障窗口白嫖（跟 LoginGuard 同姿势）。
		slog.Default().Error("credential rate-limit check", "err", err, "owner", owner)
		writeRateError(
			w, http.StatusServiceUnavailable, "rate_limit_unavailable",
			"credential change temporarily unavailable, try again",
		)
		return
	}
	if blocked {
		writeRateError(
			w, http.StatusTooManyRequests, "rate_limited",
			"too many failed attempts — wait a few minutes before trying again",
		)
		return
	}
	credServeAndCountFailures(w, r, rdb, owner, next)
}

// credServeAndCountFailures —— 先 buffer，看清是不是 4xx 再决定计不计数。
func credServeAndCountFailures(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, owner string, next http.Handler,
) {
	buf := &bufferedWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: http.StatusOK}
	next.ServeHTTP(buf, r)
	if buf.status >= http.StatusBadRequest {
		if err := credCountFailure(r.Context(), rdb, owner); err != nil {
			slog.Default().Error("credential failure count", "err", err, "owner", owner)
		}
	}
	buf.flushTo(w)
}

func credOwnerBucket(ctx context.Context) string {
	if id := OwnerIDFrom(ctx); id != "" {
		return id
	}
	return credUnknownOwner
}

// credOverLimit 只**读**，不计数 —— 成功的请求不该消耗额度。
func credOverLimit(ctx context.Context, rdb *redis.Client, owner string) (bool, error) {
	n, err := rdb.Get(ctx, credRateLimitKeyPfx+owner).Int64()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return false, nil
		}
		return false, fmt.Errorf("redis get: %w", err)
	}
	return n >= credRateLimitMax, nil
}

// credCountFailure fixed-window：第一次 INCR 才 EXPIRE，避免每次刷新续命。
func credCountFailure(ctx context.Context, rdb *redis.Client, owner string) error {
	key := credRateLimitKeyPfx + owner
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis incr: %w", err)
	}
	if n == 1 {
		if eerr := rdb.Expire(ctx, key, credRateLimitWindow).Err(); eerr != nil {
			return fmt.Errorf("redis expire: %w", eerr)
		}
	}
	return nil
}
