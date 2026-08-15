// ip_tally.go —— 「同一个来源做同一件事太多次 → 拦下，一次人机校验放行」的那台机器。
//
// 它是从 code_guard 里抽出来的：那套逻辑（按 IP 计数 / 到阈值就拦 / captcha 开着时一张有效
// 票放行 / redis 抖动 fail-closed / 判不出地址就退到一个具名共用桶）跟「被数的是什么」无关。
// 访问码兑换数的是**失败**，留言口数的是**提交**——差别只有名字、阈值和窗口。
//
// 抽出来的理由不是整洁：留言口原本一道闸都没有（F-G-4），而当时最省事的写法是把 code_guard
// 抄一遍。抄出来的第二份会各自漂——一边修了 fail-closed，另一边没有；一边接了 captcha
// 解锁，另一边留着永久硬锁。这个仓库已经吃过好几次同样的亏。

package middleware

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// ipTally —— 一个具名的 per-IP 计数闸。
type ipTally struct {
	rdb       *redis.Client
	verifier  CaptchaVerifier
	keyPrefix string
	max       int
	window    time.Duration
	captchaOn bool
}

// enabled —— 真接了 redis 才作数。nil → no-op（可选/可测）。
func (t *ipTally) enabled() bool { return t != nil && t.rdb != nil }

// key —— 分桶键。空 ip = clientaddr 判不出访客地址（没有反代设转发头的出厂形态），
// 此时**所有人共用一个桶**：关掉闸门等于把这个口子交给脚本，所以宁可 fail-closed。
// 但那个桶要有名字 —— 它曾经悄悄挂在 app 容器的地址上，看着像在按 IP 分（F-F-5）。
func (t *ipTally) key(ip string) string {
	if ip == "" {
		ip = unknownIPBucket
	}
	return t.keyPrefix + ip
}

// record —— 记一次。best-effort：首次落键时设窗口过期。
func (t *ipTally) record(ctx context.Context, ip string) {
	if !t.enabled() {
		return
	}
	k := t.key(ip)
	if t.rdb.Incr(ctx, k).Val() == 1 {
		t.rdb.Expire(ctx, k, t.window)
	}
}

// reset —— 清零。best-effort。
func (t *ipTally) reset(ctx context.Context, ip string) {
	if t.enabled() {
		t.rdb.Del(ctx, t.key(ip))
	}
}

// blocked —— 该 IP 现在该不该被拦：接了 redis 且 已过阈值 且 captcha 没放行。
func (t *ipTally) blocked(ctx context.Context, ip, captchaToken string) bool {
	return t.enabled() && t.overThreshold(ctx, ip) && t.captchaFails(ctx, captchaToken, ip)
}

// overThreshold —— 窗口内是否已达上限。redis 错 → fail-closed（抖动时不放行）。
func (t *ipTally) overThreshold(ctx context.Context, ip string) bool {
	n, err := t.rdb.Get(ctx, t.key(ip)).Int()
	if errors.Is(err, redis.Nil) {
		return false
	}
	if err != nil {
		return true
	}
	return n >= t.max
}

// captchaFails —— captcha 关（默认部署）→ 恒 true（纯硬锁，因为没有校验可解）；
// 开 → 只有拿得出一张有效票才放行。
func (t *ipTally) captchaFails(ctx context.Context, captchaToken, ip string) bool {
	return !t.captchaOn || t.verifier.Verify(ctx, captchaToken, ip) != nil
}
