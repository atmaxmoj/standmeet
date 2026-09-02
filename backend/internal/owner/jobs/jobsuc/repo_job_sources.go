// job_sources.go — CRUD for job_sources + job_fingerprints.
// See docs/design/job-loop.md.

package jobsuc

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// errParseSourceID — the common wrap prefix for a source id parse failure (same shape
// as pgstore.ErrParseOwnerIDPrefix).
const errParseSourceID = "parse source id: %w"

// JobSourceRepo — the Repository for the two tables job_sources + job_fingerprints.
type JobSourceRepo struct {
	pool *pgstore.Pool
}

// NewJobSourceRepo constructs a JobSourceRepo.
func NewJobSourceRepo(pool *pgstore.Pool) *JobSourceRepo {
	return &JobSourceRepo{pool: pool}
}

// Create — registers a new job source. in.Config is already-marshaled JSON bytes
// (marshaling is the usecase layer's job, so the postgres layer stays unaware of
// jsonb's Go shape).
func (r *JobSourceRepo) Create(
	ctx context.Context, in *jobsmodel.CreateJobSourceInput,
) (jobsmodel.JobSource, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	cfg := in.Config
	if len(cfg) == 0 {
		cfg = []byte(`{}`)
	}
	q := db.New(r.pool)
	row, err := q.CreateJobSource(ctx, db.CreateJobSourceParams{
		OwnerID: ownerUUID,
		Kind:    in.Kind,
		Config:  cfg,
		Label:   in.Label,
	})
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf("create job source: %w", err)
	}
	return toDomainJobSource(&row), nil
}

// GetByID — looks up one row by (id, owner_id); a miss / owner mismatch returns
// ErrJobSourceNotFound.
func (r *JobSourceRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.JobSource, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	sourceUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	row, err := q.GetJobSource(ctx, db.GetJobSourceParams{
		ID: sourceUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jobsmodel.JobSource{}, jobsmodel.ErrJobSourceNotFound
		}
		return jobsmodel.JobSource{}, fmt.Errorf("get job source: %w", err)
	}
	return toDomainJobSource(&row), nil
}

// ListByOwner — the path admin / MCP list_sources goes through.
func (r *JobSourceRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.JobSource, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListJobSourcesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list job sources: %w", err)
	}
	out := make([]jobsmodel.JobSource, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainJobSource(&rows[i]))
	}
	return out, nil
}

// Delete — unregister_source; an owner mismatch -> silent success (idempotent).
func (r *JobSourceRepo) Delete(ctx context.Context, ownerID, id string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	sourceUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	if derr := q.DeleteJobSource(ctx, db.DeleteJobSourceParams{
		ID: sourceUUID, OwnerID: ownerUUID,
	}); derr != nil {
		return fmt.Errorf("delete job source: %w", derr)
	}
	return nil
}

