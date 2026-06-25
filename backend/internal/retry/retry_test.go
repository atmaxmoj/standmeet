// retry_test.go —— 通用重试 infra 单测（connector-deps-tests.md §五 retry-infra）。
// 退避时长用注入的假 sleep 记录，不真睡；时钟也注入（经 retry.WithClock），确定性。

package retry_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/retry"
	"github.com/stretchr/testify/require"
)

const (
	testMaxInterval  = 4 * time.Second
	testSlowDelay    = 6 * time.Second
	testMaxTotal     = 10 * time.Second
	capProbeAttempts = 5
)

// recorder —— 注入的假 sleep + 假时钟：记录每次退避，并把虚拟时间往前推。
type recorder struct {
	clock time.Time
	waits []time.Duration
}

func (r *recorder) sleep(_ context.Context, d time.Duration) error {
	r.waits = append(r.waits, d)
	r.clock = r.clock.Add(d)
	return nil
}
func (r *recorder) now() time.Time { return r.clock }

func basePolicy(rec *recorder) retry.Policy {
	return retry.WithClock(retry.Policy{
		MaxAttempts: 3,
		BaseDelay:   time.Second,
		MaxInterval: testMaxInterval,
		MaxTotal:    testMaxTotal,
	}, rec.sleep, rec.now)
}

// retry-read-transient-recovers —— 瞬时错 → 重试 → 第 N 次成功，返回 nil。
func TestDo_TransientThenSuccess(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	calls := 0
	err := retry.Do(context.Background(), basePolicy(rec), func() error {
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
	t.Parallel()
	rec := &recorder{}
	calls := 0
	sentinel := errors.New("still down")
	err := retry.Do(context.Background(), basePolicy(rec), func() error {
		calls++
		return sentinel
	})
	require.ErrorIs(t, err, sentinel)
	require.Equal(t, 3, calls, "exactly MaxAttempts tries")
	require.Len(t, rec.waits, 2, "waits only between tries (N-1)")
}

// 退避 max-interval 上限 —— 翻倍不会涨过 MaxInterval。
func TestDo_BackoffCappedAtMaxInterval(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = capProbeAttempts // 1s,2s,4s,4s（本应 8s→封顶 4s）
	p.MaxTotal = 0                   // 本例只验退避封顶，关总时长闸
	calls := 0
	err := retry.Do(context.Background(), p, func() error { calls++; return errors.New("x") })
	require.Error(t, err)
	require.Equal(t,
		[]time.Duration{time.Second, 2 * time.Second, testMaxInterval, testMaxInterval},
		rec.waits, "backoff capped at MaxInterval=4s, no further growth")
}

// retry-sync-hard-cap —— 总时长到点立即停，即使次数没用完（D-7 硬封顶）。
func TestDo_TotalDeadlineStops(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = 100 // 次数很大
	p.BaseDelay = testSlowDelay
	p.MaxInterval = testSlowDelay
	p.MaxTotal = testMaxTotal // 第一次等 6s，第二次只剩 4s → 等 4s 后到点停
	calls := 0
	err := retry.Do(context.Background(), p, func() error { calls++; return errors.New("x") })
	require.Error(t, err)
	require.LessOrEqual(t, calls, 3, "total-time cap hit, nowhere near 100 attempts")
	var total time.Duration
	for _, w := range rec.waits {
		total += w
	}
	require.LessOrEqual(t, total, testMaxTotal, "summed backoff stays within MaxTotal")
}

// retry-invalid-grant-no-retry —— Retryable 判 false 的 error 立即返回，不重。
func TestDo_NonRetryableStopsImmediately(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	p := basePolicy(rec)
	invalidGrant := errors.New("invalid_grant")
	p.Retryable = func(err error) bool { return !errors.Is(err, invalidGrant) }
	calls := 0
	err := retry.Do(context.Background(), p, func() error { calls++; return invalidGrant })
	require.ErrorIs(t, err, invalidGrant)
	require.Equal(t, 1, calls, "non-retryable -> tried once")
	require.Empty(t, rec.waits, "no backoff")
}

// ctx 取消打断 —— 取消后立即返回 ctx.Err()，不再试。
func TestDo_ContextCancelled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	err := retry.Do(ctx, basePolicy(&recorder{}), func() error { calls++; return errors.New("x") })
	require.ErrorIs(t, err, context.Canceled)
	require.Zero(t, calls, "cancelled -> not tried at all")
}
