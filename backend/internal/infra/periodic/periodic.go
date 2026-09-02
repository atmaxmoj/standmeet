// Package periodic — in-process periodic tasks: one scheduler, nobody hand-rolls their own loop.
//
// Before this, every periodic task carried its own full kit: a ticker goroutine, a run-once-at-boot
// step, a pair of Register/Report bookkeeping calls, and two constants (the interval + a
// panel-facing string like "every 5m"). That got copied three times over, hence:
//
//   - The schedule string was **hand-written**, stored separately from the real interval — it
//     could say "every 5m" while actually running hourly, and the panel would show it with a
//     straight face. Here it's **derived** from the interval, removing one place that could lie.
//   - Skip one Register call and the task vanishes from the Monitor panel while still running
//     fine. That's exactly what happened to corpus's Meili reconcile loop: it kept running, but
//     never once showed up on the panel.
//
// The division of labor is fixed: **what to do** comes from whoever declares the task (a domain /
// plugin / axis's own logic); **how often, plus bookkeeping** belongs to the host. The declaration
// is data, the same pattern as OwnerTools / Config / HostOps.
package periodic

import (
	"context"
	"log/slog"
	"strconv"
	"time"
)

// Run — what the task actually does. Returning error → this round is logged "error",
// but the loop keeps going (one failure doesn't stop the clock).
type Run func(ctx context.Context) error

// Job — the declaration of one periodic task.
type Job struct {
	Run   Run
	Name  string // identity on the Monitor panel, e.g. "resume-draft sweep"
	Every time.Duration
}

// Board — the bookkeeping surface (stats's JobRegistry satisfies it). The declaring side
// doesn't know about stats.
type Board interface {
	Register(name, schedule string)
	Report(name, status string)
}

// Start — registers each job, runs it once at boot (so last_run has a definite value right
// away), then starts its periodic loop. Stops when ctx is canceled (process exit). A job with
// Every <= 0 is skipped and logged: that's a declaration bug, not "runs very fast".
func Start(ctx context.Context, board Board, log *slog.Logger, jobs []Job) {
	for i := range jobs {
		job := jobs[i]
		if job.Every <= 0 {
			log.Error("periodic job has no interval — not scheduled", "job", job.Name)
			continue
		}
		board.Register(job.Name, scheduleOf(job.Every))
		runOnce(ctx, board, log, &job)
		go loop(ctx, board, log, job)
	}
}

// scheduleOf — the panel string is derived from the interval, not written separately.
//
// Duration.String() gives things like "1h0m0s", which reads badly on the panel; strip the
// trailing zero parts → "1h" / "5m". This only affects display — the interval still has exactly
// one source, Every.
func scheduleOf(every time.Duration) string {
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

func loop(ctx context.Context, board Board, log *slog.Logger, job Job) {
	ticker := time.NewTicker(job.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce(ctx, board, log, &job)
		}
	}
}

func runOnce(ctx context.Context, board Board, log *slog.Logger, job *Job) {
	if err := job.Run(ctx); err != nil {
		board.Report(job.Name, "error")
		log.Warn("periodic job", "job", job.Name, "err", err)
		return
	}
	board.Report(job.Name, "ok")
}

// Named — shorthand for declaring a task, so each call site skips repeating three field names.
func Named(name string, every time.Duration, run Run) Job {
	return Job{Name: name, Every: every, Run: run}
}

// Wrap — wraps an action that returns no error into a Run (e.g. a log-only best-effort rebuild).
func Wrap(fn func(ctx context.Context)) Run {
	return func(ctx context.Context) error {
		fn(ctx)
		return nil
	}
}
