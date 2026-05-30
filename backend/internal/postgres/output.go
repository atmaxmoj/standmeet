// output.go —— OutputRepo：output_entries 的 CRUD + path induce。
// 跟 WikiRepo 同构（独立 repo 而不是 generic 的原因：sqlc 生成的 Params /
// Row 类型各表独立，硬抽象成 generic 没收益）。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// OutputRepo —— output_entries CRUD + path induce。
type OutputRepo struct {
	pool *Pool
}

// NewOutputRepo 构造 OutputRepo。
func NewOutputRepo(pool *Pool) *OutputRepo { return &OutputRepo{pool: pool} }

// CreateOutputInput —— Create 入参。SourceWikiIDs 记录从哪些 wiki 提炼来。
type CreateOutputInput struct {
	OwnerID       string
	ParentID      *string
	Title         string
	Body          string
	Tags          []string
	SourceWikiIDs []string
}

// Create 写一条新 output。
func (r *OutputRepo) Create(
	ctx context.Context, in *CreateOutputInput,
) (domain.Output, error) {
	params, err := buildOutputCreateParams(in)
	if err != nil {
		return domain.Output{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.CreateOutputEntry(ctx, params)
	if qerr != nil {
		return domain.Output{}, fmt.Errorf("create output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputCreateParams(in *CreateOutputInput) (dbq.CreateOutputEntryParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.CreateOutputEntryParams{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return dbq.CreateOutputEntryParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceWikis, err := parseUUIDArray(in.SourceWikiIDs)
	if err != nil {
		return dbq.CreateOutputEntryParams{}, fmt.Errorf("parse source wiki ids: %w", err)
	}
	return dbq.CreateOutputEntryParams{
		OwnerID:       ownerUUID,
		ParentID:      parent,
		Title:         in.Title,
		Body:          in.Body,
		Tags:          nilSafeTags(in.Tags),
		SourceWikiIds: sourceWikis,
	}, nil
}

// ListByOwner 返回 owner 的 output（最新 N 条）。
func (r *OutputRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]domain.Output, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListOutputByOwner(ctx, dbq.ListOutputByOwnerParams{
		OwnerID: ownerUUID, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	out := make([]domain.Output, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainOutput(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 output；不命中返回 ErrOutputNotFound。
func (r *OutputRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (domain.Output, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.Output{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	outputUUID, err := parseUUID(id)
	if err != nil {
		return domain.Output{}, fmt.Errorf("parse output id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetOutputByID(ctx, dbq.GetOutputByIDParams{ID: outputUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Output{}, domain.ErrOutputNotFound
		}
		return domain.Output{}, fmt.Errorf("get output: %w", err)
	}
	return toDomainOutput(&row), nil
}

// ComputePath 走 parent 链 induce 出 path —— 跟 WikiRepo 同步。
func (r *OutputRepo) ComputePath(
	ctx context.Context, ownerID, outputID string,
) ([]string, error) {
	titles := make([]string, 0, maxPathDepth)
	current := outputID
	for range maxPathDepth {
		o, err := r.GetByID(ctx, ownerID, current)
		if err != nil {
			return nil, err
		}
		titles = append([]string{o.Title()}, titles...)
		parentID, hasParent := o.ParentID()
		if !hasParent {
			return titles, nil
		}
		current = parentID
	}
	return titles, nil
}

// PathString —— "/grandparent/parent/me" 字符串形式。
func (r *OutputRepo) PathString(
	ctx context.Context, ownerID, outputID string,
) (string, error) {
	titles, err := r.ComputePath(ctx, ownerID, outputID)
	if err != nil {
		return "", err
	}
	return "/" + strings.Join(titles, "/"), nil
}

func toDomainOutput(o *dbq.OutputEntry) domain.Output {
	in := domain.OutputInit{
		ID:             formatUUID(o.ID),
		OwnerID:        formatUUID(o.OwnerID),
		Title:          o.Title,
		Body:           o.Body,
		Tags:           o.Tags,
		SourceWikiIDs:  formatUUIDList(o.SourceWikiIds),
		ShowAsSource:   o.ShowAsSource,
		SEODescription: o.SeoDescription,
		SEOIndexed:     o.SeoIndexed,
		CreatedAt:      o.CreatedAt.Time,
		UpdatedAt:      o.UpdatedAt.Time,
		Integrations:   domain.NewIntegrations(),
	}
	if o.ParentID.Valid {
		s := formatUUID(o.ParentID)
		in.ParentID = &s
	}
	if o.Path != nil {
		in.Path = o.Path
	}
	return domain.NewOutput(&in)
}
