package retry

import (
	"context"
	"time"
)

// WithClock -- test-only seam: injects a fake sleep / now into a Policy (backoff
// doesn't really sleep, and the clock is controllable, making retry tests deterministic).
// These two fields stay unexported for prod; this export_test.go is the only way to
// expose them to the external retry_test package.
func WithClock(
	p Policy,
	sleep func(context.Context, time.Duration) error,
	now func() time.Time,
) Policy {
	p.sleep = sleep
	p.now = now
	return p
}
