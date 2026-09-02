// custom_builds.go —— custom_page_builds CRUD. Split out of custom_pages.go
// to keep that single file under the 350-line limit.
//
// Every query returns sqlc's db.CustomPageBuild; repo maps it to the domain
// type.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// CustomBuildRepo —— the custom_page_builds table.
type CustomBuildRepo struct {
	pool *pgstore.Pool
}

// NewCustomBuildRepo constructs one.
func NewCustomBuildRepo(pool *pgstore.Pool) *CustomBuildRepo { return &CustomBuildRepo{pool: pool} }

// Create writes a pending build row; returns build_id so the caller can
// poll its status.
func (r *CustomBuildRepo) Create(
	ctx context.Context, pageID string, sourceFiles map[string]string,
) (entity.CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	files, merr := json.Marshal(sourceFiles)
	if merr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("marshal source files: %w", merr)
	}
	row, err := db.New(r.pool).CreateCustomPageBuild(ctx, db.CreateCustomPageBuildParams{
		PageID: pgID, SourceFiles: files,
	})
	if err != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("create build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetLatestForPage —— the page's most recent build; returns
// ErrCustomPageBuildNotFound if there is none.
func (r *CustomBuildRepo) GetLatestForPage(
	ctx context.Context, pageID string,
) (entity.CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetLatestCustomPageBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPageBuild{}, entity.ErrCustomPageBuildNotFound
		}
		return entity.CustomPageBuild{}, fmt.Errorf("get latest build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetLatestBuiltForPage —— this page's **most recent successful build**.
// This is what the owner's preview shows.
//
// Differs from GetLatestForPage by filtering on status: that one can return
// pending / building / failed rows, none of which have output — the owner
// would see a blank page and think the page they wrote is broken.
func (r *CustomBuildRepo) GetLatestBuiltForPage(
	ctx context.Context, pageID string,
) (entity.CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetLatestBuiltCustomPageBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPageBuild{}, entity.ErrCustomPageBuildNotFound
		}
		return entity.CustomPageBuild{}, fmt.Errorf("get latest built build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetByID —— used by the builder / MCP to poll status.
func (r *CustomBuildRepo) GetByID(
	ctx context.Context, id string) (entity.CustomPageBuild, error,
) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).GetCustomPageBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPageBuild{}, entity.ErrCustomPageBuildNotFound
		}
		return entity.CustomPageBuild{}, fmt.Errorf("get build: %w", err)
	}
	return toDomainBuild(&row)
}

// ClaimPending atomically grabs one pending build, marks it 'building', and
// returns it. Returns ErrCustomPageBuildNotFound if there's no pending
// build, so the caller can translate that to 204.
func (r *CustomBuildRepo) ClaimPending(ctx context.Context) (entity.CustomPageBuild, error) {
	// A simplified SELECT ... FOR UPDATE SKIP LOCKED + UPDATE: first SELECT
	// one pending row, then SetBuilding. Two round trips, but SKIP LOCKED
	// keeps it concurrency-safe; the builder only runs one instance for now,
	// so this is fine as-is.
	q := db.New(r.pool)
	pending, err := q.ClaimPendingBuild(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.CustomPageBuild{}, entity.ErrCustomPageBuildNotFound
		}
		return entity.CustomPageBuild{}, fmt.Errorf("select pending build: %w", err)
	}
	row, err := q.SetCustomPageBuildBuilding(ctx, pending.ID)
	if err != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("mark building: %w", err)
	}
	return toDomainBuild(&row)
}

// MarkBuilt —— the builder marks a build done after vite finishes;
// output_path is a relative path.
func (r *CustomBuildRepo) MarkBuilt(
	ctx context.Context, id, outputPath string,
) (entity.CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).SetCustomPageBuildBuilt(ctx, db.SetCustomPageBuildBuiltParams{
		ID: pgID, OutputPath: outputPath,
	})
	if err != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("mark built: %w", err)
	}
	return toDomainBuild(&row)
}

// MarkFailed —— the builder marks a build failed; error is the first 2KB
// of stderr.
func (r *CustomBuildRepo) MarkFailed(
	ctx context.Context, id, errMsg string,
) (entity.CustomPageBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).SetCustomPageBuildFailed(ctx, db.SetCustomPageBuildFailedParams{
		ID: pgID, ErrorMessage: errMsg,
	})
	if err != nil {
		return entity.CustomPageBuild{}, fmt.Errorf("mark failed: %w", err)
	}
	return toDomainBuild(&row)
}

func toDomainBuild(row *db.CustomPageBuild) (entity.CustomPageBuild, error) {
	build := entity.CustomPageBuild{
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
			return entity.CustomPageBuild{}, fmt.Errorf("unmarshal source files: %w", err)
		}
		build.SourceFiles = files
	}
	return build, nil
}
