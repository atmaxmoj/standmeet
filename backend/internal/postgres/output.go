// output.go —— OutputRepo：output_entries 的 CRUD + path induce。
// 跟 WikiRepo 同构（独立 repo 而不是 generic 的原因：sqlc 生成的 Params /
// Row 类型各表独立，硬抽象成 generic 没收益）。

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

// OutputMeta —— output 的 meta(无 body):懒加载搜/读路径用,镜像 WikiMeta。
// UpdatedAt 仅 ListAllMeta(sitemap)填,其余路径留 0。
type OutputMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	UpdatedAt   int64
	SEOIndexed  bool
	HasChildren bool
}

// ListChildren —— output 节点的直接子(meta only,无 body);parentID nil = 根层;翻页。
// 镜像 WikiRepo.ListChildren —— output 跟 wiki 同构,按 path 下钻解析靠它。
func (r *OutputRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]OutputMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]dbq.ListOutputChildrenRow, error) {
			return dbq.New(r.pool).ListOutputChildren(ctx, dbq.ListOutputChildrenParams{
				OwnerID: o, Column2: p, Limit: limit, Offset: offset,
			})
		},
		func(row dbq.ListOutputChildrenRow) OutputMeta {
			return OutputMeta{
				ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
				Title: row.Title, SEOIndexed: row.SeoIndexed, HasChildren: row.HasChildren,
			}
		})
}

// GetMetaByID —— output meta(无 body):上溯算 path / 判 ACL 用。不命中 → ErrOutputNotFound。
func (r *OutputRepo) GetMetaByID(ctx context.Context, ownerID, id string) (OutputMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return OutputMeta{}, perr
	}
	row, err := dbq.New(r.pool).GetOutputMetaByID(ctx, dbq.GetOutputMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OutputMeta{}, domain.ErrOutputNotFound
		}
		return OutputMeta{}, fmt.Errorf("get output meta: %w", err)
	}
	return OutputMeta{
		ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
		Title: row.Title, SEOIndexed: row.SeoIndexed,
	}, nil
}

// Search —— 全量 DB 端关键词搜(full-text);返 meta + snippet(无完整 body);翻页。
func (r *OutputRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]OutputMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).SearchOutputByOwner(ctx, dbq.SearchOutputByOwnerParams{
		OwnerID: ownerUUID, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search output: %w", qerr)
	}
	out := make([]OutputMeta, 0, len(rows))
	for i := range rows {
		out = append(out, outputSearchRowMeta(&rows[i]))
	}
	return out, nil
}

func outputSearchRowMeta(row *dbq.SearchOutputByOwnerRow) OutputMeta {
	return OutputMeta{
		ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
		Title: row.Title, SEOIndexed: row.SeoIndexed, Snippet: row.Snippet,
	}
}

// ListAllMeta —— 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed output 用。
func (r *OutputRepo) ListAllMeta(ctx context.Context, ownerID string) ([]OutputMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListAllOutputMeta(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list all output meta: %w", qerr)
	}
	out := make([]OutputMeta, 0, len(rows))
	for i := range rows {
		out = append(out, OutputMeta{
			ID: formatUUID(rows[i].ID), ParentID: optUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, SEOIndexed: rows[i].SeoIndexed,
			UpdatedAt: rows[i].UpdatedAt.Time.Unix(),
		})
	}
	return out, nil
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
	return domain.NewOutput(&in)
}
