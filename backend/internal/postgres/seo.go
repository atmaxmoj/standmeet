// seo.go —— wiki/output landing 反查 + seo_settings 读写 + path 字段 patch。
//
// GetWikiByPath / GetOutputByPath: 给访客 (/<handle>/wiki/<path>) 解析；
//   只放 seo_indexed=true 的（公开 landing 是 crawler 友好可见面，准入靠
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

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// SEORepo —— seo_settings + wiki/output landing 查询。
type SEORepo struct {
	pool *Pool
}

// NewSEORepo 构造。
func NewSEORepo(pool *Pool) *SEORepo { return &SEORepo{pool: pool} }

// GetWikiByPath —— 公开 landing 反查；path 不存在或非 indexed 返 ErrWikiNotFound。
func (r *SEORepo) GetWikiByPath(
	ctx context.Context, ownerID, path string,
) (domain.Wiki, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.Wiki{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	row, err := q.GetWikiByPath(ctx, dbq.GetWikiByPathParams{
		OwnerID: pgID, Path: &path,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Wiki{}, domain.ErrWikiNotFound
		}
		return domain.Wiki{}, fmt.Errorf("get wiki by path: %w", err)
	}
	return toDomainWiki(&row), nil
}

// IndexedPath —— sitemap 用的最小行；path + updated_at 拼 URL/lastmod。
type IndexedPath struct {
	Path      string
	UpdatedAt int64 // unix sec
}

// 旧的 GetAnyWikiByPath / GetAnyOutputByPath 删了 —— G-1.5 后 cited 解析
// 走 Corpus facade (corpus_facade.go: getWiki / getOutput → WikiRepo /
// OutputRepo .GetByPath，不过滤 seo_indexed)。SEORepo 只管 landing
// (seo_indexed=true 守门)，命名 / 职责终于对上。

// ListIndexedPaths —— sitemap.xml 列 indexed wiki landing。
func (r *SEORepo) ListIndexedPaths(ctx context.Context, ownerID string) ([]IndexedPath, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	rows, err := q.ListIndexedWikiPaths(ctx, pgID)
	if err != nil {
		return nil, fmt.Errorf("list indexed paths: %w", err)
	}
	out := make([]IndexedPath, 0, len(rows))
	for i := range rows {
		row := rows[i]
		if row.Path == nil {
			continue
		}
		out = append(out, IndexedPath{Path: *row.Path, UpdatedAt: row.UpdatedAt.Time.Unix()})
	}
	return out, nil
}

// GetOutputByPath —— 公开 output landing 反查；同 wiki 的 ErrOutputNotFound 翻译。
func (r *SEORepo) GetOutputByPath(
	ctx context.Context, ownerID, path string,
) (domain.Output, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.Output{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	row, err := q.GetOutputByPath(ctx, dbq.GetOutputByPathParams{
		OwnerID: pgID, Path: &path,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Output{}, domain.ErrOutputNotFound
		}
		return domain.Output{}, fmt.Errorf("get output by path: %w", err)
	}
	return toDomainOutput(&row), nil
}

// ListIndexedOutputPaths —— sitemap.xml 列 indexed output landing。
func (r *SEORepo) ListIndexedOutputPaths(
	ctx context.Context, ownerID string,
) ([]IndexedPath, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, perr)
	}
	rows, err := q.ListIndexedOutputPaths(ctx, pgID)
	if err != nil {
		return nil, fmt.Errorf("list indexed output paths: %w", err)
	}
	out := make([]IndexedPath, 0, len(rows))
	for i := range rows {
		row := rows[i]
		if row.Path == nil {
			continue
		}
		out = append(out, IndexedPath{Path: *row.Path, UpdatedAt: row.UpdatedAt.Time.Unix()})
	}
	return out, nil
}

// GetSettings —— singleton-per-owner；不存在返默认（IndexRobots=true）。
func (r *SEORepo) GetSettings(ctx context.Context, ownerID string) (domain.SEOSettings, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.SEOSettings{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
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
		return domain.SEOSettings{}, fmt.Errorf(errParseOwnerIDPrefix, perr)
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

// UpdateWikiPath —— 给 admin / MCP 改 path + SEO 描述 + indexed 开关。
// path 冲突翻译成 domain.ErrPathTaken。
func (r *SEORepo) UpdateWikiPath(
	ctx context.Context, wikiID string,
	path *string, description string, indexed bool,
) (domain.Wiki, error) {
	pgID, perr := parseUUID(wikiID)
	if perr != nil {
		return domain.Wiki{}, fmt.Errorf("parse wiki id: %w", perr)
	}
	row, err := dbq.New(r.pool).UpdateWikiPath(ctx, dbq.UpdateWikiPathParams{
		ID: pgID, Path: path, SeoDescription: description, SeoIndexed: indexed,
	})
	if err != nil {
		return domain.Wiki{}, translateUpdateWikiPathErr(err)
	}
	return toDomainWiki(&row), nil
}

func translateUpdateWikiPathErr(err error) error {
	if name, hit := pgUniqueViolation(err); hit && name == "wiki_entries_owner_path_idx" {
		return domain.ErrPathTaken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrWikiNotFound
	}
	return fmt.Errorf("update wiki path: %w", err)
}

// UpdateOutputPath —— 跟 UpdateWikiPath 同套路。
func (r *SEORepo) UpdateOutputPath(
	ctx context.Context, outputID string,
	path *string, description string, indexed bool,
) (domain.Output, error) {
	pgID, perr := parseUUID(outputID)
	if perr != nil {
		return domain.Output{}, fmt.Errorf("parse output id: %w", perr)
	}
	row, err := dbq.New(r.pool).UpdateOutputPath(ctx, dbq.UpdateOutputPathParams{
		ID: pgID, Path: path, SeoDescription: description, SeoIndexed: indexed,
	})
	if err != nil {
		return domain.Output{}, translateUpdateOutputPathErr(err)
	}
	return toDomainOutput(&row), nil
}

func translateUpdateOutputPathErr(err error) error {
	if name, hit := pgUniqueViolation(err); hit && name == "output_entries_owner_path_idx" {
		return domain.ErrPathTaken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrOutputNotFound
	}
	return fmt.Errorf("update output path: %w", err)
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
