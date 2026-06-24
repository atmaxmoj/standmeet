// retry_test.go —— 通用重试 infra 单测（connector-deps-tests.md §五 retry-infra）。
// 退避时长用注入的假 sleep 记录，不真睡；时钟也注入，确定性。
package retry

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// recorder —— 注入的假 sleep + 假时钟：记录每次退避，并把虚拟时间往前推。
type recorder struct {
	waits []time.Duration
	clock time.Time
}

func (r *recorder) sleep(_ context.Context, d time.Duration) error {
	r.waits = append(r.waits, d)
	r.clock = r.clock.Add(d)
	return nil
}
func (r *recorder) now() time.Time { return r.clock }

func basePolicy(rec *recorder) Policy {
	return Policy{
		MaxAttempts: 3,
		BaseDelay:   time.Second,
		MaxInterval: 4 * time.Second,
		MaxTotal:    10 * time.Second,
		sleep:       rec.sleep,
		now:         rec.now,
	}
}

// retry-read-transient-recovers —— 瞬时错 → 重试 → 第 N 次成功，返回 nil。
func TestDo_TransientThenSuccess(t *testing.T) {
	rec := &recorder{}
	calls := 0
	err := Do(context.Background(), basePolicy(rec), func() error {
		calls++
		if calls < 3 {
			return errors.New("transient")
		}
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, 3, calls, "retried until success")
	require.Equal(t, []time.Duration{time.Second, 2 * time.Second}, rec.waits,
		"backoff 1s, 2s between the 3 attempts")
}

// retry-exhausted-degrades —— 一直失败 → 用尽 MaxAttempts → 返回最后的 error。
func TestDo_ExhaustsAttempts(t *testing.T) {
	rec := &recorder{}
	calls := 0
	sentinel := errors.New("still down")
	err := Do(context.Background(), basePolicy(rec), func() error {
		calls++
		return sentinel
	})
	require.ErrorIs(t, err, sentinel)
	require.Equal(t, 3, calls, "exactly MaxAttempts tries")
	require.Len(t, rec.waits, 2, "waits only between tries (N-1)")
}

// 退避 max-interval 上限 —— 翻倍不会涨过 MaxInterval。
func TestDo_BackoffCappedAtMaxInterval(t *testing.T) {
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = 5 // 1s,2s,4s,4s(本应 8s→封顶 4s)
	p.MaxTotal = 0    // 本例只验退避封顶，关总时长闸
	calls := 0
	_ = Do(context.Background(), p, func() error { calls++; return errors.New("x") })
	require.Equal(t,
		[]time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 4 * time.Second},
		rec.waits, "退避封顶在 MaxInterval=4s，不再涨")
}

// retry-sync-hard-cap —— 总时长到点立即停，即使次数没用完（D-7 硬封顶）。
func TestDo_TotalDeadlineStops(t *testing.T) {
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = 100 // 次数很大
	p.BaseDelay = 6 * time.Second
	p.MaxInterval = 6 * time.Second
	p.MaxTotal = 10 * time.Second // 第一次等 6s，第二次只剩 4s → 等 4s 后到点停
	calls := 0
	_ = Do(context.Background(), p, func() error { calls++; return errors.New("x") })
	require.LessOrEqual(t, calls, 3, "总时长封顶，远没跑满 100 次")
	var total time.Duration
	for _, w := range rec.waits {
		total += w
	}
	require.LessOrEqual(t, total, 10*time.Second, "退避总和不越过 MaxTotal")
}

// retry-invalid-grant-no-retry —— Retryable 判 false 的 error 立即返回，不重。
func TestDo_NonRetryableStopsImmediately(t *testing.T) {
	rec := &recorder{}
	p := basePolicy(rec)
	invalidGrant := errors.New("invalid_grant")
	p.Retryable = func(err error) bool { return !errors.Is(err, invalidGrant) }
	calls := 0
	err := Do(context.Background(), p, func() error { calls++; return invalidGrant })
	require.ErrorIs(t, err, invalidGrant)
	require.Equal(t, 1, calls, "non-retryable → 只试一次")
	require.Empty(t, rec.waits, "不退避")
}

// ctx 取消打断 —— 取消后立即返回 ctx.Err()，不再试。
func TestDo_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	err := Do(ctx, basePolicy(&recorder{}), func() error { calls++; return errors.New("x") })
	require.ErrorIs(t, err, context.Canceled)
	require.Zero(t, calls, "已取消 → 一次都不试")
}
