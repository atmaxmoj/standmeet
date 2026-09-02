// jobs.go — usecase layer for job source register, fetch_new, show, discard.
//
// See docs/design/job-loop.md. This layer does:
//   - register/unregister/list source (thin wrap over postgres)
//   - fetch_new: call fetcher -> fingerprint dedup -> into the Redis 1d TTL pool -> return
//   - show/discard: go through the Redis pool
//
// Reasoning / ranking / matching are Claude's job on the client side; this layer stays out of it.

// Package jobsuc — J.2: jobs / resume / applications use cases moved over from
// internal/usecases. Internal to the jobs plugin, path internal/plugins/
// jobs/jobsuc/. Package name jobsuc (avoids clashing with the core internal/usecases),
// referenced externally as jobsuc.JobsDeps.
package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// JobsDeps — dependencies for the jobs.* usecases.
type JobsDeps struct {
	Sources  *JobSourceRepo
	Cache    *jobcache.Pool
	Registry *jobfetch.Registry
}

// RegisterJobSource — validates kind/config, then writes to postgres.
func RegisterJobSource(
	ctx context.Context, deps JobsDeps, in *jobsmodel.CreateJobSourceInput,
) (jobsmodel.JobSource, error) {
	if err := validateRegisterInput(in); err != nil {
		return jobsmodel.JobSource{}, err
	}
	src, err := deps.Sources.Create(ctx, in)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf("create source: %w", err)
	}
	return src, nil
}

func validateRegisterInput(in *jobsmodel.CreateJobSourceInput) error {
	if in.OwnerID == "" || in.Kind == "" || in.Label == "" {
		return apierr.ErrEmptyField
	}
	if err := jobfetch.ValidateKindConfig(in.Kind, in.Config); err != nil {
		return fmt.Errorf("validate kind/config: %w", err)
	}
	return nil
}

// ListJobSources — all sources belonging to the owner.
func ListJobSources(
	ctx context.Context, deps JobsDeps, ownerID string,
) ([]jobsmodel.JobSource, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	list, err := deps.Sources.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return list, nil
}

// UnregisterJobSource — deletes a source (cascades to delete its fingerprints).
func UnregisterJobSource(
	ctx context.Context, deps JobsDeps, ownerID, sourceID string,
) error {
	if ownerID == "" || sourceID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Sources.Delete(ctx, ownerID, sourceID); err != nil {
		return fmt.Errorf("delete source: %w", err)
	}
	return nil
}

// FetchNewJobs — the core call. sourceID==nil -> runs every source the owner has;
// sourceID set -> runs that one source. Returns the new jobs (already deduped and
// already in the pool, with a cache_id attached) **plus every source that failed to fetch**.
//
// This used to be `if ferr != nil { return nil, ferr }`, while the comment above it said
// "a single source's failure **does not block** the others" — the invariant the comment
// claimed was the exact opposite of the code below it. This surfaced during a manual drive:
// only the workable source's token was wrong out of seven sources, and as a result
// **none of the other six real sources made it into the pool** — the owner got back
// nothing but `jobs.fetch_new failed`.
//
// A comment is trusted more easily than code: whoever reads that line stops digging
// further ([[names-that-lie]]). Now the invariant holds because the code itself enforces
// it — each source succeeds or fails on its own, and failures are recorded into
// failures and returned alongside the rest.
func FetchNewJobs(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string, since time.Duration,
) (FetchResult, error) {
	if ownerID == "" {
		return FetchResult{}, apierr.ErrEmptyField
	}
	sources, err := selectSourcesToFetch(ctx, deps, ownerID, sourceID)
	if err != nil {
		return FetchResult{}, err
	}
	all := fetchEverySource(ctx, deps, sources)
	// J.6c: cross-source dedup (canonical URL + composite key). This adds one more layer
	// on top of fetchOneSourceAndDedup's per-source seen-by-external-id — that layer only
	// guards against a duplicate post within the same source; a cross-source duplicate
	// slips through when the ATS namespaces give it different external_ids.
	// This does not touch the per-source seen record (that one still marks seen by the
	// ID the fetcher returned) — it only dedups the surface visible to Claude.
	visible := dedup.Apply(all.jobs)
	failures, tallies := all.failures, all.tallies
	// What gets handed back is **this window of the pool**, not just the few caught this
	// round — the latter is only the New-flagged subset of the former.
	// A failure reading the window must not throw away what was already fetched: at least
	// hand back this round's new entries.
	rows, perr := poolWindow(ctx, deps, ownerID, since, visible)
	if perr != nil {
		slog.WarnContext(ctx, "job pool window not read", "err", perr)
		rows = newRowsOnly(visible)
	}
	return FetchResult{
		Jobs: rows, Failures: failures, Tallies: tallies,
		CrossSourceDropped: len(all.jobs) - len(visible),
	}, nil
}

