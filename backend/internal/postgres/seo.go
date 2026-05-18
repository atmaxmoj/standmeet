// seo.go —— wiki landing 反查 + seo_settings 读写 + wiki SEO 字段 patch。
//
// GetWikiBySlug: 给访客 (/wiki/<slug>) 解析；只放 visibility=public 的。
// ListIndexedSlugs: 给 /sitemap.xml 用。
// SEOSettings.Get/Upsert: owner 自己的全局开关。
// UpdateWikiSEO: 给 admin / MCP 用。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// SEORepo —— seo_settings + wiki landing 查询。
type SEORepo struct {
	pool *Pool
}

// NewSEORepo 构造。
func NewSEORepo(pool *Pool) *SEORepo { return &SEORepo{pool: pool} }

// GetWikiBySlug —— 公开 landing 反查。slug 不存在或非 public 都返 ErrWikiNotFound。
func (r *SEORepo) GetWikiBySlug(
	ctx context.Context, ownerID, slug string,
) (domain.WikiEntry, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.WikiEntry{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetWikiBySlug(ctx, dbq.GetWikiBySlugParams{
		OwnerID: pgID, SeoSlug: &slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.WikiEntry{}, domain.ErrWikiNotFound
		}
		return domain.WikiEntry{}, fmt.Errorf("get wiki by slug: %w", err)
	}
	return toDomainWiki(&row), nil
}

// IndexedSlug —— sitemap 用的最小行；slug + updated_at 拼 URL/lastmod。
type IndexedSlug struct {
	Slug      string
	UpdatedAt int64 // unix sec
}

// ListIndexedSlugs —— sitemap.xml 列 indexed + public wiki landing。
func (r *SEORepo) ListIndexedSlugs(ctx context.Context, ownerID string) ([]IndexedSlug, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	rows, err := q.ListIndexedWikiSlugs(ctx, pgID)
	if err != nil {
		return nil, fmt.Errorf("list indexed slugs: %w", err)
	}
	out := make([]IndexedSlug, 0, len(rows))
	for i := range rows {
		row := rows[i]
		if row.SeoSlug == nil {
			continue
		}
		out = append(out, IndexedSlug{Slug: *row.SeoSlug, UpdatedAt: row.UpdatedAt.Time.Unix()})
	}
	return out, nil
}

// GetSettings —— singleton-per-owner；不存在返默认（IndexRobots=true）。
func (r *SEORepo) GetSettings(ctx context.Context, ownerID string) (domain.SEOSettings, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.SEOSettings{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetSEOSettings(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultSEOSettings(ownerID), nil
		}
		return domain.SEOSettings{}, fmt.Errorf("get seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

// UpsertSettings —— admin PUT /api/admin/seo 落地。
func (r *SEORepo) UpsertSettings(
	ctx context.Context, in *domain.SEOSettings,
) (domain.SEOSettings, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(in.OwnerID)
	if perr != nil {
		return domain.SEOSettings{}, fmt.Errorf("parse owner id: %w", perr)
	}
	extras, merr := json.Marshal(in.SitemapExtras)
	if merr != nil {
		return domain.SEOSettings{}, fmt.Errorf("marshal sitemap_extras: %w", merr)
	}
	row, err := q.UpsertSEOSettings(ctx, dbq.UpsertSEOSettingsParams{
		OwnerID:       pgID,
		IndexRobots:   in.IndexRobots,
		SitemapExtras: extras,
		OgTemplate:    in.OGTemplate,
	})
	if err != nil {
		return domain.SEOSettings{}, fmt.Errorf("upsert seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

// UpdateWikiSEO —— 给 admin / MCP 用。slug 冲突翻译成 domain.ErrSlugTaken。
func (r *SEORepo) UpdateWikiSEO(
	ctx context.Context, wikiID string,
	slug *string, description string, indexed bool,
) (domain.WikiEntry, error) {
	pgID, perr := parseUUID(wikiID)
	if perr != nil {
		return domain.WikiEntry{}, fmt.Errorf("parse wiki id: %w", perr)
	}
	row, err := dbq.New(r.pool).UpdateWikiSEO(ctx, dbq.UpdateWikiSEOParams{
		ID: pgID, SeoSlug: slug, SeoDescription: description, SeoIndexed: indexed,
	})
	if err != nil {
		return domain.WikiEntry{}, translateUpdateWikiSEOErr(err)
	}
	return toDomainWiki(&row), nil
}

func translateUpdateWikiSEOErr(err error) error {
	if name, hit := pgUniqueViolation(err); hit && name == "wiki_entries_owner_slug_idx" {
		return domain.ErrSlugTaken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrWikiNotFound
	}
	return fmt.Errorf("update wiki seo: %w", err)
}

func defaultSEOSettings(ownerID string) domain.SEOSettings {
	return domain.SEOSettings{
		OwnerID:       ownerID,
		IndexRobots:   true,
		SitemapExtras: []string{},
		OGTemplate:    "",
	}
}

func toDomainSEOSettings(row *dbq.SeoSetting) (domain.SEOSettings, error) {
	extras := []string{}
	if len(row.SitemapExtras) > 0 {
		if err := json.Unmarshal(row.SitemapExtras, &extras); err != nil {
			return domain.SEOSettings{}, fmt.Errorf("unmarshal sitemap_extras: %w", err)
		}
	}
	_ = pgtype.UUID{} // import keep
	return domain.SEOSettings{
		OwnerID:       formatUUID(row.OwnerID),
		IndexRobots:   row.IndexRobots,
		SitemapExtras: extras,
		OGTemplate:    row.OgTemplate,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}
