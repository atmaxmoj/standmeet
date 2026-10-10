// repo_job_seen.go —— the owner's seen ledger (job-loop roadmap 4.1, E8). Boards write it when
// they pool a posting, Job Scout writes it through jobs.record, and every later fetch reads it: a
// posting the ledger holds from an earlier run is not pooled again, from any source.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// JobSeenRepo —— the job_seen and company_marks tables.
type JobSeenRepo struct{ pool *pgstore.Pool }

// NewJobSeenRepo —— the repo over the instance's pool.
func NewJobSeenRepo(pool *pgstore.Pool) *JobSeenRepo { return &JobSeenRepo{pool: pool} }

// seenHit —— the ledger row a posting resolved to, and whether this call wrote it.
type seenHit struct {
	row   db.JobSeen
	fresh bool
}

// Admit —— the postings a fetch may pool: those the ledger does not hold from an earlier run. Each
// one kept carries its ledger row's id. A posting another source saw in this same run is kept: the
// cross-source layer (dedup.Apply) decides between them.
func (r *JobSeenRepo) Admit(
	ctx context.Context, ownerID, run string, jobs []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	q, owner := db.New(r.pool), pgstore.UUIDOrNull(ownerID)
	out := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		hit, err := see(ctx, q, owner, run, &jobs[i])
		if err != nil {
			return nil, err
		}
		if !hit.fresh && hit.row.FirstRun != run {
			continue
		}
		jobs[i].SeenID = pgstore.FormatUUID(hit.row.ID)
		out = append(out, jobs[i])
	}
	return out, nil
}

// Record —— jobs.record: each posting into the ledger, and whether it was new (8.1.a).
func (r *JobSeenRepo) Record(
	ctx context.Context, ownerID, run string, postings []jobsmodel.FetchedJob,
) ([]jobsmodel.Recorded, error) {
	q, owner := db.New(r.pool), pgstore.UUIDOrNull(ownerID)
	out := make([]jobsmodel.Recorded, 0, len(postings))
	for i := range postings {
		hit, err := see(ctx, q, owner, run, &postings[i])
		if err != nil {
			return nil, err
		}
		out = append(out, jobsmodel.Recorded{
			ID: pgstore.FormatUUID(hit.row.ID), New: hit.fresh, Status: hit.row.Status,
			FirstSeenAt: hit.row.FirstSeenAt.Time.UTC(),
		})
	}
	return out, nil
}