// everySourceRun — combined output of every source in one round. Three values collected
// into one struct instead of three return values: they're three facets of the same
// traversal, and splitting them invites someone to catch only one facet.
type everySourceRun struct {
	jobs     []jobsmodel.FetchedJob
	failures []SourceFailure
	tallies  []SourceTally
}

// fetchEverySource — fetches source by source; **one source's failure does not affect the rest**.
func fetchEverySource(
	ctx context.Context, deps JobsDeps, sources []jobsmodel.JobSource,
) everySourceRun {
	var out everySourceRun
	for i := range sources {
		run, ferr := fetchOneSourceAndDedup(ctx, deps, &sources[i])
		// Every attempt gets recorded, **success or failure**. The failure detail used to
		// live only in this call's response, gone once the window closed, while
		// /admin/sources would just say `never fetched` (F-E-18).
		markAttempt(ctx, deps, sources[i].ID, ferr)
		if ferr != nil {
			out.failures = append(out.failures, failureOf(&sources[i], ferr))
			continue
		}
		out.jobs = append(out.jobs, run.jobs...)
		out.tallies = append(out.tallies, run.tally)
	}
	return out
}

// poolWindow / newRowsOnly live in pool_window.go — "what gets shown to the owner side"
// and "how the fetch happens" are two different concerns, and the former was only
// added this round (F-E-29).

// markAttempt — writes this attempt's success/failure back onto the source's row.
// **A write failure here is not itself a fetch failure**: the owner has already gotten
// the jobs (or the failure reason), and turning the whole call into an error just because
// this bookkeeping couldn't be written would let a minor incident bury the main result.
// Log it and move on if the write fails.
func markAttempt(ctx context.Context, deps JobsDeps, sourceID string, ferr error) {
	// What's stored is **the human-readable sentence**, not the whole error chain — that
	// line renders verbatim on /admin/sources, and the chain's leading segments (source
	// uuid, internal verbs) are useless to the owner (UX-77). The full chain still
	// reaches the owner's AI via `SourceFailure.Reason`, and is also in the logs.
	reason := ""
	if ferr != nil {
		reason = sourceFailureSentence(ferr)
	}
	if merr := deps.Sources.MarkAttempt(ctx, sourceID, reason); merr != nil {
		slog.WarnContext(ctx, "job source attempt not recorded",
			"source", sourceID, "err", merr)
	}
}

func selectSourcesToFetch(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string,
) ([]jobsmodel.JobSource, error) {
	if sourceID != nil && *sourceID != "" {
		src, err := deps.Sources.GetByID(ctx, ownerID, *sourceID)
		if err != nil {
			return nil, fmt.Errorf("get source by id: %w", err)
		}
		return []jobsmodel.JobSource{src}, nil
	}
	list, err := deps.Sources.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return list, nil
}

func fetchOneSourceAndDedup(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource,
) (sourceRun, error) {
	acc, err := fetchAndStampSourceID(ctx, deps, src)
	if err != nil {
		return sourceRun{}, err
	}
	newJobs, err := keepUnseen(ctx, deps, src.ID, acc.Jobs)
	if err != nil {
		return sourceRun{}, err
	}
	pooled, err := persistNewJobs(ctx, deps, src, newJobs)
	if err != nil {
		return sourceRun{}, err
	}
	return sourceRun{jobs: pooled, tally: SourceTally{
		SourceID: src.ID, Label: src.Label, Kind: src.Kind,
		Seen: len(acc.Jobs), Pooled: len(pooled), Duplicate: len(acc.Jobs) - len(newJobs),
		// The adapter's own bookkeeping (only sources that fetch item-by-item have this):
		// how many the upstream reported total, how many we actually read, how many were
		// skipped and why, and whether we hit the cap and got truncated.
		Available: acc.Available, Read: acc.Read,
		Skipped: acc.Skipped, Truncated: acc.Truncated,
	}}, nil
}

