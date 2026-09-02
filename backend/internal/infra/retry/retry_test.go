// retry_test.go -- unit tests for the generic retry infra (connector-deps-tests.md
// §5 retry-infra). Backoff durations are recorded via an injected fake sleep, never a
// real sleep; the clock is injected too (via retry.WithClock), for determinism.

package retry_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/retry"
	"github.com/stretchr/testify/require"
)

const (
	testMaxInterval  = 4 * time.Second
	testSlowDelay    = 6 * time.Second
	testMaxTotal     = 10 * time.Second
	capProbeAttempts = 5
)

// recorder -- the injected fake sleep + fake clock: records each backoff and advances
// the virtual time.
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

// retry-read-transient-recovers -- transient error -> retries -> succeeds on the Nth
// attempt, returns nil.
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

// retry-exhausted-degrades -- always fails -> MaxAttempts exhausted -> returns the
// last error.
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

// Backoff max-interval cap -- doubling never grows past MaxInterval.
func TestDo_BackoffCappedAtMaxInterval(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = capProbeAttempts // 1s,2s,4s,4s (would be 8s -> capped at 4s)
	// this case only verifies the backoff cap, so gate off the total-duration deadline
	p.MaxTotal = 0
	calls := 0
	err := retry.Do(context.Background(), p, func() error { calls++; return errors.New("x") })
	require.Error(t, err)
	require.Equal(t,
		[]time.Duration{time.Second, 2 * time.Second, testMaxInterval, testMaxInterval},
		rec.waits, "backoff capped at MaxInterval=4s, no further growth")
}

// retry-sync-hard-cap -- stops immediately once the total duration deadline hits,
// even with attempts remaining (D-7 hard cap).
func TestDo_TotalDeadlineStops(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	p := basePolicy(rec)
	p.MaxAttempts = 100 // a large attempt count
	p.BaseDelay = testSlowDelay
	p.MaxInterval = testSlowDelay
	// first wait is 6s, second only has 4s left -> waits 4s then hits the deadline and stops
	p.MaxTotal = testMaxTotal
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

// retry-invalid-grant-no-retry -- an error Retryable judges false returns
// immediately, no retry.
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

// ctx cancellation interrupt -- once cancelled, returns ctx.Err() immediately,
// no further tries.
func TestDo_ContextCancelled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	err := retry.Do(ctx, basePolicy(&recorder{}), func() error { calls++; return errors.New("x") })
	require.ErrorIs(t, err, context.Canceled)
	require.Zero(t, calls, "cancelled -> not tried at all")
}