// TouchFetched — updates last_fetched_at after fetch_new finishes; the caller supplies
// the source id.
func (r *JobSourceRepo) TouchFetched(ctx context.Context, sourceID string) error {
	sourceUUID, err := pgstore.ParseUUID(sourceID)
	if err != nil {
		return fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	if terr := q.TouchJobSourceFetched(ctx, sourceUUID); terr != nil {
		return fmt.Errorf("touch fetched: %w", terr)
	}
	return nil
}

// MarkAttempt — writes one row for every fetch attempt, **success or failure**.
// An empty reason string means this attempt succeeded.
//
// Writing only last_fetched_at isn't enough: a source that 400s every time and a source
// that's never been touched would show up as the same `never fetched` line on
// /admin/sources, and that page exists precisely to answer "is this source still alive"
// (F-E-18). The failure detail used to live only in the response of that one MCP call
// the owner made, gone once the window closed.
func (r *JobSourceRepo) MarkAttempt(ctx context.Context, sourceID, reason string) error {
	sourceUUID, err := pgstore.ParseUUID(sourceID)
	if err != nil {
		return fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	if merr := q.MarkJobSourceAttempt(ctx, db.MarkJobSourceAttemptParams{
		ID: sourceUUID, LastError: reason,
	}); merr != nil {
		return fmt.Errorf("mark attempt: %w", merr)
	}
	return nil
}

// FilterUnseenExternalIDs — takes a candidate list of external_ids, returns the ones
// **not yet seen** in the fingerprint table. The caller uses this to filter the jobs
// the fetcher brought back.
func (r *JobSourceRepo) FilterUnseenExternalIDs(
	ctx context.Context, sourceID string, candidates []string,
) ([]string, error) {
	if len(candidates) == 0 {
		return []string{}, nil
	}
	seen, err := r.lookupSeen(ctx, sourceID, candidates)
	if err != nil {
		return []string{}, err
	}
	return diffUnseen(candidates, seen), nil
}

// RecordSeenExternalIDs — writes the external_id of every new job just returned to the
// owner into the fingerprint table, so the next fetch_new dedups it away. ON CONFLICT
// makes this safe under concurrency.
func (r *JobSourceRepo) RecordSeenExternalIDs(
	ctx context.Context, sourceID string, externalIDs []string,
) error {
	if len(externalIDs) == 0 {
		return nil
	}
	sourceUUID, err := pgstore.ParseUUID(sourceID)
	if err != nil {
		return fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	for _, eid := range externalIDs {
		if ierr := q.InsertJobFingerprint(ctx, db.InsertJobFingerprintParams{
			SourceID: sourceUUID, ExternalID: eid,
		}); ierr != nil {
			return fmt.Errorf("insert fingerprint: %w", ierr)
		}
	}
	return nil
}

func (r *JobSourceRepo) lookupSeen(
	ctx context.Context, sourceID string, candidates []string,
) ([]string, error) {
	sourceUUID, err := pgstore.ParseUUID(sourceID)
	if err != nil {
		return nil, fmt.Errorf(errParseSourceID, err)
	}
	q := db.New(r.pool)
	seen, err := q.GetExistingFingerprints(ctx, db.GetExistingFingerprintsParams{
		SourceID: sourceUUID, Column2: candidates,
	})
	if err != nil {
		return nil, fmt.Errorf("get existing fingerprints: %w", err)
	}
	return seen, nil
}

func diffUnseen(candidates, seen []string) []string {
	seenSet := make(map[string]struct{}, len(seen))
	for _, e := range seen {
		seenSet[e] = struct{}{}
	}
	unseen := make([]string, 0, len(candidates)-len(seen))
	for _, c := range candidates {
		if _, ok := seenSet[c]; !ok {
			unseen = append(unseen, c)
		}
	}
	return unseen
}

// toDomainJobSource — sqlc Row -> jobsmodel.JobSource. Config jsonb passes straight
// through as []byte; each fetcher adapter unmarshals it into its own typed struct.
func toDomainJobSource(o *db.JobSource) jobsmodel.JobSource {
	out := jobsmodel.JobSource{
		ID:        pgstore.FormatUUID(o.ID),
		OwnerID:   pgstore.FormatUUID(o.OwnerID),
		Kind:      o.Kind,
		Label:     o.Label,
		Config:    o.Config,
		CreatedAt: o.CreatedAt.Time,
	}
	if o.LastFetchedAt.Valid {
		t := o.LastFetchedAt.Time
		out.LastFetchedAt = &t
	}
	if o.LastAttemptedAt.Valid {
		t := o.LastAttemptedAt.Time
		out.LastAttemptedAt = &t
	}
	out.LastError = o.LastError
	return out
}

// Compile-time check that pgtype.UUID / pgtype.Timestamptz still exported the
// methods we use (Valid/Time) — guards against a pgx upgrade silently breaking this
// by renaming a field.
var (
	_ pgtype.UUID
	_ pgtype.Timestamptz
)
