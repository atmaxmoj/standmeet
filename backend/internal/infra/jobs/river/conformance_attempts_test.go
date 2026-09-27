package river_test

// The contract, part 2: how a handler's result decides the next attempt.

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

const (
	snoozeRuns    = 4 // three snoozes, then the success
	snoozeGap     = 800 * time.Millisecond
	attemptLimit  = 150 * time.Millisecond
	flakyAttempts = 5
	deadAttempts  = 3
	goneAttempts  = 10
)

func TestRetryableErrorIsRetriedAndEachAttemptErrorIsRecorded(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("flaky", jobs.QueueIndex, flakyAttempts,
		func(context.Context, json.RawMessage) error {
			if n.Add(1) < 3 {
				return errors.New("meili: connection refused")
			}
			return nil
		})}, nil)
	j := waitState(t, rt, enqueue(t, rt, "flaky"), jobs.StateCompleted)
	if j.Attempt != 3 || len(j.Errors) != 2 || j.Errors[0].Error != "meili: connection refused" {
		t.Fatalf("attempt=%d errors=%v", j.Attempt, j.Errors)
	}
}

func TestExhaustedAttemptsEndDiscarded(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("dead", jobs.QueueIndex, deadAttempts,
		func(context.Context, json.RawMessage) error {
			n.Add(1)
			return errors.New("down")
		})}, nil)
	j := waitState(t, rt, enqueue(t, rt, "dead"), jobs.StateDiscarded)
	if n.Load() != 3 || len(j.Errors) != 3 {
		t.Fatalf("ran %d, errors %d; want 3 and 3", n.Load(), len(j.Errors))
	}
}

func TestDiscardIsPermanentAtOnce(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("gone", jobs.QueueWebhook, goneAttempts,
		func(context.Context, json.RawMessage) error {
			n.Add(1)
			return jobs.Discard(errors.New("410 Gone"))
		})}, nil)
	j := waitState(t, rt, enqueue(t, rt, "gone"), jobs.StateDiscarded)
	time.Sleep(200 * time.Millisecond)
	if n.Load() != 1 || j.Attempt != 1 {
		t.Fatalf("ran %d times at attempt %d, want 1", n.Load(), j.Attempt)
	}
}

func TestSnoozeDoesNotConsumeAnAttempt(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("limited", jobs.QueueNotify, 1,
		func(context.Context, json.RawMessage) error {
			if n.Add(1) < snoozeRuns {
				return jobs.Snooze(30 * time.Millisecond)
			}
			return nil
		})}, nil)
	// MaxAttempts is 1: three snoozes and a success still complete, because a snooze is not a try.
	waitState(t, rt, enqueue(t, rt, "limited"), jobs.StateCompleted)
	if n.Load() != snoozeRuns {
		t.Fatalf("ran %d times, want 4", n.Load())
	}
}

func TestSnoozeWaitsAtLeastTheGivenTime(t *testing.T) {
	t.Parallel()
	var first, second atomic.Int64
	rt := start(t, scratchDB(t), []jobs.Kind{kind("later", jobs.QueueNotify, 2,
		func(context.Context, json.RawMessage) error {
			if first.Load() == 0 {
				first.Store(time.Now().UnixNano())
				return jobs.Snooze(snoozeGap)
			}
			second.Store(time.Now().UnixNano())
			return nil
		})}, nil)
	waitState(t, rt, enqueue(t, rt, "later"), jobs.StateCompleted)
	if gap := time.Duration(second.Load() - first.Load()); gap < snoozeGap {
		t.Fatalf("second run after %s, want ≥ 800ms", gap)
	}
}

func TestTimeoutCancelsTheAttemptAndItBecomesRetryable(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	k := kind("slow", jobs.QueueIndex, 2, func(ctx context.Context, _ json.RawMessage) error {
		if n.Add(1) == 1 {
			<-ctx.Done() // the hard timeout must cancel us
			return ctx.Err()
		}
		return nil
	})
	k.Timeout = attemptLimit
	rt := start(t, scratchDB(t), []jobs.Kind{k}, nil)
	j := waitState(t, rt, enqueue(t, rt, "slow"), jobs.StateCompleted)
	if j.Attempt != 2 || len(j.Errors) != 1 {
		t.Fatalf("attempt=%d errors=%v, want the first attempt timed out", j.Attempt, j.Errors)
	}
}

func TestPanicInAHandlerIsAFailedAttemptNotACrash(t *testing.T) {
	t.Parallel()
	var n atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("boom", jobs.QueueIndex, 2,
		func(context.Context, json.RawMessage) error {
			if n.Add(1) == 1 {
				panic("handler bug")
			}
			return nil
		})}, nil)
	j := waitState(t, rt, enqueue(t, rt, "boom"), jobs.StateCompleted)
	if len(j.Errors) != 1 {
		t.Fatalf("errors = %v, want the panic recorded once", j.Errors)
	}
}
