// microsites.go —— microsites + microsite_builds CRUD.
//
// Every query returns sqlc's uniform db.Microsite / db.MicrositeBuild;
// repo maps them to typed domain types so the usecase layer never sees
// pgtype.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// errParsePageID —— fmt template constant for a page_id parse failure.
const errParsePageID = "parse page id: %w"

// MicrositeRepo —— the microsites table.
type MicrositeRepo struct {
	pool *pgstore.Pool
}

// NewMicrositeRepo constructs one.
func NewMicrositeRepo(pool *pgstore.Pool) *MicrositeRepo { return &MicrositeRepo{pool: pool} }

// Create writes owner+slug; a slug conflict translates to
// ErrMicrositeSlugTaken.
func (r *MicrositeRepo) Create(
	ctx context.Context, ownerID, slug, title string,
) (entity.Microsite, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).CreateMicrosite(ctx, db.CreateMicrositeParams{
		OwnerID: ownerUUID, Slug: slug, Title: title,
	})
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "microsites_owner_slug_idx" {
			return entity.Microsite{}, entity.ErrMicrositeSlugTaken
		}
		return entity.Microsite{}, fmt.Errorf("create custom page: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// GetBySlug looks up by owner_id + slug.
func (r *MicrositeRepo) GetBySlug(
	ctx context.Context, ownerID, slug string,
) (entity.Microsite, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).GetMicrositeBySlug(ctx, db.GetMicrositeBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Microsite{}, entity.ErrMicrositeNotFound
		}
		return entity.Microsite{}, fmt.Errorf("get custom page by slug: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// GetByID looks up by page_id.
func (r *MicrositeRepo) GetByID(ctx context.Context, id string) (entity.Microsite, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetMicrositeByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Microsite{}, entity.ErrMicrositeNotFound
		}
		return entity.Microsite{}, fmt.Errorf("get custom page by id: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// ListByOwner —— all of the owner's active pages.
func (r *MicrositeRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]entity.Microsite, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	rows, err := db.New(r.pool).ListMicrositesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list custom pages: %w", err)
	}
	out := make([]entity.Microsite, 0, len(rows))
	for i := range rows {
		out = append(out, listedMicrosite(&rows[i]))
	}
	return out, nil
}

// listedMicrosite —— a list row carries one thing the rest don't:
// **which codes unlock this page**. It's the other end of the binding —
// codes can see the page, and the page can see its codes; one fact read
// from two sides, and neither side keeps a second copy of it.
func listedMicrosite(row *db.ListMicrositesByOwnerRow) entity.Microsite {
	page := toDomainMicrosite(&db.Microsite{
		ID: row.ID, OwnerID: row.OwnerID, Slug: row.Slug, Title: row.Title,
		Status: row.Status, LiveBuildID: row.LiveBuildID,
		StagingBuildID: row.StagingBuildID, PreviousLiveBuildID: row.PreviousLiveBuildID,
		AllowByoai: row.AllowByoai, StoreWritable: row.StoreWritable,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	})
	page.BoundCodes = row.BoundCodes
	return page
}

// buildRefIDs —— shared by SetLive / SetStaging: parses page id + build id
// into pgtype.UUID in one shot. Uses a struct instead of a multi-value
// return so revive's function-result-limit doesn't complain.
type buildRefIDs struct {
	Page  pgtype.UUID
	Build pgtype.UUID
}

func parseBuildRefIDs(pageID, buildID string) (buildRefIDs, error) {
	pageUUID, err := pgstore.ParseUUID(pageID)
	if err != nil {
		return buildRefIDs{}, fmt.Errorf(errParsePageID, err)
	}
	buildUUID, err := pgstore.ParseUUID(buildID)
	if err != nil {
		return buildRefIDs{}, fmt.Errorf("parse build id: %w", err)
	}
	return buildRefIDs{Page: pageUUID, Build: buildUUID}, nil
}

// SetLive —— promote_to_live: the current live build moves to previous,
// and the new one becomes live.
func (r *MicrositeRepo) SetLive(
	ctx context.Context, pageID, buildID string,
) (entity.Microsite, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return entity.Microsite{}, perr
	}
	row, err := db.New(r.pool).SetMicrositeLive(ctx, db.SetMicrositeLiveParams{
		ID: refs.Page, LiveBuildID: refs.Build,
	})
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("set live: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// SetByoai —— whether this page lets a visitor use their own key when no
// grant is presented. No matching row = this owner has no such slug (or it
// was deleted) → ErrMicrositeNotFound, not a silent success.
func (r *MicrositeRepo) SetByoai(
	ctx context.Context, ownerID, slug string, allow bool,
) (entity.Microsite, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).SetMicrositeByoai(ctx, db.SetMicrositeByoaiParams{
		OwnerID: ownerUUID, Slug: slug, AllowByoai: allow,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Microsite{}, entity.ErrMicrositeNotFound
		}
		return entity.Microsite{}, fmt.Errorf("set byoai: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// SetStaging —— promote_to_staging.
func (r *MicrositeRepo) SetStaging(
	ctx context.Context, pageID, buildID string,
) (entity.Microsite, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return entity.Microsite{}, perr
	}
	row, err := db.New(r.pool).SetMicrositeStaging(ctx, db.SetMicrositeStagingParams{
		ID: refs.Page, StagingBuildID: refs.Build,
	})
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("set staging: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// Rollback —— previous_live_build_id → live; returns ErrMicrositeNotFound
// if there is no previous build.
func (r *MicrositeRepo) Rollback(
	ctx context.Context, pageID string) (entity.Microsite, error,
) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).RollbackMicrositeLive(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Microsite{}, entity.ErrMicrositeNotFound
		}
		return entity.Microsite{}, fmt.Errorf("rollback: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// Delete —— soft delete (status='deleted').
func (r *MicrositeRepo) Delete(ctx context.Context, pageID string) error {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return fmt.Errorf(errParsePageID, perr)
	}
	if err := db.New(r.pool).SoftDeleteMicrosite(ctx, pgID); err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	return nil
}

// --- mapping helpers -------------------------------------------------------
//
// microsite_builds CRUD lives in microsite_builds.go; this file holds only
// the page itself.

func toDomainMicrosite(row *db.Microsite) entity.Microsite {
	page := entity.Microsite{
		ID:         pgstore.FormatUUID(row.ID),
		OwnerID:    pgstore.FormatUUID(row.OwnerID),
		Slug:       row.Slug,
		Title:      row.Title,
		Status:     row.Status,
		AllowBYOAI: row.AllowByoai, StoreWritable: row.StoreWritable,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if row.LiveBuildID.Valid {
		s := pgstore.FormatUUID(row.LiveBuildID)
		page.LiveBuildID = &s
	}
	if row.StagingBuildID.Valid {
		s := pgstore.FormatUUID(row.StagingBuildID)
		page.StagingBuildID = &s
	}
	if row.PreviousLiveBuildID.Valid {
		s := pgstore.FormatUUID(row.PreviousLiveBuildID)
		page.PreviousLiveBuildID = &s
	}
	return page
}
