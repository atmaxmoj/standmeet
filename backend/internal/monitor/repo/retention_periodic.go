// retention_periodic.go —— this domain's periodic job: drop traffic older than the window.
//
// Periodic, not boot-time. An instance that runs for months without a restart would otherwise
// clean once, on day one, and keep everything after — which reads identically to "retention is
// working" until the table is years deep.
//
// Three months. It is the longest window the panel offers, so nothing an owner can ask for is
// missing, and nothing is kept that no view can reach. Keeping a year "in case" would mean
// holding visitor records nobody looks at, which is the opposite of what a cookieless,
// IP-less design is for.

package repo

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

const (
	// RetentionWindow —— how far back traffic is kept. Equal to the panel's longest window
	// (Window90d) on purpose: one number decides both, so "the panel shows three months" and
	// "the database holds three months" cannot drift into a view that reads half-empty.
	RetentionWindow = windowSpan90d
	// retentionEvery —— the table grows by the day, so once a day is enough.
	retentionEvery = 24 * time.Hour
)

// PeriodicJobs —— the periodic jobs this domain exposes. A nil repo exposes none: a panel must
// not show a job that reports "ok" while doing nothing.
func PeriodicJobs(r *Repo) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"visitor traffic retention", retentionEvery,
		func(ctx context.Context) error {
			_, err := r.Prune(ctx, time.Now().UTC().Add(-RetentionWindow))
			return err
		},
	)}
}
