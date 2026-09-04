package ops

import (
	"testing"
	"time"
)

// Named to keep revive's add-constant quiet: these values recur across the table.
const (
	statusOK   = "ok"
	shortEvery = 5 * time.Minute
)

// TestJobHealth — the freshness-aware status the background-jobs panel shows. The bug this
// guards: before jobHealth the op passed last_status straight through, so a job scheduled
// "every 5m" that last ran 6h ago still reported green "ok" — reading as healthy while it
// had silently stopped. Each overdue case here returns 'ok' on that old code, so the test
// goes red on the bug (guard-must-fail-on-the-bug).
func TestJobHealth(t *testing.T) {
	t.Parallel()
	now := time.Now()
	at := func(d time.Duration) *time.Time { u := now.Add(d); return &u }

	// Field order (every last) is govet fieldalignment's, not readability's.
	cases := []struct {
		name    string
		lastRun *time.Time
		status  string
		want    string
		every   time.Duration
	}{
		{"never run stays scheduled", nil, "scheduled", "scheduled", shortEvery},
		{"fresh run is ok", at(-1 * time.Minute), statusOK, statusOK, shortEvery},
		{"under 2x interval is still ok", at(-9 * time.Minute), statusOK, statusOK, shortEvery},
		{"past 2x interval is overdue", at(-6 * time.Hour), statusOK, "overdue", shortEvery},
		{"error is never masked", at(-6 * time.Hour), "error", "error", shortEvery},
		{"long interval not yet due", at(-13 * time.Hour), statusOK, statusOK, 24 * time.Hour},
		{"zero interval is never overdue", at(-6 * time.Hour), statusOK, statusOK, 0},
	}
	for _, c := range cases {
		if got := jobHealth(now, c.lastRun, c.every, c.status); got != c.want {
			t.Errorf("%s: jobHealth = %q, want %q", c.name, got, c.want)
		}
	}
}
