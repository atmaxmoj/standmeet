// usage_periodic.go — this domain's periodic job: clean old inference_usage rows.
//
// It used to run only once at boot. An instance that runs for three months without a
// restart never cleans again after day one — that's not "cleaned every 7 days", that's
// "cleaned once, at restart", and the two read identically on a dashboard.
//
// The cleanup rule itself lives in SQL (metered rows are kept, or the "gas" would grow
// back on its own); this file only owns how often it runs.

package repo

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// usageCleanupEvery — the table grows by the day, so once a day is enough; the interval
// sentence is derived from this constant, not restated anywhere else.
const usageCleanupEvery = 24 * time.Hour

// UsagePeriodicJobs — the periodic jobs this domain exposes. repo == nil → expose none:
// a dashboard shouldn't show a job that's always "ok" while doing nothing.
func UsagePeriodicJobs(r *InferenceUsageRepo) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"inference usage cleanup", usageCleanupEvery,
		func(ctx context.Context) error {
			return r.Cleanup(ctx)
		},
	)}
}
