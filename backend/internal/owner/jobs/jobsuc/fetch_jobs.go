// fetch_jobs.go — a fetch runs as one durable job per source (docs/design/event-bus-outbox-
// webhooks.md, inventory #39/#62, *Completion hooks*).
//
// It used to fetch every source serially inside the request: slow, and a few slow boards could
// hit the 30 s write timeout. Now jobs.fetch_new enqueues one `jobs.fetch_source` job per source,
// all in one transaction, and waits up to FetchWait for them:
//   - all done → the answer is exactly the shape it always was (FetchResult);
//   - otherwise → a receipt {job_ids, pending}; jobs.fetch_result(job_ids) answers the same
//     FetchResult once they are all done. A job's tasks.get shows its state.
//
// Each job fetches its source, records the attempt on the source row, and keeps its outcome in
// the pool store (cache.PutRun) for whoever assembles the answer. A board's own failure is an
// outcome (failed_sources), never a job failure: the next fetch is its retry. Only our own
// storage failing retries the job.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// FetchSourceKind — the job kind that fetches one source.
const FetchSourceKind = "jobs.fetch_source"

// JobsFetched — a source's fetch finished and pooled data.new_count new jobs.
const JobsFetched = "jobs.fetched"

// FetchWait — how long jobs.fetch_new waits for its source jobs before answering with a receipt.
const FetchWait = 20 * time.Second

const (
	fetchAttempts = 3
	fetchTimeout  = 2 * time.Minute
)

// ErrFetchNotFound — a job id that is not one of this owner's source fetches (or is long gone).
var ErrFetchNotFound = errors.New("no such fetch")

// FetchReceipt — the fetch is still running: its jobs, to hand back to jobs.fetch_result.
type FetchReceipt struct {
	JobIDs  []jobs.JobID `json:"job_ids"`
	Pending bool         `json:"pending"`
}

// FetchOutcome — a finished fetch's Result, or a Receipt while its jobs still run.
type FetchOutcome struct {
	Receipt *FetchReceipt
	Result  FetchResult
}

// fetchSourceArgs — one source's job. RunID keys where its outcome is kept.
type fetchSourceArgs struct {
	OwnerID  string `json:"owner_id"`
	SourceID string `json:"source_id"`
	RunID    string `json:"run_id"`
}

// sourceOutcome — what one source's job leaves for the assembler.
type sourceOutcome struct {
	Tally   *SourceTally           `json:"tally,omitempty"`
	Failure *SourceFailure         `json:"failure,omitempty"`
	Jobs    []jobsmodel.FetchedJob `json:"jobs"`
}

// FetchEventTypes — the event types the job loop owns.
func FetchEventTypes() []events.Type {
	return []events.Type{{
		Type:        JobsFetched,
		Description: "A job source was fetched (data.new_count new listings pooled).",
		Subject:     "jobs/<owner id>",
		Exposure:    events.Webhook,
	}, {
		Type: ApplicationCommitted,
		Description: "An application was committed with its access code " +
			"(data.application_id, data.code_id).",
		Subject:  "application/<application id>",
		Exposure: events.Webhook,
	}}
}

// FetchKinds — jobs.fetch_source.
func FetchKinds(deps *JobsDeps) []jobs.Kind {
	return []jobs.Kind{{
		Name: FetchSourceKind, Queue: jobs.QueueFetch,
		MaxAttempts: fetchAttempts, Timeout: fetchTimeout,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			return runFetchSource(ctx, deps, raw)
		},
	}}
}

// FetchNewJobs — the core call. sourceID==nil → every source the owner has; set → that one.
// Enqueues one job per source, then waits up to deps.Wait: done → Result, else → Receipt.
func FetchNewJobs(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string, since time.Duration,
) (FetchOutcome, error) {
	if ownerID == "" {
		return FetchOutcome{}, apierr.ErrEmptyField
	}
	sources, err := selectSourcesToFetch(ctx, deps, ownerID, sourceID)
	if err != nil {
		return FetchOutcome{}, err
	}
	ids, err := enqueueFetch(ctx, &deps, ownerID, sources)
	if err != nil {
		return FetchOutcome{}, err
	}
	if !awaitFetch(ctx, &deps, ids) {
		return receipt(ids), nil
	}
	return FetchResultOf(ctx, deps, ownerID, ids, since)
}

// FetchResultOf — the answer of the fetch whose jobs are ids: its Result once every job is done,
// a Receipt while any still runs.
func FetchResultOf(
	ctx context.Context, deps JobsDeps, ownerID string, ids []jobs.JobID, since time.Duration,
) (FetchOutcome, error) {
	outcomes := make([]sourceOutcome, 0, len(ids))
	for _, id := range ids {
		o, err := outcomeOf(ctx, &deps, ownerID, id)
		if err != nil {
			return FetchOutcome{}, err
		}
		if o == nil {
			return receipt(ids), nil
		}
		outcomes = append(outcomes, *o)
	}
	return FetchOutcome{Result: assemble(ctx, &deps, ownerID, since, outcomes)}, nil
}

func receipt(ids []jobs.JobID) FetchOutcome {
	return FetchOutcome{Receipt: &FetchReceipt{JobIDs: ids, Pending: true}}
}

