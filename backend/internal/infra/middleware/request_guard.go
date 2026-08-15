// request_guard.go —— 留言口（`POST /access-requests`）的 per-IP 闸（F-G-4）。
//
// 那个口子是**不鉴权的写入**，而它写进的队列是 owner **一条条亲手读**的（gate 上的原话：
// "Read by hand, not a queue."）。在此之前它唯一的保护是 30/min/IP 的通用限流，而那层
// **fail-open**：redis 一抖就整个放行。prod 上实测同一个 IP 连发 34 条，前 30 条全部落库。
//
// 跟码兑换那道闸的区别只有一处：那边数的是**失败**（猜码），这边数的是**提交**——
// 留言没有对错，多才是信号。机制共用 ipTally，不再抄一份（抄出来的第二份会各自漂）。
//
// 阈值定在「一个真人一刻钟内不会发这么多」的量级：真要说的话，一封就够了。
// captcha 开着 → 超阈值可用一张有效票放行（人还能说话，脚本要付代价）；
// captcha 关着 → 纯硬锁，跟码兑换同样的取舍。

package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// requestMax —— 同一 IP 在窗口内允许的留言条数。
	requestMax = 5
	// requestWindow —— 计数窗口（也就是锁定持续时长）。
	requestWindow = 15 * time.Minute
)

// RequestGuard —— 留言口的 per-IP 闸。rdb nil → no-op。
type RequestGuard struct{ t ipTally }

// NewRequestGuard —— composition root 装配；captchaOn 表示是否真启用了 captcha（非 noop）。
func NewRequestGuard(rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool) *RequestGuard {
	return &RequestGuard{t: ipTally{
		rdb: rdb, verifier: verifier, captchaOn: captchaOn,
		keyPrefix: "requestflood:ip:", max: requestMax, window: requestWindow,
	}}
}

// Locked —— 这个 IP 现在该不该被拦。
func (g *RequestGuard) Locked(ctx context.Context, ip, captchaToken string) bool {
	if g == nil {
		return false
	}
	return g.t.blocked(ctx, ip, captchaToken)
}

// HasLift —— 这台实例现在给不给得出那条出路（captcha 开着才有）。拒绝那句话按它选词。
func (g *RequestGuard) HasLift() bool {
	return g != nil && g.t.hasLift()
}

// RecordSubmit —— 记一次提交。**成功也计**：这里数的是量，不是错误。
func (g *RequestGuard) RecordSubmit(ctx context.Context, ip string) {
	if g != nil {
		g.t.record(ctx, ip)
	}
}
