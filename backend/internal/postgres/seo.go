// seo.go —— wiki/output landing 反查 + seo_settings 读写 + path 字段 patch。
//
// GetWikiByPath / GetOutputByPath: 给访客 (/<handle>/wiki/<path>) 解析；
//   只放 published=true 的（公开 landing 是 crawler 友好可见面，准入靠
//   retrieval ACL 走另一条路）。
// ListIndexedPaths: 给 /sitemap.xml 用。
// SEOSettings.Get/Upsert: owner 自己的全局开关。
// UpdateWikiPath / UpdateOutputPath: 给 admin / MCP 改 path + SEO 描述 + indexed。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// SEORepo —— seo_settings + wiki/output landing 查询。
type SEORepo struct {
	pool *Pool
}

// NewSEORepo 构造。
func NewSEORepo(pool *Pool) *SEORepo { return &SEORepo{pool: pool} }

// 公开 landing 反查 + sitemap 列表已移到 usecases/seo.go：地址纯树派生
// (load 全树 → WikiTreePaths/OutputTreePaths),不再读已退役的 path 列。
// SEORepo 只剩 seo_settings 读写 + path 列 patch（patch 增量 3 随列一起退）。

// GetSettings —— singleton-per-owner；不存在返默认（IndexRobots=true）。
func (r *SEORepo) GetSettings(
	ctx context.Context, ownerID string,
) (corpusdomain.SEOSettings, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return corpusdomain.SEOSettings{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	row, err := q.GetSEOSettings(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultSEOSettings(ownerID), nil
		}
		return corpusdomain.SEOSettings{}, fmt.Errorf("get seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

// UpsertSettings —— admin PUT /api/admin/seo 落地。
func (r *SEORepo) UpsertSettings(
	ctx context.Context, in *corpusdomain.SEOSettings,
) (corpusdomain.SEOSettings, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(in.OwnerID)
	if perr != nil {
		return corpusdomain.SEOSettings{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	extras, merr := json.Marshal(in.SitemapExtras)
	if merr != nil {
		return corpusdomain.SEOSettings{}, fmt.Errorf("marshal sitemap_extras: %w", merr)
	}
	row, err := q.UpsertSEOSettings(ctx, dbq.UpsertSEOSettingsParams{
		OwnerID:       pgID,
		SiteTitle:     in.SiteTitle,
		IndexRobots:   in.IndexRobots,
		SitemapExtras: extras,
		OgTemplate:    in.OGTemplate,
	})
	if err != nil {
		return corpusdomain.SEOSettings{}, fmt.Errorf("upsert seo settings: %w", err)
	}
	return toDomainSEOSettings(&row)
}

// UpdateWikiSEO —— 给 admin / MCP 改 SEO 描述 + indexed 开关。地址树派生,
// owner 不再自设 path,所以没有 path 冲突(ErrPathTaken)这回事。
func (r *SEORepo) UpdateWikiSEO(
	ctx context.Context, ownerID, wikiID, description string, indexed bool,
) (corpusdomain.Wiki, error) {
	pgID, perr := parseUUID(wikiID)
	if perr != nil {
		return corpusdomain.Wiki{}, fmt.Errorf("parse wiki id: %w", perr)
	}
	pgOwner, oerr := parseUUID(ownerID)
	if oerr != nil {
		return corpusdomain.Wiki{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).UpdateNoteSEO(ctx, dbq.UpdateNoteSEOParams{
		ID: pgID, Excerpt: description, Published: indexed, Genre: genreWiki, OwnerID: pgOwner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpusdomain.Wiki{}, corpusdomain.ErrWikiNotFound
		}
		return corpusdomain.Wiki{}, fmt.Errorf("update wiki seo: %w", err)
	}
	return toDomainWiki(&row), nil
}

// UpdateOutputSEO —— 跟 UpdateWikiSEO 同套路。
func (r *SEORepo) UpdateOutputSEO(
	ctx context.Context, ownerID, outputID, description string, indexed bool,
) (corpusdomain.Output, error) {
	pgID, perr := parseUUID(outputID)
	if perr != nil {
		return corpusdomain.Output{}, fmt.Errorf("parse output id: %w", perr)
	}
	pgOwner, oerr := parseUUID(ownerID)
	if oerr != nil {
		return corpusdomain.Output{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).UpdateNoteSEO(ctx, dbq.UpdateNoteSEOParams{
		ID: pgID, Excerpt: description, Published: indexed, Genre: genreOutput, OwnerID: pgOwner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpusdomain.Output{}, corpusdomain.ErrOutputNotFound
		}
		return corpusdomain.Output{}, fmt.Errorf("update output seo: %w", err)
	}
	return toDomainOutput(&row), nil
}

func defaultSEOSettings(ownerID string) corpusdomain.SEOSettings {
	return corpusdomain.SEOSettings{
		OwnerID:       ownerID,
		IndexRobots:   true,
		SitemapExtras: []string{},
		OGTemplate:    "",
	}
}

func toDomainSEOSettings(row *dbq.SeoSetting) (corpusdomain.SEOSettings, error) {
	extras := []string{}
	if len(row.SitemapExtras) > 0 {
		if err := json.Unmarshal(row.SitemapExtras, &extras); err != nil {
			return corpusdomain.SEOSettings{}, fmt.Errorf("unmarshal sitemap_extras: %w", err)
		}
	}
	_ = pgtype.UUID{} // import keep
	return corpusdomain.SEOSettings{
		OwnerID:       formatUUID(row.OwnerID),
		SiteTitle:     row.SiteTitle,
		IndexRobots:   row.IndexRobots,
		SitemapExtras: extras,
		OGTemplate:    row.OgTemplate,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// PublishedCounts —— 各 tier 已公开条目数（SEO indexing stats 用）。
type PublishedCounts struct {
	Wiki     int64
	Outputs  int64
	Writings int64
}

// CountPublished —— owner 各 tier 的 published 条目数。SEO 面 stats 直接读，
// scope（选哪些 tier / 求和）交给调用方（owner 在 UI 选，默认全含）。
func (r *SEORepo) CountPublished(ctx context.Context, ownerID string) (PublishedCounts, error) {
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return PublishedCounts{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	row, err := dbq.New(r.pool).CountPublishedCorpus(ctx, pgID)
	if err != nil {
		return PublishedCounts{}, fmt.Errorf("count published corpus: %w", err)
	}
	return PublishedCounts{Wiki: row.Wiki, Outputs: row.Outputs, Writings: row.Writings}, nil
}
