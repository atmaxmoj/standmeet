// repo_resume_masters.go — CRUD for resume_masters (docs/design/resume-masters.md): named,
// persistent résumés the drafts start from. At most one default per owner: the partial unique
// index enforces it; SetDefault moves it inside one transaction.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// ResumeMasterRepo — the Repository for resume_masters.
type ResumeMasterRepo struct {
	pool *pgstore.Pool
}

// NewResumeMasterRepo constructs a ResumeMasterRepo.
func NewResumeMasterRepo(pool *pgstore.Pool) *ResumeMasterRepo {
	return &ResumeMasterRepo{pool: pool}
}

// MasterPatch — a partial update: a nil field keeps the stored value.
type MasterPatch struct {
	Name        *string
	FromCompany *string
	Content     *jobsmodel.ResumeContent
	OwnerID     string
	MasterID    string
}

// Create — a new, non-default master.
func (r *ResumeMasterRepo) Create(
	ctx context.Context, ownerID, name, fromCompany string, content *jobsmodel.ResumeContent,
) (jobsmodel.ResumeMaster, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	contentJSON, err := json.Marshal(content)
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf("marshal resume content: %w", err)
	}
	row, err := db.New(r.pool).CreateResumeMaster(ctx, db.CreateResumeMasterParams{
		OwnerID: owner, Name: name, ResumeContent: contentJSON, FromCompany: fromCompany,
	})
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf("create resume master: %w", err)
	}
	return toDomainResumeMaster(&row)
}

// Get — by (id, owner_id); a miss (or a malformed id) is ErrResumeMasterNotFound.
func (r *ResumeMasterRepo) Get(
	ctx context.Context, ownerID, id string,
) (jobsmodel.ResumeMaster, error) {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return jobsmodel.ResumeMaster{}, jobsmodel.ErrResumeMasterNotFound
	}
	row, err := db.New(r.pool).GetResumeMaster(ctx, db.GetResumeMasterParams{
		ID: key.draft, OwnerID: key.owner,
	})
	return masterOrNotFound(&row, err)
}

// GetDefault — the owner's default master; none is ErrResumeMasterNotFound.
func (r *ResumeMasterRepo) GetDefault(
	ctx context.Context, ownerID string,
) (jobsmodel.ResumeMaster, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, err := db.New(r.pool).GetDefaultResumeMaster(ctx, owner)
	return masterOrNotFound(&row, err)
}

// Update — rename / replace content / relabel its source, leaving what the patch does not name.
func (r *ResumeMasterRepo) Update(
	ctx context.Context, p *MasterPatch,
) (jobsmodel.ResumeMaster, error) {
	key, err := parseDraftKey(p.OwnerID, p.MasterID)
	if err != nil {
		return jobsmodel.ResumeMaster{}, jobsmodel.ErrResumeMasterNotFound
	}
	var contentJSON []byte // nil = keep the stored content (COALESCE in the SQL)
	if p.Content != nil {
		if contentJSON, err = json.Marshal(p.Content); err != nil {
			return jobsmodel.ResumeMaster{}, fmt.Errorf("marshal resume content: %w", err)
		}
	}
	row, err := db.New(r.pool).UpdateResumeMaster(ctx, db.UpdateResumeMasterParams{
		ID: key.draft, OwnerID: key.owner,
		Name: p.Name, ResumeContent: contentJSON, FromCompany: p.FromCompany,
	})
	return masterOrNotFound(&row, err)
}

// SetDefault — this master becomes the one default; the old default is cleared in the same
// transaction (the partial unique index is checked row by row).
func (r *ResumeMasterRepo) SetDefault(ctx context.Context, ownerID, id string) error {
	if _, err := r.Get(ctx, ownerID, id); err != nil {
		return err
	}
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return err
	}
	if terr := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		return moveDefault(ctx, db.New(tx), key)
	}); terr != nil {
		return fmt.Errorf("set default master: %w", terr)
	}
	return nil
}

