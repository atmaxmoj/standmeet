// Package periodic — how a domain declares a periodic task: data, not a loop.
//
// What to do comes from whoever declares the task; how often, on which process, and the durable
// record of each run belong to the job runtime (internal/infra/jobs: River periodic jobs,
// leader-elected, one row per run). The composition root collects these declarations
// (cmd/server/wire/periodic.go). Nothing here schedules anything: the hand-written in-process
// ticker that used to live here ran on every replica and forgot its history on restart.
package periodic

import (
	"context"
	"strconv"
	"time"
)

// Run — what the task actually does. A returned error marks this run failed; the next period is
// the retry.
type Run func(ctx context.Context) error

// Job — the declaration of one periodic task.
type Job struct {
	Run   Run
	Name  string // identity on the Tasks panel, e.g. "resume-draft sweep"
	Every time.Duration
}

// Named — shorthand for declaring a task.
func Named(name string, every time.Duration, run Run) Job {
	return Job{Name: name, Every: every, Run: run}
}

// Wrap — wraps an action that returns no error into a Run.
func Wrap(fn func(ctx context.Context)) Run {
	return func(ctx context.Context) error {
		fn(ctx)
		return nil
	}
}

// ScheduleOf — the panel string, derived from the interval so it cannot drift from what fires.
func ScheduleOf(every time.Duration) string {
	return "every " + tidyDuration(every)
}

// tidyDuration — a whole hour → "1h", a whole minute → "5m", anything else left as-is.
func tidyDuration(d time.Duration) string {
	switch {
	case d%time.Hour == 0:
		return strconv.Itoa(int(d/time.Hour)) + "h"
	case d%time.Minute == 0:
		return strconv.Itoa(int(d/time.Minute)) + "m"
	default:
		return d.String()
	}
}
