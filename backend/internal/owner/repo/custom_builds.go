// microsite_builds.go —— microsite_builds CRUD. Split out of microsites.go
// to keep that single file under the 350-line limit.
//
// Every query returns sqlc's db.MicrositeBuild; repo maps it to the domain
// type.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// MicrositeBuildRepo —— the microsite_builds table.
type MicrositeBuildRepo struct {
	pool *pgstore.Pool
}

// NewMicrositeBuildRepo constructs one.
func NewMicrositeBuildRepo(pool *pgstore.Pool) *MicrositeBuildRepo {
	return &MicrositeBuildRepo{pool: pool}
}

// Create writes a pending build row; returns build_id so the caller can
// poll its status.
func (r *MicrositeBuildRepo) Create(
	ctx context.Context, pageID string, sourceFiles map[string]string,
) (entity.MicrositeBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	files, merr := json.Marshal(sourceFiles)
	if merr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("marshal source files: %w", merr)
	}
	row, err := db.New(r.pool).CreateMicrositeBuild(ctx, db.CreateMicrositeBuildParams{
		PageID: pgID, SourceFiles: files,
	})
	if err != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("create build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetLatestForPage —— the page's most recent build; returns
// ErrMicrositeBuildNotFound if there is none.
func (r *MicrositeBuildRepo) GetLatestForPage(
	ctx context.Context, pageID string,
) (entity.MicrositeBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetLatestMicrositeBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("get latest build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetLatestBuiltForPage —— this page's **most recent successful build**.
// This is what the owner's preview shows.
//
// Differs from GetLatestForPage by filtering on status: that one can return
// pending / building / failed rows, none of which have output — the owner
// would see a blank page and think the page they wrote is broken.
func (r *MicrositeBuildRepo) GetLatestBuiltForPage(
	ctx context.Context, pageID string,
) (entity.MicrositeBuild, error) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetLatestBuiltMicrositeBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("get latest built build: %w", err)
	}
	return toDomainBuild(&row)
}

// GetByID —— used by the builder / MCP to poll status.
func (r *MicrositeBuildRepo) GetByID(
	ctx context.Context, id string) (entity.MicrositeBuild, error,
) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).GetMicrositeBuild(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("get build: %w", err)
	}
	return toDomainBuild(&row)
}

// ClaimPending atomically takes one claimable build — pending, or `building` whose lease is older
// than `lease` (its builder is gone) — marks it 'building' and starts its lease. One statement, so
// two builders never take the same row. Returns ErrMicrositeBuildNotFound when there is nothing to
// take, so the caller can translate that to 204.
func (r *MicrositeBuildRepo) ClaimPending(
	ctx context.Context, lease time.Duration,
) (entity.MicrositeBuild, error) {
	row, err := db.New(r.pool).ClaimBuild(ctx, lease.Seconds())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("claim build: %w", err)
	}
	return toDomainBuild(&row)
}

// RenewLease —— the builder is still working on this build. ErrMicrositeBuildNotFound = it is no
// longer `building` (settled, or the row is gone), so the builder's work on it is moot.
func (r *MicrositeBuildRepo) RenewLease(ctx context.Context, id string) error {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return fmt.Errorf("parse build id: %w", perr)
	}
	n, err := db.New(r.pool).RenewBuildLease(ctx, pgID)
	if err != nil {
		return fmt.Errorf("renew build lease: %w", err)
	}
	if n == 0 {
		return entity.ErrMicrositeBuildNotFound
	}
	return nil
}

// MarkBuilt —— the builder marks a build done after vite finishes;
// output_path is a relative path.
func (r *MicrositeBuildRepo) MarkBuilt(
	ctx context.Context, id, outputPath string,
) (entity.MicrositeBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).SetMicrositeBuildBuilt(ctx, db.SetMicrositeBuildBuiltParams{
		ID: pgID, OutputPath: outputPath,
	})
	if err != nil {
		// 0 rows = the build's row is gone (page/owner deleted, or a reset truncated it, while vite
		// ran). That is "superseded / gone", not a server fault — surface the sentinel so the route
		// answers 404 instead of 500 (the builder then skips, rather than throwing).
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("mark built: %w", err)
	}
	return toDomainBuild(&row)
}

// MarkFailed —— the builder marks a build failed; error is the first 2KB
// of stderr.
func (r *MicrositeBuildRepo) MarkFailed(
	ctx context.Context, id, errMsg string,
) (entity.MicrositeBuild, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("parse build id: %w", perr)
	}
	row, err := db.New(r.pool).SetMicrositeBuildFailed(ctx, db.SetMicrositeBuildFailedParams{
		ID: pgID, ErrorMessage: errMsg,
	})
	if err != nil {
		// Same as MarkBuilt: 0 rows = the build's row is gone → the sentinel, so the route 404s.
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MicrositeBuild{}, entity.ErrMicrositeBuildNotFound
		}
		return entity.MicrositeBuild{}, fmt.Errorf("mark failed: %w", err)
	}
	return toDomainBuild(&row)
}

func toDomainBuild(row *db.MicrositeBuild) (entity.MicrositeBuild, error) {
	build := entity.MicrositeBuild{
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
			return entity.MicrositeBuild{}, fmt.Errorf("unmarshal source files: %w", err)
		}
		build.SourceFiles = files
	}
	return build, nil
}