func persistNewJobs(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource, newJobs []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	if len(newJobs) == 0 {
		return nil, touchSource(ctx, deps, src.ID)
	}
	withCache, err := deps.Cache.Put(ctx, src.OwnerID, newJobs)
	if err != nil {
		return nil, fmt.Errorf("cache put: %w", err)
	}
	if rerr := recordSeenAndTouch(ctx, deps, src.ID, withCache); rerr != nil {
		return nil, rerr
	}
	return withCache, nil
}

func fetchAndStampSourceID(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource,
) (jobfetch.Accounted, error) {
	acc, err := deps.Registry.FetchAccounted(ctx, src.Kind, src.Config)
	if err != nil {
		return jobfetch.Accounted{}, fmt.Errorf("fetch source %s: %w", src.ID, err)
	}
	for i := range acc.Jobs {
		acc.Jobs[i].SourceID = src.ID
	}
	return acc, nil
}

func keepUnseen(
	ctx context.Context, deps JobsDeps, sourceID string, raw []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	unseen, err := deps.Sources.FilterUnseenExternalIDs(ctx, sourceID, externalIDsOf(raw))
	if err != nil {
		return nil, fmt.Errorf("filter unseen: %w", err)
	}
	return pickByIDSet(raw, unseen), nil
}

func externalIDsOf(raw []jobsmodel.FetchedJob) []string {
	out := make([]string, 0, len(raw))
	for i := range raw {
		out = append(out, raw[i].ExternalID)
	}
	return out
}

func pickByIDSet(raw []jobsmodel.FetchedJob, allowed []string) []jobsmodel.FetchedJob {
	set := make(map[string]struct{}, len(allowed))
	for _, e := range allowed {
		set[e] = struct{}{}
	}
	out := raw[:0]
	for i := range raw {
		if _, ok := set[raw[i].ExternalID]; ok {
			out = append(out, raw[i])
		}
	}
	return out
}

func recordSeenAndTouch(
	ctx context.Context, deps JobsDeps, sourceID string, jobs []jobsmodel.FetchedJob,
) error {
	newIDs := make([]string, 0, len(jobs))
	for i := range jobs {
		newIDs = append(newIDs, jobs[i].ExternalID)
	}
	if err := deps.Sources.RecordSeenExternalIDs(ctx, sourceID, newIDs); err != nil {
		return fmt.Errorf("record fingerprints: %w", err)
	}
	return touchSource(ctx, deps, sourceID)
}

func touchSource(ctx context.Context, deps JobsDeps, sourceID string) error {
	if err := deps.Sources.TouchFetched(ctx, sourceID); err != nil {
		return fmt.Errorf("touch: %w", err)
	}
	return nil
}

// ShowJob — looks a job up in the pool; returns ErrJobCacheMiss once expired / discarded.
func ShowJob(
	ctx context.Context, deps JobsDeps, ownerID, cacheID string,
) (jobsmodel.FetchedJob, error) {
	if ownerID == "" || cacheID == "" {
		return jobsmodel.FetchedJob{}, apierr.ErrEmptyField
	}
	job, err := deps.Cache.Get(ctx, ownerID, cacheID)
	if err != nil {
		if errors.Is(err, jobcache.ErrCacheMiss) {
			return jobsmodel.FetchedJob{}, jobsmodel.ErrJobCacheMiss
		}
		return jobsmodel.FetchedJob{}, fmt.Errorf("cache get: %w", err)
	}
	return job, nil
}

// DiscardJob — actively removes a job from the owner's view.
func DiscardJob(ctx context.Context, deps JobsDeps, ownerID, cacheID string) error {
	if ownerID == "" || cacheID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Cache.Discard(ctx, ownerID, cacheID); err != nil {
		return fmt.Errorf("cache discard: %w", err)
	}
	return nil
}
