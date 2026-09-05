// custom_pages.go —— custom_pages + custom_page_builds CRUD.
//
// Every query returns sqlc's uniform db.CustomPage / db.CustomPageBuild;
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

// CustomPageRepo —— the custom_pages table.
type CustomPageRepo struct {
	pool *pgstore.Pool
}

// NewCustomPageRepo constructs one.
func NewCustomPageRepo(pool *pgstore.Pool) *CustomPageRepo { return &CustomPageRepo{pool: pool} }

// Create writes owner+slug; a slug conflict translates to
// ErrCustomPageSlugTaken.
func (r *CustomPageRepo) Create(
	ctx context.Context, ownerID, slug, title string,
) (entity.CustomPage, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.CustomPage{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).CreateCustomPage(ctx, db.CreateCustomPageParams{
		OwnerID: ownerUUID, Slug: slug, Title: title,
	})
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "custom_pages_owner_slug_idx" {
			return entity.CustomPage{}, entity.ErrCustomPageSlugTaken
		}
		return entity.CustomPage{}, fmt.Errorf("create custom page: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// GetBySlug looks up by owner_id + slug.
func (r *CustomPageRepo) GetBySlug(
	ctx context.Context, ownerID, slug string,
) (entity.CustomPage, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.CustomPage{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).GetCustomPageBySlug(ctx, db.GetCustomPageBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPage{}, entity.ErrCustomPageNotFound
		}
		return entity.CustomPage{}, fmt.Errorf("get custom page by slug: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// GetByID looks up by page_id.
func (r *CustomPageRepo) GetByID(ctx context.Context, id string) (entity.CustomPage, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.CustomPage{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetCustomPageByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPage{}, entity.ErrCustomPageNotFound
		}
		return entity.CustomPage{}, fmt.Errorf("get custom page by id: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// ListByOwner —— all of the owner's active pages.
func (r *CustomPageRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]entity.CustomPage, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	rows, err := db.New(r.pool).ListCustomPagesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list custom pages: %w", err)
	}
	out := make([]entity.CustomPage, 0, len(rows))
	for i := range rows {
		out = append(out, listedCustomPage(&rows[i]))
	}
	return out, nil
}

// listedCustomPage —— a list row carries one thing the rest don't:
// **which codes unlock this page**. It's the other end of the binding —
// codes can see the page, and the page can see its codes; one fact read
// from two sides, and neither side keeps a second copy of it.
func listedCustomPage(row *db.ListCustomPagesByOwnerRow) entity.CustomPage {
	page := toDomainCustomPage(&db.CustomPage{
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
func (r *CustomPageRepo) SetLive(
	ctx context.Context, pageID, buildID string,
) (entity.CustomPage, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return entity.CustomPage{}, perr
	}
	row, err := db.New(r.pool).SetCustomPageLive(ctx, db.SetCustomPageLiveParams{
		ID: refs.Page, LiveBuildID: refs.Build,
	})
	if err != nil {
		return entity.CustomPage{}, fmt.Errorf("set live: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// SetByoai —— whether this page lets a visitor use their own key when no
// grant is presented. No matching row = this owner has no such slug (or it
// was deleted) → ErrCustomPageNotFound, not a silent success.
func (r *CustomPageRepo) SetByoai(
	ctx context.Context, ownerID, slug string, allow bool,
) (entity.CustomPage, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.CustomPage{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).SetCustomPageByoai(ctx, db.SetCustomPageByoaiParams{
		OwnerID: ownerUUID, Slug: slug, AllowByoai: allow,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPage{}, entity.ErrCustomPageNotFound
		}
		return entity.CustomPage{}, fmt.Errorf("set byoai: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// SetStaging —— promote_to_staging.
func (r *CustomPageRepo) SetStaging(
	ctx context.Context, pageID, buildID string,
) (entity.CustomPage, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return entity.CustomPage{}, perr
	}
	row, err := db.New(r.pool).SetCustomPageStaging(ctx, db.SetCustomPageStagingParams{
		ID: refs.Page, StagingBuildID: refs.Build,
	})
	if err != nil {
		return entity.CustomPage{}, fmt.Errorf("set staging: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// Rollback —— previous_live_build_id → live; returns ErrCustomPageNotFound
// if there is no previous build.
func (r *CustomPageRepo) Rollback(
	ctx context.Context, pageID string) (entity.CustomPage, error,
) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.CustomPage{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).RollbackCustomPageLive(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPage{}, entity.ErrCustomPageNotFound
		}
		return entity.CustomPage{}, fmt.Errorf("rollback: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// Delete —— soft delete (status='deleted').
func (r *CustomPageRepo) Delete(ctx context.Context, pageID string) error {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return fmt.Errorf(errParsePageID, perr)
	}
	if err := db.New(r.pool).SoftDeleteCustomPage(ctx, pgID); err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	return nil
}

// --- mapping helpers -------------------------------------------------------
//
// custom_page_builds CRUD lives in custom_builds.go; this file holds only
// the page itself.

func toDomainCustomPage(row *db.CustomPage) entity.CustomPage {
	page := entity.CustomPage{
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
