// code_guard.go —— #169 pentest fix：访问码兑换的 per-IP 失败锁定。
//
// 访问码是可猜的 LABEL-XXX,而兑换路径本无失败锁定 —— 可被全速暴力枚举拿到别人的
// RoleSnapshot。本 guard 镜像 login_guard 的防护量级:只计**无效**码(有效兑换 Reset 清零,
// 不 self-DoS 合法访客),同一 IP 窗口内失败超阈值 → 硬锁(429)。redis 故障 fail-closed
// (不给 brute-forcer 在 redis 抖动时白嫖)。captcha 开启时超阈值可用有效 captcha token 放行;
// captcha 关闭(noop,默认部署)→ 纯硬锁,因为没 captcha 可解。
//
// 注:per-IP 依赖 chi.RealIP 解出的来源 IP;X-Forwarded-For 可伪造是独立 infra 问题
// (login guard 亦然,靠可信反代 strip/set XFF)—— 不在本刀范围。
//
// 住在 middleware(跟 login_guard 同层、同样依赖 captcha+redis):public 路由只见一个窄接口
// (publicroutes.CodeGuard),captcha 依赖藏在这层边界之后,不外泄进 routes/public。

package middleware

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// codeFailMax —— 同一 IP 在窗口内允许的无效码次数;超过即锁。足够正常访客手滑,不足枚举。
	codeFailMax = 10
	// codeFailWindow —— 失败计数窗口(锁定持续时长）。
	codeFailWindow = 15 * time.Minute
)

// CodeGuard —— 访问码兑换失败锁定。rdb nil → 退化为 no-op(可选/可测)。
type CodeGuard struct {
	rdb       *redis.Client
	verifier  CaptchaVerifier
	captchaOn bool
}

// NewCodeGuard —— composition root 装配;captchaOn 表示是否真启用了 captcha(非 noop)。
func NewCodeGuard(rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool) *CodeGuard {
	return &CodeGuard{rdb: rdb, verifier: verifier, captchaOn: captchaOn}
}

func codeFailKey(ip string) string { return "codefail:ip:" + ip }

// Locked —— 该 IP 是否应被拒:已接 redis 且 失败超阈值 且 captcha 未放行。
func (g *CodeGuard) Locked(ctx context.Context, ip, captchaToken string) bool {
	return g.enabled() && g.overThreshold(ctx, ip) && g.captchaFails(ctx, captchaToken, ip)
}

// RecordFail —— 一次无效码:INCR;首次落键(Val==1)时设窗口过期。best-effort。
func (g *CodeGuard) RecordFail(ctx context.Context, ip string) {
	if !g.enabled() {
		return
	}
	k := codeFailKey(ip)
	if g.rdb.Incr(ctx, k).Val() == 1 {
		g.rdb.Expire(ctx, k, codeFailWindow) // best-effort TTL
	}
}

// Reset —— 有效兑换:清计数,合法访客不被历史失败连累。best-effort。
func (g *CodeGuard) Reset(ctx context.Context, ip string) {
	if g.enabled() {
		g.rdb.Del(ctx, codeFailKey(ip)) // best-effort
	}
}

// enabled —— guard 是否真接了 redis(nil / 无 redis → no-op,保持可选/可测)。
func (g *CodeGuard) enabled() bool { return g != nil && g.rdb != nil }

// overThreshold —— 窗口内失败是否已达上限。redis 错 → fail-closed(true,抖动时不放行)。
func (g *CodeGuard) overThreshold(ctx context.Context, ip string) bool {
	n, err := g.rdb.Get(ctx, codeFailKey(ip)).Int()
	if errors.Is(err, redis.Nil) {
		return false
	}
	if err != nil {
		return true
	}
	return n >= codeFailMax
}

// captchaFails —— captcha 关(默认)→ 恒 true(硬锁);开 → 未提供有效 token 才 true。
func (g *CodeGuard) captchaFails(ctx context.Context, captchaToken, ip string) bool {
	return !g.captchaOn || g.verifier.Verify(ctx, captchaToken, ip) != nil
}
