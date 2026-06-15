// wiki.go —— WikiRepo：wiki_entries 的 CRUD + path induce。
// 跟 OutputRepo 同构（独立 repo 而不是 generic 的原因：sqlc 生成的
// Params / Row 类型各表独立）；path-string lookup 共用 corpus.go 里的
// loadByPath helper。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// WikiRepo —— wiki_entries CRUD + path induce。
type WikiRepo struct {
	pool *Pool
}

// NewWikiRepo 构造 WikiRepo。
func NewWikiRepo(pool *Pool) *WikiRepo { return &WikiRepo{pool: pool} }

// CreateWikiInput 是 Create 入参。
type CreateWikiInput struct {
	OwnerID      string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	SourceRawIDs []string
}

// Create 写一条新 wiki。pointer 接收避免 hugeParam。
func (r *WikiRepo) Create(ctx context.Context, in *CreateWikiInput) (domain.Wiki, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceRaws, err := parseUUIDArray(in.SourceRawIDs)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("parse source raw ids: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateWikiEntry(ctx, dbq.CreateWikiEntryParams{
		OwnerID:      ownerUUID,
		ParentID:     parent,
		Title:        in.Title,
		Body:         in.Body,
		Tags:         nilSafeTags(in.Tags),
		SourceRawIds: sourceRaws,
	})
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("create wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// ListByOwner 返回 owner 的 wiki（最新 N 条）。
func (r *WikiRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]domain.Wiki, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListWikiByOwner(ctx, dbq.ListWikiByOwnerParams{OwnerID: ownerUUID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	out := make([]domain.Wiki, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainWiki(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 wiki；不命中返回 ErrWikiNotFound。
func (r *WikiRepo) GetByID(ctx context.Context, ownerID, id string) (domain.Wiki, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	wikiUUID, err := parseUUID(id)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("parse wiki id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetWikiByID(ctx, dbq.GetWikiByIDParams{ID: wikiUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Wiki{}, domain.ErrWikiNotFound
		}
		return domain.Wiki{}, fmt.Errorf("get wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// WikiMeta —— 一条 wiki 的轻量 meta(**无 body**),给懒加载树导航 / 搜索用。读正文
// 单独走 GetByID。Snippet 只在搜索结果里有值。
type WikiMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	UpdatedAt   int64
	SEOIndexed  bool
	HasChildren bool
}

// ListChildren —— 某节点的直接子(meta,无 body);parentID nil = 根层;limit/offset 翻页。
func (r *WikiRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]WikiMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parentUUID, perr := parseOptionalUUID(parentID)
	if perr != nil {
		return nil, fmt.Errorf("parse parent id: %w", perr)
	}
	rows, qerr := dbq.New(r.pool).ListWikiChildren(ctx, dbq.ListWikiChildrenParams{
		OwnerID: ownerUUID, Column2: parentUUID, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list wiki children: %w", qerr)
	}
	out := make([]WikiMeta, 0, len(rows))
	for i := range rows {
		out = append(out, WikiMeta{
			ID: formatUUID(rows[i].ID), ParentID: optUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, SEOIndexed: rows[i].SeoIndexed, HasChildren: rows[i].HasChildren,
		})
	}
	return out, nil
}

// GetMetaByID —— 一条 wiki 的 meta(无 body):上溯算 path / 判 ACL 用。不命中 → ErrWikiNotFound。
func (r *WikiRepo) GetMetaByID(ctx context.Context, ownerID, id string) (WikiMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return WikiMeta{}, perr
	}
	row, err := dbq.New(r.pool).GetWikiMetaByID(ctx, dbq.GetWikiMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WikiMeta{}, domain.ErrWikiNotFound
		}
		return WikiMeta{}, fmt.Errorf("get wiki meta: %w", err)
	}
	return WikiMeta{
		ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
		Title: row.Title, SEOIndexed: row.SeoIndexed,
	}, nil
}

// Search —— 全量 DB 端关键词搜(full-text);返 meta + snippet(无完整 body);翻页。
func (r *WikiRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]WikiMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).SearchWikiByOwner(ctx, dbq.SearchWikiByOwnerParams{
		OwnerID: ownerUUID, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search wiki: %w", qerr)
	}
	out := make([]WikiMeta, 0, len(rows))
	for i := range rows {
		out = append(out, wikiSearchRowMeta(&rows[i]))
	}
	return out, nil
}

func wikiSearchRowMeta(row *dbq.SearchWikiByOwnerRow) WikiMeta {
	return WikiMeta{
		ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
		Title: row.Title, SEOIndexed: row.SeoIndexed, Snippet: row.Snippet,
	}
}

// WikiStats —— 侧栏脚定位计数(纯聚合,不 load 树)。
type WikiStats struct {
	Entries int
	Roots   int
	Gated   int
}

// CountStats —— owner 的 wiki 总数 / 根数 / 非公开(gated)数。一句 COUNT,零内存。
func (r *WikiRepo) CountStats(ctx context.Context, ownerID string) (WikiStats, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return WikiStats{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).CountWikiStats(ctx, ownerUUID)
	if qerr != nil {
		return WikiStats{}, fmt.Errorf("count wiki stats: %w", qerr)
	}
	return WikiStats{Entries: int(row.Entries), Roots: int(row.Roots), Gated: int(row.Gated)}, nil
}

// ListAllMeta —— 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed + landing
// 的 [[X]] title→path 索引用。不带 newest-N cap。
func (r *WikiRepo) ListAllMeta(ctx context.Context, ownerID string) ([]WikiMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListAllWikiMeta(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list all wiki meta: %w", qerr)
	}
	out := make([]WikiMeta, 0, len(rows))
	for i := range rows {
		out = append(out, WikiMeta{
			ID: formatUUID(rows[i].ID), ParentID: optUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, SEOIndexed: rows[i].SeoIndexed,
			UpdatedAt: rows[i].UpdatedAt.Time.Unix(),
		})
	}
	return out, nil
}

// optUUIDStr —— pgtype.UUID → *string(invalid → nil)。
func optUUIDStr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := formatUUID(u)
	return &s
}

func toDomainWiki(w *dbq.WikiEntry) domain.Wiki {
	in := domain.WikiInit{
		ID:             formatUUID(w.ID),
		OwnerID:        formatUUID(w.OwnerID),
		Title:          w.Title,
		Body:           w.Body,
		Tags:           w.Tags,
		SourceRawIDs:   formatUUIDList(w.SourceRawIds),
		ShowAsSource:   w.ShowAsSource,
		SEODescription: w.SeoDescription,
		SEOIndexed:     w.SeoIndexed,
		CreatedAt:      w.CreatedAt.Time,
		UpdatedAt:      w.UpdatedAt.Time,
		Integrations:   domain.NewIntegrations(),
	}
	if w.ParentID.Valid {
		s := formatUUID(w.ParentID)
		in.ParentID = &s
	}
	return domain.NewWiki(&in)
}
