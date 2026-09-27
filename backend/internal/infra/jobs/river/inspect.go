// inspect.go — the Inspector: reads river_job directly, mapping River's states onto the panel's.
//
// Mapping: available / scheduled / pending with no recorded error → pending; the same with an
// error, or River's retryable → retryable; a cancel the owner asked for (River stamps
// metadata.cancel_attempted_at) → cancelled; any other cancel is a handler's Discard → discarded.

package river

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

const (
	defaultListLimit = 50
	maxListLimit     = 500
	recentRuns       = 5
)

const stateExpr = `CASE
	WHEN state IN ('available','scheduled','pending')
		AND coalesce(array_length(errors,1),0) = 0 THEN 'pending'
	WHEN state IN ('available','scheduled','pending','retryable') THEN 'retryable'
	WHEN state = 'cancelled' AND metadata ? 'cancel_attempted_at' THEN 'cancelled'
	WHEN state = 'cancelled' THEN 'discarded'
	ELSE state::text END`

const jobCols = `id, kind, queue, (` + stateExpr + `) AS st, attempt, max_attempts, args, errors,
	created_at, scheduled_at, finalized_at`

// jobColNames — the column names jobCols yields, for selecting from a subquery over it.
const jobColNames = `id, kind, queue, st, attempt, max_attempts, args, errors,
	created_at, scheduled_at, finalized_at`

func scanJob(row pgx.Row) (jobs.Job, error) {
	var (
		j      jobs.Job
		state  string
		errs   [][]byte
		id     int64
		finish *time.Time
	)
	if err := row.Scan(&id, &j.Kind, &j.Queue, &state, &j.Attempt, &j.MaxAttempts, &j.Args, &errs,
		&j.CreatedAt, &j.ScheduledAt, &finish); err != nil {
		return jobs.Job{}, err //nolint:wrapcheck // callers wrap with context
	}
	j.ID, j.State, j.FinalizedAt = jobs.JobID(id), jobs.State(state), finish
	j.Errors = make([]jobs.AttemptError, 0, len(errs))
	for _, raw := range errs {
		var e struct {
			At      time.Time `json:"at"`
			Error   string    `json:"error"`
			Attempt int       `json:"attempt"`
		}
		if json.Unmarshal(raw, &e) == nil {
			j.Errors = append(j.Errors,
				jobs.AttemptError{At: e.At, Error: e.Error, Attempt: e.Attempt})
		}
	}
	return j, nil
}

