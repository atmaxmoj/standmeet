// seo.go — wiki/output landing-page lookups + seo_settings read/write + path field patches.
//
// GetWikiByPath / GetOutputByPath: resolve for a visitor (/<handle>/wiki/<path>); only
//   published=true entries are exposed (the public landing page is the crawler-visible
//   surface — admission for the retrieval path is governed separately by the retrieval ACL).
// ListIndexedPaths: used by /sitemap.xml.
// SEOSettings.Get/Upsert: the owner's own global toggles.
// UpdateWikiPath / UpdateOutputPath: for admin / MCP to change path + SEO description + indexed.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SEORepo — seo_settings queries plus wiki/output landing-page lookups.
type SEORepo struct {
	pool *pgstore.Pool
}

// NewSEORepo constructs one.
func NewSEORepo(pool *pgstore.Pool) *SEORepo { return &SEORepo{pool: pool} }

// The public landing-page lookups and the sitemap listing moved to usecases/seo.go: the
// address is now purely tree-derived (load the full tree → WikiTreePaths/OutputTreePaths)
// and no longer reads the now-retired path column. SEORepo now only handles seo_settings
// read/write plus the path-column patch (patch increment 3 retires with the column).

// GetSettings — one row per owner; returns the default (IndexRobots=true) when missing.
func (r *SEORepo) GetSettings(
	ctx context.Context, ownerID string,
) (entity.SEOSettings, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.SEOSettings{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	row, err := q.GetSEOSettings(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultSEOSettings(ownerID), nil
		}
		return entity.SEOSettings{}, fmt.Errorf("get seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

// UpsertSettings — the write path behind admin PUT /api/admin/seo.
func (r *SEORepo) UpsertSettings(
	ctx context.Context, in *entity.SEOSettings,
) (entity.SEOSettings, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(in.OwnerID)
	if perr != nil {
		return entity.SEOSettings{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	extras, merr := json.Marshal(in.SitemapExtras)
	if merr != nil {
		return entity.SEOSettings{}, fmt.Errorf("marshal sitemap_extras: %w", merr)
	}
	row, err := q.UpsertSEOSettings(ctx, db.UpsertSEOSettingsParams{
		OwnerID:       pgID,
		SiteTitle:     in.SiteTitle,
		IndexRobots:   in.IndexRobots,
		SitemapExtras: extras,
		OgTemplate:    in.OGTemplate,
	})
	if err != nil {
		return entity.SEOSettings{}, fmt.Errorf("upsert seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

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

func defaultSEOSettings(ownerID string) entity.SEOSettings {
	return entity.SEOSettings{
		OwnerID:       ownerID,
		IndexRobots:   true,
		SitemapExtras: []string{},
		OGTemplate:    "",
	}
}

func toDomainSEOSettings(row *db.SeoSetting) (entity.SEOSettings, error) {
	extras := []string{}
	if len(row.SitemapExtras) > 0 {
		if err := json.Unmarshal(row.SitemapExtras, &extras); err != nil {
			return entity.SEOSettings{}, fmt.Errorf("unmarshal sitemap_extras: %w", err)
		}
	}
	_ = pgtype.UUID{} // import keep
	return entity.SEOSettings{
		OwnerID:       pgstore.FormatUUID(row.OwnerID),
		SiteTitle:     row.SiteTitle,
		IndexRobots:   row.IndexRobots,
		SitemapExtras: extras,
		OGTemplate:    row.OgTemplate,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// PublishedCounts — the published-entry count per tier (used by SEO indexing stats).
type PublishedCounts struct {
	Wiki     int64
	Outputs  int64
	Writings int64
}

// CountPublished — the owner's published-entry count per tier. Read directly by the SEO
// panel's stats; scope (which tiers to select / sum) is left to the caller (the owner
// picks in the UI, defaulting to all tiers included).
func (r *SEORepo) CountPublished(ctx context.Context, ownerID string) (PublishedCounts, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return PublishedCounts{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	row, err := db.New(r.pool).CountPublishedCorpus(ctx, pgID)
	if err != nil {
		return PublishedCounts{}, fmt.Errorf("count published corpus: %w", err)
	}
	return PublishedCounts{Wiki: row.Wiki, Outputs: row.Outputs, Writings: row.Writings}, nil
}
