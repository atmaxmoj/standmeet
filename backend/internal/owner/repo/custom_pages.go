// custom_pages.go —— custom_pages + custom_page_builds CRUD。
//
// 所有 query 返 sqlc 统一的 db.CustomPage / db.CustomPageBuild，repo 把它们
// 映射成 typed domain 类型，让 usecase 不见 pgtype。

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

// errParsePageID —— fmt 模板常量，对应 page_id 解析失败。
const errParsePageID = "parse page id: %w"

// CustomPageRepo —— custom_pages 表。
type CustomPageRepo struct {
	pool *pgstore.Pool
}

// NewCustomPageRepo 构造。
func NewCustomPageRepo(pool *pgstore.Pool) *CustomPageRepo { return &CustomPageRepo{pool: pool} }

// Create —— 落 owner+slug；slug 冲突翻译成 ErrCustomPageSlugTaken。
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

// GetBySlug —— owner_id + slug 反查。
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

// GetByID —— 通过 page_id 反查。
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

// ListByOwner —— owner 的所有 active 页。
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

// listedCustomPage —— 列表那一条比其余多一样：**哪些码开这一页**。
// 它是绑定的另一头 —— 码那一侧看得到页，页这一侧看得到码，一个事实两处读、谁也不存第二份。
func listedCustomPage(row *db.ListCustomPagesByOwnerRow) entity.CustomPage {
	page := toDomainCustomPage(&db.CustomPage{
		ID: row.ID, OwnerID: row.OwnerID, Slug: row.Slug, Title: row.Title,
		Status: row.Status, LiveBuildID: row.LiveBuildID,
		StagingBuildID: row.StagingBuildID, PreviousLiveBuildID: row.PreviousLiveBuildID,
		AllowByoai: row.AllowByoai, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	})
	page.BoundCodes = row.BoundCodes
	return page
}

// buildRefIDs —— SetLive / SetStaging 共用：把 page id + build id 一次解析成
// pgtype.UUID。用 struct 而非多值返回，让 revive function-result-limit 不抱怨。
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

// SetLive —— promote_to_live：当前 live 落到 previous，设新 live。
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

// SetByoai —— 这一页在无人出示 grant 时给不给读者用自己的 key。
// 无行 = 这个 owner 没有这个 slug（或已删）→ ErrCustomPageNotFound，不是静默成功。
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

// SetStaging —— promote_to_staging。
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

// Rollback —— previous_live_build_id → live；没 previous 时返 ErrCustomPageNotFound。
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

// Delete —— 软删（status='deleted'）。
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
// custom_page_builds CRUD 在 custom_builds.go；这里只放 page 自己。

func toDomainCustomPage(row *db.CustomPage) entity.CustomPage {
	page := entity.CustomPage{
		ID:         pgstore.FormatUUID(row.ID),
		OwnerID:    pgstore.FormatUUID(row.OwnerID),
		Slug:       row.Slug,
		Title:      row.Title,
		Status:     row.Status,
		AllowBYOAI: row.AllowByoai,
		CreatedAt:  row.CreatedAt.Time,
		UpdatedAt:  row.UpdatedAt.Time,
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