// see —— the posting's ledger row: written now when neither key is held, else the one it matches
// (whose last_seen_at moves).
func see(
	ctx context.Context, q *db.Queries, owner pgtype.UUID, run string, j *jobsmodel.FetchedJob,
) (seenHit, error) {
	keys := dedup.Keys(j)
	snap, err := json.Marshal(j)
	if err != nil {
		return seenHit{}, fmt.Errorf("encode posting: %w", err)
	}
	row, err := q.InsertSeen(ctx, db.InsertSeenParams{
		OwnerID: owner, UrlKey: keys[0], CompositeKey: keys[1], FirstRun: run,
		Source: sourceOf(j), Snapshot: snap,
	})
	if err == nil {
		return seenHit{row: row, fresh: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return seenHit{}, fmt.Errorf("ledger insert: %w", err)
	}
	return matched(ctx, q, owner, keys)
}

func matched(
	ctx context.Context, q *db.Queries, owner pgtype.UUID, keys [2]string,
) (seenHit, error) {
	row, err := q.SeenByKeys(ctx, db.SeenByKeysParams{
		OwnerID: owner, UrlKey: keys[0], CompositeKey: keys[1],
	})
	if err != nil {
		return seenHit{}, fmt.Errorf("ledger lookup: %w", err)
	}
	if err = q.TouchSeen(ctx, row.ID); err != nil {
		return seenHit{}, fmt.Errorf("ledger touch: %w", err)
	}
	return seenHit{row: row}, nil
}

// seenStatus —— a status to set; ApplicationID only with applied.
type seenStatus struct {
	Status        string
	ApplicationID string
}

// SetStatus —— a status on the posting's row, by its keys.
func (r *JobSeenRepo) SetStatus(
	ctx context.Context, ownerID string, j *jobsmodel.FetchedJob, s seenStatus,
) error {
	return setStatus(ctx, db.New(r.pool), ownerID, j, s)
}

// markApplied —— the committed posting's row reads applied, with its application (8.4.b).
func markApplied(
	ctx context.Context, q *db.Queries, ownerID string, j *jobsmodel.FetchedJob, appID string,
) error {
	return setStatus(ctx, q, ownerID, j, seenStatus{
		Status: jobsmodel.SeenStatusApplied, ApplicationID: appID,
	})
}

func setStatus(
	ctx context.Context, q *db.Queries, ownerID string, j *jobsmodel.FetchedJob, s seenStatus,
) error {
	keys := dedup.Keys(j)
	err := q.SetSeenStatus(ctx, db.SetSeenStatusParams{
		Status: s.Status, ApplicationID: pgstore.UUIDOrNull(s.ApplicationID),
		OwnerID: pgstore.UUIDOrNull(ownerID), UrlKey: keys[0], CompositeKey: keys[1],
	})
	if err != nil {
		return fmt.Errorf("ledger status: %w", err)
	}
	return nil
}

// Annotate —— merges the assessment into the row's annotations, field by field.
func (r *JobSeenRepo) Annotate(
	ctx context.Context, ownerID, id string, a *jobsmodel.Annotations,
) (jobsmodel.SeenRow, error) {
	blob, err := json.Marshal(a)
	if err != nil {
		return jobsmodel.SeenRow{}, fmt.Errorf("encode annotations: %w", err)
	}
	row, err := db.New(r.pool).AnnotateSeen(ctx, db.AnnotateSeenParams{
		Annotations: blob, ID: pgstore.UUIDOrNull(id), OwnerID: pgstore.UUIDOrNull(ownerID),
	})
	return seenRowOf(&row, notFoundSeen(err))
}

// Get —— one of the owner's ledger rows.
func (r *JobSeenRepo) Get(ctx context.Context, ownerID, id string) (jobsmodel.SeenRow, error) {
	row, err := db.New(r.pool).GetSeen(ctx, db.GetSeenParams{
		ID: pgstore.UUIDOrNull(id), OwnerID: pgstore.UUIDOrNull(ownerID),
	})
	return seenRowOf(&row, notFoundSeen(err))
}

// Page —— one page of the ledger, newest first.
func (r *JobSeenRepo) Page(
	ctx context.Context, ownerID string, f *jobsmodel.SeenFilter, req paging.Request,
) (paging.Page[jobsmodel.SeenRow], error) {
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[jobsmodel.SeenRow]{}, fmt.Errorf("job history: %w", err)
	}
	rows, err := db.New(r.pool).ListSeenPage(ctx, db.ListSeenPageParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), FromAt: optAt(f.From), ToAt: optAt(f.To),
		Status: optText(f.Status), AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if err != nil {
		return paging.Page[jobsmodel.SeenRow]{}, fmt.Errorf("job history: %w", err)
	}
	out := make([]jobsmodel.SeenRow, 0, len(rows))
	for i := range rows {
		s, serr := seenRowOf(&rows[i], nil)
		if serr != nil {
			return paging.Page[jobsmodel.SeenRow]{}, serr
		}
		out = append(out, s)
	}
	return paging.Cut(out, req, func(s *jobsmodel.SeenRow) paging.Cursor {
		return paging.Cursor{At: s.FirstSeenAt, ID: s.ID}
	}), nil
}

func notFoundSeen(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return jobsmodel.ErrSeenNotFound
	}
	if err != nil {
		return fmt.Errorf("job ledger: %w", err)
	}
	return nil
}

// seenRowOf —— the row as the domain reads it; err passes through.
func seenRowOf(row *db.JobSeen, err error) (jobsmodel.SeenRow, error) {
	if err != nil {
		return jobsmodel.SeenRow{}, err
	}
	out := jobsmodel.SeenRow{
		ID: pgstore.FormatUUID(row.ID), Status: row.Status, Source: row.Source,
		FirstSeenAt: row.FirstSeenAt.Time, LastSeenAt: row.LastSeenAt.Time,
	}
	if row.ApplicationID.Valid {
		id := pgstore.FormatUUID(row.ApplicationID)
		out.ApplicationID = &id
	}
	if err = json.Unmarshal(row.Snapshot, &out.Snapshot); err != nil {
		return jobsmodel.SeenRow{}, fmt.Errorf("decode ledger snapshot: %w", err)
	}
	if err = json.Unmarshal(row.Annotations, &out.Annotations); err != nil {
		return jobsmodel.SeenRow{}, fmt.Errorf("decode annotations: %w", err)
	}
	return out, nil
}

func optAt(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()}
}

// sourceOf —— where the ledger says a posting came from: the board's source id, else what Job
// Scout named (linkedin, …).
func sourceOf(j *jobsmodel.FetchedJob) string {
	if j.SourceID != "" {
		return j.SourceID
	}
	return j.SourceKind
}

func optText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
