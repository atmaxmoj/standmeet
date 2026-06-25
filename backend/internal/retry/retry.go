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
	"fmt"
	"time"
)

// Policy —— 一次重试的配置。零值不可用（MaxAttempts 必须 ≥ 1）。
type Policy struct {
	Retryable   func(error) bool
	sleep       func(context.Context, time.Duration) error
	now         func() time.Time
	MaxAttempts int
	BaseDelay   time.Duration
	MaxInterval time.Duration
	MaxTotal    time.Duration
}

// Do —— 按 policy 重试 fn，直到成功、错误不可重、次数用尽、或总时长到点。返回最后
// 一次的 error（成功则 nil）。ctx 取消 → 立即返回 ctx.Err()。
func Do(ctx context.Context, p Policy, fn func() error) error {
	bo := newBackoff(p)
	var last error
	for attempt := 1; attempt <= p.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("retry: %w", err)
		}
		last = fn()
		if done, err := bo.advance(ctx, p, last, attempt); done {
			return firstErr(err, last) // ctx 打断 → err；否则收尾 → last（成功为 nil）
		}
	}
	return last
}

// firstErr —— a 非 nil 取 a，否则 b（退避被 ctx 打断 → a；正常收尾 → b=最后一次结果）。
func firstErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

// nonRetryable —— Retryable 判 false 的 error → 立即返回，不重（invalid_grant、4xx 等）。
func nonRetryable(p Policy, err error) bool {
	return p.Retryable != nil && !p.Retryable(err)
}

// backoff —— 退避状态机：每次等当前退避（封顶 MaxInterval + 不越 MaxTotal），再翻倍。把
// Do 的分支挪进来，压住 Do 的认知复杂度。只持自己要的字段（不抓整个 Policy，免重复存）。
type backoff struct {
	sleep       func(context.Context, time.Duration) error
	now         func() time.Time
	start       time.Time
	delay       time.Duration
	maxInterval time.Duration
	maxTotal    time.Duration
}

func newBackoff(p Policy) *backoff {
	sleep := p.sleep
	if sleep == nil {
		sleep = sleepCtx
	}
	now := p.now
	if now == nil {
		now = time.Now
	}
	return &backoff{
		sleep: sleep, now: now, start: now(),
		delay: p.BaseDelay, maxInterval: p.MaxInterval, maxTotal: p.MaxTotal,
	}
}

// advance —— 一次尝试后的决策：成功 / 不可重 / 到次数上限 → (true, nil) 停（caller 返
// last）；否则退避等下一次 —— 总时长到点 → (true, nil) 停；被 ctx 打断 → (true, err)。
func (b *backoff) advance(ctx context.Context, p Policy, last error, attempt int) (bool, error) {
	if last == nil || nonRetryable(p, last) || attempt == p.MaxAttempts {
		return true, nil
	}
	stop, err := b.pause(ctx)
	return stop || err != nil, err
}

// pause —— 等下一次重试前的退避。返 (stop, err)：总时长到点 → (true, nil) 停；sleep 被
// ctx 打断 → (false, err) 让 Do 直接返回。
func (b *backoff) pause(ctx context.Context) (bool, error) {
	wait := b.capped()
	if wait < 0 {
		return true, nil
	}
	if err := b.sleep(ctx, wait); err != nil {
		return false, err
	}
	b.delay = nextDelay(b.delay, b.maxInterval)
	return false, nil
}

// capped —— 当前退避压在 MaxInterval 内、不越 MaxTotal 截止；已到点返 -1。
func (b *backoff) capped() time.Duration {
	wait := b.delay
	if b.maxInterval > 0 && wait > b.maxInterval {
		wait = b.maxInterval
	}
	return b.withinTotal(wait)
}

// withinTotal —— 把 wait 压在 MaxTotal 剩余内；已到点返 -1；无 MaxTotal 原样返。
func (b *backoff) withinTotal(wait time.Duration) time.Duration {
	if b.maxTotal <= 0 {
		return wait
	}
	remaining := b.maxTotal - b.now().Sub(b.start)
	if remaining <= 0 {
		return -1
	}
	if wait > remaining {
		return remaining
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
		return fmt.Errorf("retry sleep: %w", ctx.Err())
	case <-t.C:
		return nil
	}
}
