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
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// JobsDeps — dependencies for the jobs.* usecases.
type JobsDeps struct {
	Sources  *JobSourceRepo
	Cache    *jobcache.Pool
	Registry *jobfetch.Registry
	// Pool —— a fetch's source jobs are enqueued in one transaction on it.
	Pool *pgstore.Pool
	// Queue / Events —— the job runtime and the outbox; read at call time (both are built after
	// this module).
	Queue  func() jobs.Runtime
	Events func() events.Recorder
	// Wait —— how long jobs.fetch_new waits for its source jobs (FetchWait).
	Wait time.Duration
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

// FetchNewJobs lives in fetch_jobs.go: one job per source. **One source's failure does not
// affect the rest** — each source succeeds or fails in its own job, and a failure is that
// source's line in failed_sources, returned alongside what the others fetched. (It once was
// `if ferr != nil { return nil, ferr }` under a comment claiming the opposite: one bad token out
// of seven sources and the owner got nothing but `jobs.fetch_new failed` — [[names-that-lie]].)

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
	ctx context.Context, deps JobsDeps, sourceID string, pooled []jobsmodel.FetchedJob,
) error {
	newIDs := make([]string, 0, len(pooled))
	for i := range pooled {
		newIDs = append(newIDs, pooled[i].ExternalID)
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