func (r *runtime) Get(ctx context.Context, id jobs.JobID) (jobs.Job, error) {
	j, err := scanJob(r.pool.QueryRow(ctx,
		`SELECT `+jobCols+` FROM river_job WHERE id = $1`, int64(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		return jobs.Job{}, jobs.ErrNotFound
	}
	if err != nil {
		return jobs.Job{}, fmt.Errorf("get job %d: %w", id, err)
	}
	return j, nil
}

func (r *runtime) List(ctx context.Context, f jobs.Filter) ([]jobs.Job, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	limit = min(limit, maxListLimit)
	var args *string // nil → NULL → any args
	if len(f.Args) > 0 {
		s := string(f.Args)
		args = &s
	}
	rows, err := r.pool.Query(ctx, `SELECT `+jobColNames+` FROM (SELECT `+jobCols+` FROM river_job
		WHERE ($1 = '' OR kind = $1) AND ($4::jsonb IS NULL OR args @> $4::jsonb)) j
		WHERE ($2 = '' OR j.st = $2) ORDER BY id DESC LIMIT $3`,
		f.Kind, string(f.State), limit, args)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (jobs.Job, error) {
		return scanJob(row)
	})
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	return out, nil
}

func (r *runtime) Overview(ctx context.Context, kind string) (jobs.Overview, error) {
	ov := jobs.Overview{Counts: map[jobs.State]int{}}
	all := []jobs.State{
		jobs.StatePending, jobs.StateRunning, jobs.StateRetryable,
		jobs.StateCompleted, jobs.StateDiscarded, jobs.StateCancelled,
	}
	for _, s := range all {
		ov.Counts[s] = 0
	}
	if err := r.countStates(ctx, kind, ov.Counts); err != nil {
		return ov, err
	}
	age, err := r.oldestPendingAge(ctx, kind)
	if err != nil {
		return ov, err
	}
	ov.OldestPendingAge = age
	var seen []string
	err = r.pool.QueryRow(ctx, `SELECT pg_total_relation_size('river_job'),
		coalesce(array_agg(DISTINCT kind), '{}') FROM river_job`).
		Scan(&ov.TableBytes, &seen)
	if err != nil {
		return ov, fmt.Errorf("table size: %w", err)
	}
	ov.Kinds = r.kindNames(seen)
	return ov, nil
}

// kindNames —— every declared kind (a fresh instance can filter by one before it ever ran), plus
// any kind still in the table under an old name; sorted.
func (r *runtime) kindNames(seen []string) []string {
	out := slices.Clone(seen)
	for name := range r.kinds {
		out = append(out, name)
	}
	for _, p := range r.periodics {
		out = append(out, jobs.PeriodicKind(p.Name))
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// oldestPendingAge — how long the oldest unfinished job of kind ("" = every kind) has waited;
// 0 when there is none.
func (r *runtime) oldestPendingAge(ctx context.Context, kind string) (time.Duration, error) {
	var oldest *time.Time
	if err := r.pool.QueryRow(ctx, `SELECT min(created_at) FROM river_job
		WHERE state IN ('available','scheduled','pending','retryable') AND ($1 = '' OR kind = $1)`,
		kind).Scan(&oldest); err != nil {
		return 0, fmt.Errorf("oldest pending: %w", err)
	}
	if oldest == nil {
		return 0, nil
	}
	return time.Since(*oldest), nil
}

// countStates — the per-state row counts of kind ("" = every kind) into counts.
func (r *runtime) countStates(ctx context.Context, kind string, counts map[jobs.State]int) error {
	rows, err := r.pool.Query(ctx, `SELECT (`+stateExpr+`) s, count(*) FROM river_job
		WHERE ($1 = '' OR kind = $1) GROUP BY 1`, kind)
	if err != nil {
		return fmt.Errorf("job counts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			s string
			n int
		)
		if serr := rows.Scan(&s, &n); serr != nil {
			return fmt.Errorf("scan counts: %w", serr)
		}
		counts[jobs.State(s)] = n
	}
	return nil
}

func (r *runtime) Retry(ctx context.Context, id jobs.JobID) error {
	if _, err := r.client.JobRetry(ctx, int64(id)); err != nil {
		return fmt.Errorf("retry job %d: %w", id, err)
	}
	return nil
}

func (r *runtime) Cancel(ctx context.Context, id jobs.JobID) error {
	if _, err := r.client.JobCancel(ctx, int64(id)); err != nil {
		return fmt.Errorf("cancel job %d: %w", id, err)
	}
	return nil
}

func (r *runtime) Periodic(ctx context.Context) ([]jobs.PeriodicState, error) {
	out := make([]jobs.PeriodicState, 0, len(r.periodics))
	for _, p := range r.periodics {
		ps, err := r.periodicState(ctx, p)
		if err != nil {
			return nil, err
		}
		out = append(out, ps)
	}
	return out, nil
}

// periodicState — one periodic job's recent runs, newest first.
func (r *runtime) periodicState(ctx context.Context, p jobs.Periodic) (jobs.PeriodicState, error) {
	ps := jobs.PeriodicState{Name: p.Name, Every: p.Every, Recent: []time.Time{}}
	rows, err := r.pool.Query(ctx, `SELECT coalesce(attempted_at, created_at), (`+stateExpr+`),
		coalesce(errors[array_length(errors,1)]->>'error','')
		FROM river_job WHERE kind = $1 AND finalized_at IS NOT NULL ORDER BY id DESC LIMIT $2`,
		jobs.PeriodicKind(p.Name), recentRuns)
	if err != nil {
		return ps, fmt.Errorf("periodic %s: %w", p.Name, err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			at    time.Time
			state string
			msg   string
		)
		if serr := rows.Scan(&at, &state, &msg); serr != nil {
			return ps, fmt.Errorf("scan periodic %s: %w", p.Name, serr)
		}
		if ps.LastRunAt == nil {
			last, next := at, at.Add(p.Every)
			ps.LastRunAt, ps.NextRunAt = &last, &next
			ps.LastResult, ps.LastError = jobs.State(state), msg
		}
		ps.Recent = append(ps.Recent, at)
	}
	return ps, nil
}

func (r *runtime) RunPeriodic(ctx context.Context, name string) error {
	for _, p := range r.periodics {
		if p.Name == name {
			_, err := r.Enqueue(ctx, jobs.PeriodicKind(name), nil, jobs.EnqueueOpts{})
			return err
		}
	}
	return fmt.Errorf("%w: periodic %q", jobs.ErrUnknownKind, name)
}
