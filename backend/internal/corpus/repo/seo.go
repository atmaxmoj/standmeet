// seo.go — per-entry publish/SEO patches for wiki/output. The owner-wide SEO settings
// (site_title / robots / og_template) were removed: SEO follows each microsite now, not a global
// settings section. Public landing lookups + the sitemap listing live in usecases/seo.go.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SEORepo — per-entry publish/SEO patches for wiki/output landing pages.
type SEORepo struct {
	pool *pgstore.Pool
}

// NewSEORepo constructs one.
func NewSEORepo(pool *pgstore.Pool) *SEORepo { return &SEORepo{pool: pool} }

// UpdateWikiSEO — for admin / MCP to change the SEO description + indexed toggle. The
// address is tree-derived; the owner no longer sets path directly, so there's no such
// thing as a path conflict (ErrPathTaken) anymore.
func (r *SEORepo) UpdateWikiSEO(
	ctx context.Context, ownerID, wikiID, description string, indexed bool,
) (entity.Wiki, error) {
	pgID, perr := pgstore.ParseUUID(wikiID)
	if perr != nil {
		return entity.Wiki{}, fmt.Errorf("parse wiki id: %w", perr)
	}
	pgOwner, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Wiki{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).UpdateNoteSEO(ctx, db.UpdateNoteSEOParams{
		ID: pgID, Excerpt: description, Published: indexed, Genre: genreWiki, OwnerID: pgOwner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("update wiki seo: %w", err)
	}
	return toDomainWiki(&row), nil
}

// UpdateOutputSEO — follows the same pattern as UpdateWikiSEO.
func (r *SEORepo) UpdateOutputSEO(
	ctx context.Context, ownerID, outputID, description string, indexed bool,
) (entity.Output, error) {
	pgID, perr := pgstore.ParseUUID(outputID)
	if perr != nil {
		return entity.Output{}, fmt.Errorf("parse output id: %w", perr)
	}
	pgOwner, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Output{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).UpdateNoteSEO(ctx, db.UpdateNoteSEOParams{
		ID: pgID, Excerpt: description, Published: indexed, Genre: genreOutput, OwnerID: pgOwner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Output{}, entity.ErrOutputNotFound
		}
		return entity.Output{}, fmt.Errorf("update output seo: %w", err)
	}
	return toDomainOutput(&row), nil
}
