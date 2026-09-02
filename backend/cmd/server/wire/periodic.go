// periodic.go — collects the periodic jobs **declared** in each place and hands them to the
// one host-side scheduler.
//
// This replaces two hand-written crons (resume_draft_sweep.go and the sweep loop in the
// workspace wiring) plus one loop that was **never registered at all** (corpus's Meili
// reconcile — it ran the whole time, yet never once showed up in the Monitor panel). Each of
// the three wrote its own ticker, its own Register/Report, its own hand-typed "every 5m".
//
// Now: what to do comes from whoever declares it, and the how-often + bookkeeping belongs to
// internal/infra/periodic. This file only collects the declarations — one line per source.

package wire

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// PeriodicJobs — collect + start.
func PeriodicJobs(ctx context.Context, d *deps.Runtime) {
	periodic.Start(ctx, d.JobRegistry, d.Log, collectPeriodicJobs(d))
}

// collectPeriodicJobs — one line per source.
func collectPeriodicJobs(d *deps.Runtime) []periodic.Job {
	jobs := d.PluginRegistry.AllPeriodicJobs()
	jobs = append(jobs, corpus.IndexPeriodicJobs(d.CorpusIndexer, soleOwnerID(d))...)
	jobs = append(jobs, stats.UsagePeriodicJobs(d.InferenceUsageRepo)...)
	if d.SandboxWorkspaces != nil {
		jobs = append(jobs, d.SandboxWorkspaces.PeriodicJobs()...)
	}
	return jobs
}

// soleOwnerID — translates the owner domain's "this instance's owner" into the narrow port
// corpus understands. The translation lives on the assembly root: corpus doesn't know the
// owner domain, and the owner domain shouldn't know who periodically rebuilds the index.
//
// Not-yet-claimed (ErrOwnerNotFound) translates to an empty string rather than an error:
// that's the normal state of a brand-new instance, not a fault. Every other failure is
// reported as-is — a genuine failure to read the owner should be visible on the panel.
func soleOwnerID(d *deps.Runtime) corpus.SoleOwnerID {
	return func(ctx context.Context) (string, error) {
		row, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
		if errors.Is(err, owner.ErrOwnerNotFound) {
			return "", nil
		}
		if err != nil {
			return "", fmt.Errorf("sole owner: %w", err)
		}
		return row.ID, nil
	}
}
