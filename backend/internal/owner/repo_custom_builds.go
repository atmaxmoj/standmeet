// custom_builds.go —— custom_page_builds CRUD。从 custom_pages.go 拆出来
// 避免单文件超 350 行。
//
// 所有 query 返 sqlc 的 dbq.CustomPageBuild，repo 把它映射成 domain 类型。

package owner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// CustomBuildRepo —— custom_page_builds 表。
type CustomBuildRepo struct {
	pool *pgstore.Pool
}

// NewCustomBuildRepo 构造。
func NewCustomBuildRepo(pool *pgstore.Pool) *CustomBuildRepo { return &CustomBuildRepo{pool: pool} }

// Create —— 落一条 pending build；返 build_id 让 caller poll 状态。
func (r *CustomBuildRepo) Create(
	ctx context.Context, pageID string, sourceFiles map[string]string,
) (CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return CustomPageBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	files, merr := json.Marshal(sourceFiles)
	if merr != nil {
		return CustomPageBuild{}, fmt.Errorf("marshal source files: %w", merr)
	}
	row, err := dbq.New(r.pool).CreateCustomPageBuild(ctx, dbq.CreateCustomPageBuildParams{
		PageID: pgID, SourceFiles: files,
	})
	if err != nil {
		return CustomPageBuild{}, fmt.Errorf("create build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetLatestForPage —— page 最新 build；没有时返 ErrCustomPageBuildNotFound。
func (r *CustomBuildRepo) GetLatestForPage(
	ctx context.Context, pageID string,
) (CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return CustomPageBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := dbq.New(r.pool).GetLatestCustomPageBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CustomPageBuild{}, ErrCustomPageBuildNotFound
		}
		return CustomPageBuild{}, fmt.Errorf("get latest build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetByID —— builder / MCP poll 状态。
func (r *CustomBuildRepo) GetByID(
	ctx context.Context, id string) (CustomPageBuild, error,
) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := dbq.New(r.pool).GetCustomPageBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CustomPageBuild{}, ErrCustomPageBuildNotFound
		}
		return CustomPageBuild{}, fmt.Errorf("get build: %w", err)
	}
	return toDomainBuild(&row)
}

// ClaimPending —— 原子地拿一条 pending build，标 'building' 后返。无 pending
// 时返 ErrCustomPageBuildNotFound 让 caller 翻译 204。
func (r *CustomBuildRepo) ClaimPending(ctx context.Context) (CustomPageBuild, error) {
	// 用 SELECT ... FOR UPDATE SKIP LOCKED + UPDATE 简化版：先 SELECT 一条
	// pending，再 SetBuilding。两次往返但 SKIP LOCKED 让并发安全；builder
	// 只一实例，先这样。
	q := dbq.New(r.pool)
	pending, err := q.ClaimPendingBuild(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CustomPageBuild{}, ErrCustomPageBuildNotFound
		}
		return CustomPageBuild{}, fmt.Errorf("select pending build: %w", err)
	}
	row, err := q.SetCustomPageBuildBuilding(ctx, pending.ID)
	if err != nil {
		return CustomPageBuild{}, fmt.Errorf("mark building: %w", err)
	}
	return toDomainBuild(&row)
}

// MarkBuilt —— builder 跑完 vite 后回标，output_path 是相对路径。
func (r *CustomBuildRepo) MarkBuilt(
	ctx context.Context, id, outputPath string,
) (CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := dbq.New(r.pool).SetCustomPageBuildBuilt(ctx, dbq.SetCustomPageBuildBuiltParams{
		ID: pgID, OutputPath: outputPath,
	})
	if err != nil {
		return CustomPageBuild{}, fmt.Errorf("mark built: %w", err)
	}
	return toDomainBuild(&row)
}

// MarkFailed —— builder 失败回标，error 是 stderr 头 2KB。
func (r *CustomBuildRepo) MarkFailed(
	ctx context.Context, id, errMsg string,
) (CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := dbq.New(r.pool).SetCustomPageBuildFailed(ctx, dbq.SetCustomPageBuildFailedParams{
		ID: pgID, ErrorMessage: errMsg,
	})
	if err != nil {
		return CustomPageBuild{}, fmt.Errorf("mark failed: %w", err)
	}
	return toDomainBuild(&row)
}

func toDomainBuild(row *dbq.CustomPageBuild) (CustomPageBuild, error) {
	build := CustomPageBuild{
		ID:           pgstore.FormatUUID(row.ID),
		PageID:       pgstore.FormatUUID(row.PageID),
		Status:       row.Status,
		OutputPath:   row.OutputPath,
		ErrorMessage: row.ErrorMessage,
		CreatedAt:    row.CreatedAt.Time,
	}
	if row.BuiltAt.Valid {
		t := row.BuiltAt.Time
		build.BuiltAt = &t
	}
	if len(row.SourceFiles) > 0 {
		var files map[string]string
		if err := json.Unmarshal(row.SourceFiles, &files); err != nil {
			return CustomPageBuild{}, fmt.Errorf("unmarshal source files: %w", err)
		}
		build.SourceFiles = files
	}
	return build, nil
}
