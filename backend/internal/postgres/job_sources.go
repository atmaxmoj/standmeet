// job_sources.go —— job_sources + job_fingerprints CRUD。
// 见 docs/design/job-loop.md。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// JobSourceRepo —— job_sources + job_fingerprints 两张表的 Repository。
type JobSourceRepo struct {
	pool *Pool
}

// NewJobSourceRepo 构造 JobSourceRepo。
func NewJobSourceRepo(pool *Pool) *JobSourceRepo {
	return &JobSourceRepo{pool: pool}
}

// Create —— 注册一条新 job source。in.Config 是已 marshal 好的 JSON bytes
// （usecase 层负责 marshal，让 postgres 层不感知 jsonb 的 Go shape）。
func (r *JobSourceRepo) Create(
	ctx context.Context, in *jobsmodel.CreateJobSourceInput,
) (jobsmodel.JobSource, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	cfg := in.Config
	if len(cfg) == 0 {
		cfg = []byte(`{}`)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateJobSource(ctx, dbq.CreateJobSourceParams{
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

// GetByID —— 按 (id, owner_id) 查一条；未命中 / owner 不匹配返 ErrJobSourceNotFound。
func (r *JobSourceRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.JobSource, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	sourceUUID, err := parseUUID(id)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf("parse source id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetJobSource(ctx, dbq.GetJobSourceParams{
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

// ListByOwner —— admin / MCP list_sources 走这条。
func (r *JobSourceRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.JobSource, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
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

// Delete —— unregister_source；owner 不匹配 → 静默成功（idempotent）。
func (r *JobSourceRepo) Delete(ctx context.Context, ownerID, id string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	sourceUUID, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf("parse source id: %w", err)
	}
	q := dbq.New(r.pool)
	if derr := q.DeleteJobSource(ctx, dbq.DeleteJobSourceParams{
		ID: sourceUUID, OwnerID: ownerUUID,
	}); derr != nil {
		return fmt.Errorf("delete job source: %w", derr)
	}
	return nil
}

// TouchFetched —— fetch_new 跑完后更新 last_fetched_at；调用方负责传 source id。
func (r *JobSourceRepo) TouchFetched(ctx context.Context, sourceID string) error {
	sourceUUID, err := parseUUID(sourceID)
	if err != nil {
		return fmt.Errorf("parse source id: %w", err)
	}
	q := dbq.New(r.pool)
	if terr := q.TouchJobSourceFetched(ctx, sourceUUID); terr != nil {
		return fmt.Errorf("touch fetched: %w", terr)
	}
	return nil
}

// FilterUnseenExternalIDs —— 输入候选 external_id 列表，返回 fingerprint 表
// 里**没见过的**那些。caller 拿来过滤 fetcher 抓回来的 jobs。
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

// RecordSeenExternalIDs —— 把刚返给 owner 的新 job 的 external_id 写进
// fingerprint 表，下次 fetch_new 就 dedup 掉。ON CONFLICT 让并发安全。
func (r *JobSourceRepo) RecordSeenExternalIDs(
	ctx context.Context, sourceID string, externalIDs []string,
) error {
	if len(externalIDs) == 0 {
		return nil
	}
	sourceUUID, err := parseUUID(sourceID)
	if err != nil {
		return fmt.Errorf("parse source id: %w", err)
	}
	q := dbq.New(r.pool)
	for _, eid := range externalIDs {
		if ierr := q.InsertJobFingerprint(ctx, dbq.InsertJobFingerprintParams{
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
	sourceUUID, err := parseUUID(sourceID)
	if err != nil {
		return nil, fmt.Errorf("parse source id: %w", err)
	}
	q := dbq.New(r.pool)
	seen, err := q.GetExistingFingerprints(ctx, dbq.GetExistingFingerprintsParams{
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

// toDomainJobSource —— sqlc Row → jobsmodel.JobSource。Config jsonb 直接 pass
// through 成 []byte，由 fetcher adapter 各自 unmarshal 到 typed struct。
func toDomainJobSource(o *dbq.JobSource) jobsmodel.JobSource {
	out := jobsmodel.JobSource{
		ID:        formatUUID(o.ID),
		OwnerID:   formatUUID(o.OwnerID),
		Kind:      o.Kind,
		Label:     o.Label,
		Config:    o.Config,
		CreatedAt: o.CreatedAt.Time,
	}
	if o.LastFetchedAt.Valid {
		t := o.LastFetchedAt.Time
		out.LastFetchedAt = &t
	}
	return out
}

// Compile-time check that pgtype.UUID / pgtype.Timestamptz still exported the
// methods we use (Valid/Time)—防止 pgx 升级里改字段名静默坏。
var (
	_ pgtype.UUID
	_ pgtype.Timestamptz
)
