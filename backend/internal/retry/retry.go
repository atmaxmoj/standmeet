// Package retry —— 通用可配重试（#132）。connector 代调（第三方易抖）按 call-class
// 配策略架在它之上：底座只管「按退避重试、硬封顶、可打断」，connector 只配不改。
//
// 硬封顶（决策点 D-7）：① 次数封顶 MaxAttempts ② 退避有 MaxInterval 上限（不指数
// 无限涨）③ 总时长封顶 MaxTotal（到点立即停 + 返回，即使次数没用完）。绝不无上限。
//
// 幂等由 caller 负责：写操作（events.insert / smtp send）只该用「仅发送前连接失败可
// 重」的 Retryable，或带幂等键 —— 底座不替它判。
package retry

import (
	"context"
	"time"
)

// Policy —— 一次重试的配置。零值不可用（MaxAttempts 必须 ≥ 1）。
type Policy struct {
	// MaxAttempts —— 总尝试次数上限（含首次）。
	MaxAttempts int
	// BaseDelay —— 首次退避；之后每次翻倍，封顶 MaxInterval。
	BaseDelay time.Duration
	// MaxInterval —— 单次退避上限（退避不会涨过它）。0 = 不额外封顶（仍受 MaxTotal）。
	MaxInterval time.Duration
	// MaxTotal —— 整个重试序列的总时长上限（含退避等待）。0 = 不封顶（不推荐）。
	MaxTotal time.Duration
	// Retryable —— 判一个 error 该不该重；nil = 所有非 nil error 都重。返 false →
	// 立即返回该 error，不再重（如 invalid_grant、4xx、非法参数）。
	Retryable func(error) bool
	// sleep —— 可注入的等待（测试用，记录退避时长且不真睡）。nil = 真 time.Sleep。
	sleep func(context.Context, time.Duration) error
	// now —— 可注入的时钟（测试用）。nil = time.Now。
	now func() time.Time
}

// Do —— 按 policy 重试 fn，直到成功、错误不可重、次数用尽、或总时长到点。返回最后
// 一次的 error（成功则 nil）。ctx 取消 → 立即返回 ctx.Err()。
func Do(ctx context.Context, p Policy, fn func() error) error {
	sleep := p.sleep
	if sleep == nil {
		sleep = sleepCtx
	}
	now := p.now
	if now == nil {
		now = time.Now
	}
	start := now()
	delay := p.BaseDelay
	var last error
	for attempt := 1; attempt <= p.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		last = fn()
		if last == nil {
			return nil
		}
		if p.Retryable != nil && !p.Retryable(last) {
			return last
		}
		if attempt == p.MaxAttempts {
			break
		}
		wait := capWait(delay, p, now, start)
		if wait < 0 {
			break // 总时长到点：不再等、不再试
		}
		if err := sleep(ctx, wait); err != nil {
			return err
		}
		delay = nextDelay(delay, p.MaxInterval)
	}
	return last
}

// capWait —— 把本次退避压在 MaxInterval 以内，并保证不越过 MaxTotal 截止；越过返 -1。
func capWait(delay time.Duration, p Policy, now func() time.Time, start time.Time) time.Duration {
	wait := delay
	if p.MaxInterval > 0 && wait > p.MaxInterval {
		wait = p.MaxInterval
	}
	if p.MaxTotal > 0 {
		remaining := p.MaxTotal - now().Sub(start)
		if remaining <= 0 {
			return -1
		}
		if wait > remaining {
			wait = remaining
		}
	}
	return wait
}

func nextDelay(delay, maxInterval time.Duration) time.Duration {
	next := delay * 2
	if maxInterval > 0 && next > maxInterval {
		next = maxInterval
	}
	return next
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
