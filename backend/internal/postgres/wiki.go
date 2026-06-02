// wiki.go —— WikiRepo：wiki_entries 的 CRUD + path induce。
// 跟 OutputRepo 同构（独立 repo 而不是 generic 的原因：sqlc 生成的
// Params / Row 类型各表独立）；path-string lookup 共用 corpus.go 里的
// loadByPath helper。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

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

// GetByPath —— path-string 寻址 wiki。不过滤 seo_indexed (跟 SEORepo
// .GetWikiByPath 不同——后者是给 public landing 用的需要 indexed=true
// 守门)。retrieval / dialog cited 用 path 反查 entry 走这条。loadByPath
// 通用 helper 在 corpus.go (wiki + output 共享)。
func (r *WikiRepo) GetByPath(ctx context.Context, ownerID, path string) (domain.Wiki, error) {
	var w dbq.WikiEntry
	args := byPathArgs{OwnerID: ownerID, Path: path}
	if err := loadByPath(ctx, r.pool, args, wikiByPathQuery, &w); err != nil {
		return domain.Wiki{}, err
	}
	return toDomainWiki(&w), nil
}

var wikiByPathQuery = byPathQuery[dbq.WikiEntry]{
	SQL: `
		SELECT id, owner_id, parent_id, title, body, tags, source_raw_ids,
		       path, show_as_source, seo_description, seo_indexed,
		       created_at, updated_at
		FROM wiki_entries WHERE owner_id=$1 AND path=$2
	`,
	Scan: func(row pgx.Row, w *dbq.WikiEntry) error {
		if err := row.Scan(&w.ID, &w.OwnerID, &w.ParentID, &w.Title, &w.Body,
			&w.Tags, &w.SourceRawIds, &w.Path, &w.ShowAsSource,
			&w.SeoDescription, &w.SeoIndexed, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return fmt.Errorf("scan wiki: %w", err)
		}
		return nil
	},
	NotFound: domain.ErrWikiNotFound,
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

// ComputePath 走 parent 链 induce 出 path：返回从根到当前 wiki 的 title 列表。
// 防环路 / 异常深 tree：maxPathDepth 截断。
func (r *WikiRepo) ComputePath(ctx context.Context, ownerID, wikiID string) ([]string, error) {
	titles := make([]string, 0, maxPathDepth)
	current := wikiID
	for range maxPathDepth {
		w, err := r.GetByID(ctx, ownerID, current)
		if err != nil {
			return nil, err
		}
		titles = append([]string{w.Title()}, titles...)
		parentID, hasParent := w.ParentID()
		if !hasParent {
			return titles, nil
		}
		current = parentID
	}
	return titles, nil
}

// PathString 是 ComputePath 的字符串形式："/grandparent/parent/me"。
func (r *WikiRepo) PathString(ctx context.Context, ownerID, wikiID string) (string, error) {
	titles, err := r.ComputePath(ctx, ownerID, wikiID)
	if err != nil {
		return "", err
	}
	return "/" + strings.Join(titles, "/"), nil
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
	if w.Path != nil {
		in.Path = w.Path
	}
	return domain.NewWiki(&in)
}