// enqueueFetch — one job per source, in one transaction: all of them exist, or none.
func enqueueFetch(
	ctx context.Context, deps *JobsDeps, ownerID string, sources []jobsmodel.JobSource,
) ([]jobs.JobID, error) {
	run := uuid.NewString()
	ids := make([]jobs.JobID, 0, len(sources))
	err := pgstore.InTx(ctx, deps.Pool, func(tx pgstore.Tx) error {
		q := deps.Queue().With(tx)
		for i := range sources {
			a := fetchSourceArgs{OwnerID: ownerID, SourceID: sources[i].ID, RunID: run}
			id, err := q.Enqueue(ctx, FetchSourceKind, a, jobs.EnqueueOpts{})
			if err != nil {
				return fmt.Errorf("enqueue fetch of source %s: %w", sources[i].ID, err)
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("enqueue fetch: %w", err)
	}
	return ids, nil
}

// awaitFetch — whether every job finished within deps.Wait (one deadline for all of them).
func awaitFetch(ctx context.Context, deps *JobsDeps, ids []jobs.JobID) bool {
	deadline := time.Now().Add(deps.Wait)
	for _, id := range ids {
		if _, ok := deps.Queue().Wait(ctx, id, time.Until(deadline)); !ok {
			return false
		}
	}
	return true
}

// outcomeOf — job id's outcome, or nil while the job is not done: "not done yet" is neither an
// outcome nor an error.
func outcomeOf(
	ctx context.Context, deps *JobsDeps, ownerID string, id jobs.JobID,
) (*sourceOutcome, error) {
	fj, err := ownFetchJob(ctx, deps, ownerID, id)
	if err != nil {
		return nil, err
	}
	if !fj.job.State.Terminal() {
		return nil, nil
	}
	o, err := storedOutcome(ctx, deps, &fj.args, &fj.job)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// fetchJob —— one source job, and its args.
type fetchJob struct {
	args fetchSourceArgs
	job  jobs.Job
}

// ownFetchJob —— job id, when it is one of ownerID's source fetches; ErrFetchNotFound otherwise.
func ownFetchJob(
	ctx context.Context, deps *JobsDeps, ownerID string, id jobs.JobID,
) (fetchJob, error) {
	j, err := deps.Queue().Get(ctx, id)
	if errors.Is(err, jobs.ErrNotFound) {
		return fetchJob{}, fmt.Errorf("%w: job %d", ErrFetchNotFound, id)
	}
	if err != nil {
		return fetchJob{}, fmt.Errorf("read fetch job: %w", err)
	}
	a, ok := argsOf(&j, ownerID)
	if !ok {
		return fetchJob{}, fmt.Errorf("%w: job %d", ErrFetchNotFound, id)
	}
	return fetchJob{args: a, job: j}, nil
}

// argsOf —— the job's args, when it is a source fetch of ownerID's.
func argsOf(j *jobs.Job, ownerID string) (fetchSourceArgs, bool) {
	var a fetchSourceArgs
	ok := j.Kind == FetchSourceKind && json.Unmarshal(j.Args, &a) == nil && a.OwnerID == ownerID
	return a, ok
}

// storedOutcome — what the job left; a job that ended without leaving one (discarded, cancelled,
// or its outcome expired) is that source's failure.
func storedOutcome(
	ctx context.Context, deps *JobsDeps, a *fetchSourceArgs, j *jobs.Job,
) (sourceOutcome, error) {
	raw, err := deps.Cache.GetRun(ctx, a.RunID, a.SourceID)
	if errors.Is(err, jobcache.ErrCacheMiss) {
		return unfinished(ctx, deps, a, j), nil
	}
	if err != nil {
		return sourceOutcome{}, fmt.Errorf("read fetch outcome: %w", err)
	}
	var o sourceOutcome
	if err = json.Unmarshal(raw, &o); err != nil {
		return sourceOutcome{}, fmt.Errorf("decode fetch outcome: %w", err)
	}
	return o, nil
}

// unfinished — the failure line for a source whose job ended with nothing to show.
func unfinished(
	ctx context.Context, deps *JobsDeps, a *fetchSourceArgs, j *jobs.Job,
) sourceOutcome {
	f := SourceFailure{SourceID: a.SourceID, Reason: "the fetch did not finish (" +
		string(j.State) + ")"}
	if n := len(j.Errors); n > 0 {
		f.Reason += ": " + j.Errors[n-1].Error
	}
	if src, err := deps.Sources.GetByID(ctx, a.OwnerID, a.SourceID); err == nil {
		f.Label, f.Kind = src.Label, src.Kind
	}
	return sourceOutcome{Failure: &f}
}

// assemble — the outcomes, in source order, as the one FetchResult shape.
func assemble(
	ctx context.Context, deps *JobsDeps, ownerID string, since time.Duration,
	outcomes []sourceOutcome,
) FetchResult {
	var (
		all      []jobsmodel.FetchedJob
		failures []SourceFailure
		tallies  []SourceTally
	)
	for i := range outcomes {
		all = append(all, outcomes[i].Jobs...)
		if f := outcomes[i].Failure; f != nil {
			failures = append(failures, *f)
		}
		if t := outcomes[i].Tally; t != nil {
			tallies = append(tallies, *t)
		}
	}
	// J.6c: cross-source dedup (canonical URL + composite key), on top of each source's own
	// seen-by-external-id. It only dedups the surface the owner sees.
	visible := dedup.Apply(slices.Clone(all))
	// What gets handed back is **this window of the pool**, not just the few caught this round;
	// a failure reading the window still hands back this round's new entries.
	rows, perr := poolWindow(ctx, *deps, ownerID, since, visible)
	if perr != nil {
		slog.WarnContext(ctx, "job pool window not read", "err", perr)
		rows = newRowsOnly(visible)
	}
	return FetchResult{
		Jobs: rows, Failures: failures, Tallies: tallies,
		CrossSourceDropped: len(all) - len(visible),
	}
}