// moveDefault — inside one transaction: clear the owner's default, then mark key's master.
func moveDefault(ctx context.Context, q *db.Queries, key draftKey) error {
	if err := q.ClearDefaultResumeMaster(ctx, key.owner); err != nil {
		return fmt.Errorf("clear default master: %w", err)
	}
	if _, err := q.SetDefaultResumeMaster(ctx, db.SetDefaultResumeMasterParams{
		ID: key.draft, OwnerID: key.owner,
	}); err != nil {
		return fmt.Errorf("mark default master: %w", err)
	}
	return nil
}

// ClearDefault — this master stops being the default, if it was.
func (r *ResumeMasterRepo) ClearDefault(ctx context.Context, ownerID, id string) error {
	m, err := r.Get(ctx, ownerID, id)
	if err != nil || !m.IsDefault {
		return err
	}
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if cerr := db.New(r.pool).ClearDefaultResumeMaster(ctx, owner); cerr != nil {
		return fmt.Errorf("clear default master: %w", cerr)
	}
	return nil
}

// wellFormedKey — the key when both ids parse. For an idempotent delete a malformed id is not
// a failure, only an id that names nothing.
func wellFormedKey(ownerID, id string) (draftKey, bool) {
	key, err := parseDraftKey(ownerID, id)
	return key, err == nil
}

// Delete — idempotent (an unknown or already-deleted master succeeds). Drafts based on it keep
// their content and stop naming it (ON DELETE SET NULL).
func (r *ResumeMasterRepo) Delete(ctx context.Context, ownerID, id string) error {
	key, ok := wellFormedKey(ownerID, id)
	if !ok {
		return nil // a malformed id names no master: nothing to delete
	}
	if _, derr := db.New(r.pool).DeleteResumeMaster(ctx, db.DeleteResumeMasterParams{
		ID: key.draft, OwnerID: key.owner,
	}); derr != nil {
		return fmt.Errorf("delete resume master: %w", derr)
	}
	return nil
}

// ListPage — one page of the owner's masters, newest first, with the total across every page.
func (r *ResumeMasterRepo) ListPage(
	ctx context.Context, ownerID string, req paging.Request,
) (paging.Page[jobsmodel.ResumeMaster], error) {
	pk, err := parsePageKey(ownerID, req)
	if err != nil {
		return paging.Page[jobsmodel.ResumeMaster]{}, err
	}
	q := db.New(r.pool)
	rows, err := q.ListResumeMastersPage(ctx, db.ListResumeMastersPageParams{
		OwnerID: pk.owner, AfterAt: pk.after.At, AfterID: pk.after.ID, Lim: req.Fetch(),
	})
	if err != nil {
		return paging.Page[jobsmodel.ResumeMaster]{}, fmt.Errorf("list resume masters: %w", err)
	}
	total, err := q.CountResumeMasters(ctx, pk.owner)
	if err != nil {
		return paging.Page[jobsmodel.ResumeMaster]{}, fmt.Errorf("count resume masters: %w", err)
	}
	page, err := paging.Map(paging.Cut(rows, req, func(m *db.ResumeMaster) paging.Cursor {
		return paging.Cursor{At: m.CreatedAt.Time, ID: pgstore.FormatUUID(m.ID)}
	}), toDomainResumeMaster)
	return page.WithTotal(total), err
}

func masterOrNotFound(row *db.ResumeMaster, err error) (jobsmodel.ResumeMaster, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return jobsmodel.ResumeMaster{}, jobsmodel.ErrResumeMasterNotFound
	}
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf("resume master: %w", err)
	}
	return toDomainResumeMaster(row)
}

func toDomainResumeMaster(row *db.ResumeMaster) (jobsmodel.ResumeMaster, error) {
	var content jobsmodel.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	return jobsmodel.ResumeMaster{
		ID:            pgstore.FormatUUID(row.ID),
		OwnerID:       pgstore.FormatUUID(row.OwnerID),
		Name:          row.Name,
		FromCompany:   row.FromCompany,
		IsDefault:     row.IsDefault,
		ResumeContent: content,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}
