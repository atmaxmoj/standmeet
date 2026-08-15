// code_guard.go —— #169 pentest fix：访问码兑换的 per-IP 失败锁定。
//
// 访问码是可猜的 LABEL-XXX,而兑换路径本无失败锁定 —— 可被全速暴力枚举拿到别人的
// RoleSnapshot。本 guard 镜像 login_guard 的防护量级:只计**无效**码(有效兑换 Reset 清零,
// 不 self-DoS 合法访客),同一 IP 窗口内失败超阈值 → 硬锁(429)。redis 故障 fail-closed
// (不给 brute-forcer 在 redis 抖动时白嫖)。captcha 开启时超阈值可用有效 captcha token 放行;
// captcha 关闭(noop,默认部署)→ 纯硬锁,因为没 captcha 可解。
//
// 注:per-IP 靠 clientaddr 判出来的**访客**地址(不是上一跳的地址)。判不出来时退成一个
// 具名的共用桶,并在日志里说清楚 —— 那时"per-IP"名不副实,运维要知道(F-F-5)。
// X-Forwarded-For 可伪造是独立 infra 问题(login guard 亦然,靠可信反代 strip/set XFF)。
//
// 住在 middleware(跟 login_guard 同层、同样依赖 captcha+redis):public 路由只见一个窄接口
// (publicroutes.CodeGuard),captcha 依赖藏在这层边界之后,不外泄进 routes/public。

package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// codeFailMax —— 同一 IP 在窗口内允许的无效码次数;超过即锁。足够正常访客手滑,不足枚举。
	codeFailMax = 10
	// codeFailWindow —— 失败计数窗口(锁定持续时长）。
	codeFailWindow = 15 * time.Minute
)

// CodeGuard —— 访问码兑换失败锁定。计数机制在 ip_tally；这里只挑名字、阈值和窗口。
// rdb nil → 退化为 no-op(可选/可测)。
type CodeGuard struct{ t ipTally }

// NewCodeGuard —— composition root 装配;captchaOn 表示是否真启用了 captcha(非 noop)。
func NewCodeGuard(rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool) *CodeGuard {
	return &CodeGuard{t: ipTally{
		rdb: rdb, verifier: verifier, captchaOn: captchaOn,
		keyPrefix: "codefail:ip:", max: codeFailMax, window: codeFailWindow,
	}}
}

// Locked —— 该 IP 是否应被拒:已接 redis 且 失败超阈值 且 captcha 未放行。
func (g *CodeGuard) Locked(ctx context.Context, ip, captchaToken string) bool {
	if g == nil {
		return false
	}
	return g.t.blocked(ctx, ip, captchaToken)
}

// RecordFail —— 一次无效码。**只计无效**:有效兑换会 Reset,合法访客不被历史失败连累。
func (g *CodeGuard) RecordFail(ctx context.Context, ip string) {
	if g != nil {
		g.t.record(ctx, ip)
	}
}

// Reset —— 有效兑换:清计数。
func (g *CodeGuard) Reset(ctx context.Context, ip string) {
	if g != nil {
		g.t.reset(ctx, ip)
	}
}
