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
