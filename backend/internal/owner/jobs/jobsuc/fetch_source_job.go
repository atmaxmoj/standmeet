// fetch_source_job.go — one attempt of jobs.fetch_source: fetch one source, record the attempt
// on its row, and keep the outcome for whoever assembles the fetch's answer (fetch_jobs.go).

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// runFetchSource — one attempt of jobs.fetch_source. A retry after the outcome was kept does
// nothing more.
func runFetchSource(ctx context.Context, deps *JobsDeps, raw json.RawMessage) error {
	a, err := parseFetchArgs(raw)
	if err != nil {
		return err
	}
	if _, err = deps.Cache.GetRun(ctx, a.RunID, a.SourceID); err == nil {
		return nil
	}
	src, err := deps.Sources.GetByID(ctx, a.OwnerID, a.SourceID)
	if errors.Is(err, jobsmodel.ErrJobSourceNotFound) {
		return jobs.Discard(err) //nolint:wrapcheck // unregistered since: nothing to fetch
	}
	if err != nil {
		return fmt.Errorf("load source: %w", err)
	}
	return keepOutcome(ctx, deps, &a, fetchSource(ctx, deps, &src))
}

func parseFetchArgs(raw json.RawMessage) (fetchSourceArgs, error) {
	var a fetchSourceArgs
	if err := json.Unmarshal(raw, &a); err != nil || a.SourceID == "" || a.RunID == "" {
		//nolint:wrapcheck // Discard is the failure class; it wraps the cause
		return a, jobs.Discard(fmt.Errorf("%s: bad args %s", FetchSourceKind, raw))
	}
	return a, nil
}

// keepOutcome —— jobs.fetched for a fetch that succeeded, then the outcome for the assembler.
func keepOutcome(
	ctx context.Context, deps *JobsDeps, a *fetchSourceArgs, o sourceOutcome,
) error {
	if o.Failure == nil {
		data := map[string]int{"new_count": len(o.Jobs)}
		err := deps.Events().Record(ctx, a.OwnerID, JobsFetched, "jobs/"+a.OwnerID, data)
		if err != nil {
			return fmt.Errorf("record %s: %w", JobsFetched, err)
		}
	}
	kept, err := json.Marshal(o)
	if err != nil {
		//nolint:wrapcheck // Discard is the failure class; it wraps the cause
		return jobs.Discard(fmt.Errorf("encode fetch outcome: %w", err))
	}
	return deps.Cache.PutRun(ctx, a.RunID, a.SourceID, kept) //nolint:wrapcheck // names its step
}

// fetchSource — fetch, dedup against this source's seen ids, pool; the attempt is recorded on the
// source row either way.
func fetchSource(ctx context.Context, deps *JobsDeps, src *jobsmodel.JobSource) sourceOutcome {
	run, ferr := fetchOneSourceAndDedup(ctx, *deps, src)
	// Every attempt gets recorded, **success or failure**: /admin/sources shows it (F-E-18).
	markAttempt(ctx, *deps, src.ID, ferr)
	if ferr != nil {
		f := failureOf(src, ferr)
		return sourceOutcome{Failure: &f, Jobs: []jobsmodel.FetchedJob{}}
	}
	return sourceOutcome{Tally: &run.tally, Jobs: run.jobs}
}
