// custom_pages.go —— custom_pages + custom_page_builds CRUD。
//
// 所有 query 返 sqlc 统一的 dbq.CustomPage / dbq.CustomPageBuild，repo 把它们
// 映射成 typed domain 类型，让 usecase 不见 pgtype。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// errParsePageID —— fmt 模板常量，对应 page_id 解析失败。
const errParsePageID = "parse page id: %w"

// CustomPageRepo —— custom_pages 表。
type CustomPageRepo struct {
	pool *Pool
}

// NewCustomPageRepo 构造。
func NewCustomPageRepo(pool *Pool) *CustomPageRepo { return &CustomPageRepo{pool: pool} }

// Create —— 落 owner+slug；slug 冲突翻译成 owner.ErrCustomPageSlugTaken。
func (r *CustomPageRepo) Create(
	ctx context.Context, ownerID, slug, title string,
) (owner.CustomPage, error) {
	ownerUUID, perr := parseUUID(ownerID)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := dbq.New(r.pool).CreateCustomPage(ctx, dbq.CreateCustomPageParams{
		OwnerID: ownerUUID, Slug: slug, Title: title,
	})
	if err != nil {
		if name, hit := pgUniqueViolation(err); hit && name == "custom_pages_owner_slug_idx" {
			return owner.CustomPage{}, owner.ErrCustomPageSlugTaken
		}
		return owner.CustomPage{}, fmt.Errorf("create custom page: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// GetBySlug —— owner_id + slug 反查。
func (r *CustomPageRepo) GetBySlug(
	ctx context.Context, ownerID, slug string,
) (owner.CustomPage, error) {
	ownerUUID, perr := parseUUID(ownerID)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := dbq.New(r.pool).GetCustomPageBySlug(ctx, dbq.GetCustomPageBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return owner.CustomPage{}, owner.ErrCustomPageNotFound
		}
		return owner.CustomPage{}, fmt.Errorf("get custom page by slug: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// GetByID —— 通过 page_id 反查。
func (r *CustomPageRepo) GetByID(ctx context.Context, id string) (owner.CustomPage, error) {
	pgID, perr := parseUUID(id)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := dbq.New(r.pool).GetCustomPageByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return owner.CustomPage{}, owner.ErrCustomPageNotFound
		}
		return owner.CustomPage{}, fmt.Errorf("get custom page by id: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// ListByOwner —— owner 的所有 active 页。
func (r *CustomPageRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]owner.CustomPage, error) {
	ownerUUID, perr := parseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	rows, err := dbq.New(r.pool).ListCustomPagesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list custom pages: %w", err)
	}
	out := make([]owner.CustomPage, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainCustomPage(&rows[i]))
	}
	return out, nil
}

// buildRefIDs —— SetLive / SetStaging 共用：把 page id + build id 一次解析成
// pgtype.UUID。用 struct 而非多值返回，让 revive function-result-limit 不抱怨。
type buildRefIDs struct {
	Page  pgtype.UUID
	Build pgtype.UUID
}

func parseBuildRefIDs(pageID, buildID string) (buildRefIDs, error) {
	pageUUID, err := parseUUID(pageID)
	if err != nil {
		return buildRefIDs{}, fmt.Errorf(errParsePageID, err)
	}
	buildUUID, err := parseUUID(buildID)
	if err != nil {
		return buildRefIDs{}, fmt.Errorf("parse build id: %w", err)
	}
	return buildRefIDs{Page: pageUUID, Build: buildUUID}, nil
}

// SetLive —— promote_to_live：当前 live 落到 previous，设新 live。
func (r *CustomPageRepo) SetLive(
	ctx context.Context, pageID, buildID string,
) (owner.CustomPage, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return owner.CustomPage{}, perr
	}
	row, err := dbq.New(r.pool).SetCustomPageLive(ctx, dbq.SetCustomPageLiveParams{
		ID: refs.Page, LiveBuildID: refs.Build,
	})
	if err != nil {
		return owner.CustomPage{}, fmt.Errorf("set live: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// SetStaging —— promote_to_staging。
func (r *CustomPageRepo) SetStaging(
	ctx context.Context, pageID, buildID string,
) (owner.CustomPage, error) {
	refs, perr := parseBuildRefIDs(pageID, buildID)
	if perr != nil {
		return owner.CustomPage{}, perr
	}
	row, err := dbq.New(r.pool).SetCustomPageStaging(ctx, dbq.SetCustomPageStagingParams{
		ID: refs.Page, StagingBuildID: refs.Build,
	})
	if err != nil {
		return owner.CustomPage{}, fmt.Errorf("set staging: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// Rollback —— previous_live_build_id → live；没 previous 时返 ErrCustomPageNotFound。
func (r *CustomPageRepo) Rollback(
	ctx context.Context, pageID string) (owner.CustomPage, error,
) {
	pgID, perr := parseUUID(pageID)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := dbq.New(r.pool).RollbackCustomPageLive(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return owner.CustomPage{}, owner.ErrCustomPageNotFound
		}
		return owner.CustomPage{}, fmt.Errorf("rollback: %w", err)
	}
	return toDomainCustomPage(&row), nil
}

// Delete —— 软删（status='deleted'）。
func (r *CustomPageRepo) Delete(ctx context.Context, pageID string) error {
	pgID, perr := parseUUID(pageID)
	if perr != nil {
		return fmt.Errorf(errParsePageID, perr)
	}
	if err := dbq.New(r.pool).SoftDeleteCustomPage(ctx, pgID); err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	return nil
}

// --- mapping helpers -------------------------------------------------------
//
// custom_page_builds CRUD 在 custom_builds.go；这里只放 page 自己。

func toDomainCustomPage(row *dbq.CustomPage) owner.CustomPage {
	page := owner.CustomPage{
		ID:        formatUUID(row.ID),
		OwnerID:   formatUUID(row.OwnerID),
		Slug:      row.Slug,
		Title:     row.Title,
		Status:    row.Status,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if row.LiveBuildID.Valid {
		s := formatUUID(row.LiveBuildID)
		page.LiveBuildID = &s
	}
	if row.StagingBuildID.Valid {
		s := formatUUID(row.StagingBuildID)
		page.StagingBuildID = &s
	}
	if row.PreviousLiveBuildID.Valid {
		s := formatUUID(row.PreviousLiveBuildID)
		page.PreviousLiveBuildID = &s
	}
	return page
}
