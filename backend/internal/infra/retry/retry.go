// Package retry -- generic configurable retry (#132). Connector call-outs (flaky third
// parties) layer their per-call-class policy on top: this base only handles "retry on
// backoff, hard-capped, interruptible" -- connectors configure it, never modify it.
//
// Hard caps (decision D-7): (1) attempt count capped at MaxAttempts (2) backoff capped
// at MaxInterval (no unbounded exponential growth) (3) total duration capped at MaxTotal
// (stops and returns immediately once hit, even with attempts remaining). Never uncapped.
//
// Idempotency is the caller's responsibility: write operations (events.insert / smtp
// send) should only use a Retryable that allows retry for "pre-send connection failure
// only", or carry an idempotency key -- this base does not judge that for them.
package retry

import (
	"context"
	"fmt"
	"time"
)

// Policy -- configuration for one retry. The zero value is not usable (MaxAttempts must
// be >= 1).
type Policy struct {
	Retryable   func(error) bool
	sleep       func(context.Context, time.Duration) error
	now         func() time.Time
	MaxAttempts int
	BaseDelay   time.Duration
	MaxInterval time.Duration
	MaxTotal    time.Duration
}

// Do -- retries fn per policy until it succeeds, the error is non-retryable, attempts
// are exhausted, or the total duration deadline hits. Returns the error from the last
// attempt (nil on success). ctx cancelled -> returns ctx.Err() immediately.
func Do(ctx context.Context, p Policy, fn func() error) error {
	bo := newBackoff(p)
	var last error
	for attempt := 1; attempt <= p.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("retry: %w", err)
		}
		last = fn()
		if done, err := bo.advance(ctx, p, last, attempt); done {
			// ctx interrupted -> err; otherwise normal finish -> last (nil on success)
			return firstErr(err, last)
		}
	}
	return last
}

// firstErr -- returns a if non-nil, else b (backoff interrupted by ctx -> a; normal
// finish -> b = the last attempt's result).
func firstErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

// nonRetryable -- an error Retryable judges false returns immediately, no retry
// (invalid_grant, 4xx, etc).
func nonRetryable(p Policy, err error) bool {
	return p.Retryable != nil && !p.Retryable(err)
}

// backoff -- the backoff state machine: each round waits the current backoff (capped
// at MaxInterval, never past MaxTotal), then doubles it. Moved Do's branching in here
// to keep Do's cognitive complexity down. Holds only the fields it needs (not the whole
// Policy, to avoid duplicate storage).
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

// advance -- the decision after one attempt: success / non-retryable / attempt-count
// cap hit -> (true, nil) stop (caller returns last); otherwise back off for the next
// try -- total duration deadline hit -> (true, nil) stop; ctx interrupted -> (true, err).
func (b *backoff) advance(ctx context.Context, p Policy, last error, attempt int) (bool, error) {
	if last == nil || nonRetryable(p, last) || attempt == p.MaxAttempts {
		return true, nil
	}
	stop, err := b.pause(ctx)
	return stop || err != nil, err
}

// pause -- the backoff wait before the next retry. Returns (stop, err): total duration
// deadline hit -> (true, nil) stop; sleep interrupted by ctx -> (false, err) so Do
// returns directly.
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

// capped -- clamps the current backoff to MaxInterval and the MaxTotal deadline;
// returns -1 once the deadline has passed.
func (b *backoff) capped() time.Duration {
	wait := b.delay
	if b.maxInterval > 0 && wait > b.maxInterval {
		wait = b.maxInterval
	}
	return b.withinTotal(wait)
}

// withinTotal -- clamps wait to the remaining MaxTotal budget; returns -1 once the
// deadline has passed; returns wait unchanged when there is no MaxTotal.
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
