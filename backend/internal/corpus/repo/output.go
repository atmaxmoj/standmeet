// output.go —— OutputRepo：统一 corpus_notes 表上 genre='output' 的 CRUD + path induce。
// 与 WikiRepo 同构（都绑定各自 genre 调用同一套 db.Note* 方法）。output 是 raw → wiki →
// output 三层最精炼层，语义上「可原样引用」；source_ids 记从哪些 wiki 提炼来。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// OutputRepo —— corpus_notes(genre='output') CRUD + path induce。
type OutputRepo struct {
	pool *pgstore.Pool
}

// NewOutputRepo 构造 OutputRepo。
func NewOutputRepo(pool *pgstore.Pool) *OutputRepo { return &OutputRepo{pool: pool} }

// CreateOutputInput —— Create 入参。SourceWikiIDs 记录从哪些 wiki 提炼来。
type CreateOutputInput struct {
	OwnerID  string
	Title    string
	Body     string
	ParentID *string
	// ShowAsSource —— nil = 可引用(默认)。见 CreateWikiInput 上同名字段的说明。
	ShowAsSource  *bool
	Tags          []string
	SourceWikiIDs []string
}

// Create 写一条新 output。
func (r *OutputRepo) Create(
	ctx context.Context, in *CreateOutputInput,
) (entity.Output, error) {
	params, err := buildOutputCreateParams(in)
	if err != nil {
		return entity.Output{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.CreateNote(ctx, params)
	if qerr != nil {
		return entity.Output{}, fmt.Errorf("create output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputCreateParams(in *CreateOutputInput) (db.CreateNoteParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceWikis, err := pgstore.ParseUUIDArray(in.SourceWikiIDs)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf("parse source wiki ids: %w", err)
	}
	return db.CreateNoteParams{
		OwnerID:    ownerUUID,
		Genre:      genreOutput,
		ParentID:   parent,
		Title:      in.Title,
		Body:       in.Body,
		Tags:       nilSafeTags(in.Tags),
		SourceIds:  sourceWikis,
		CssClasses: []string{}, // output create 不带 cssclasses(列 NOT NULL,须非 nil)
		// output 同 wiki:建出来即可引用的 source;藏是之后 UpdateOutput 的例外路径。
		// 不显式 true 会写零值 false → 被 readCollector gate 误当隐藏条,citation 全丢。
		ShowAsSource: citableUnlessHidden(in.ShowAsSource),
	}, nil
}

// ListByOwner 返回 owner 的 output（最新 N 条）。
func (r *OutputRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]entity.Output, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListNotesByOwner(ctx, db.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: genreOutput, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	out := make([]entity.Output, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainOutput(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 output；不命中返回 ErrOutputNotFound。
func (r *OutputRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (entity.Output, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Output{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Output{}, fmt.Errorf("parse output id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetNoteByID(ctx, db.GetNoteByIDParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Output{}, entity.ErrOutputNotFound
		}
		return entity.Output{}, fmt.Errorf("get output: %w", err)
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
	Published   bool
	HasChildren bool
}

// ListChildren —— output 节点的直接子(meta only,无 body);parentID nil = 根层;翻页。
// 镜像 WikiRepo.ListChildren —— output 跟 wiki 同构,按 path 下钻解析靠它。
func (r *OutputRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]OutputMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenRow, error) {
			return db.New(r.pool).ListNoteChildren(ctx, db.ListNoteChildrenParams{
				OwnerID: o, Genre: genreOutput, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row db.ListNoteChildrenRow) OutputMeta {
			return OutputMeta{
				ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// GetMetaByID —— output meta(无 body):上溯算 path / 判 ACL 用。不命中 → ErrOutputNotFound。
func (r *OutputRepo) GetMetaByID(ctx context.Context, ownerID, id string) (OutputMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return OutputMeta{}, perr
	}
	row, err := db.New(r.pool).GetNoteMetaByID(ctx, db.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: genreOutput,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OutputMeta{}, entity.ErrOutputNotFound
		}
		return OutputMeta{}, fmt.Errorf("get output meta: %w", err)
	}
	return OutputMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// Search —— 全量 DB 端关键词搜(full-text);返 meta + snippet(无完整 body);翻页。
func (r *OutputRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]OutputMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: genreOutput,
		PlaintoTsquery: query, Limit: limit, Offset: offset,
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

func outputSearchRowMeta(row *db.SearchNotesRow) OutputMeta {
	return OutputMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published, Snippet: string(row.Snippet),
		UpdatedAt: row.UpdatedAt.Time.Unix(),
	}
}

// ListAllMeta —— 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed output 用。
func (r *OutputRepo) ListAllMeta(ctx context.Context, ownerID string) ([]OutputMeta, error) {
	mk := func(row *db.ListAllNoteMetaRow) OutputMeta {
		return OutputMeta{
			ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
			Title: row.Title, Published: row.Published,
			UpdatedAt: row.UpdatedAt.Time.Unix(),
		}
	}
	return listNoteMetaBy(ctx, r.pool, ownerID, genreOutput, mk)
}

func toDomainOutput(o *db.CorpusNote) entity.Output {
	in := entity.OutputInit{
		ID:            pgstore.FormatUUID(o.ID),
		OwnerID:       pgstore.FormatUUID(o.OwnerID),
		Title:         o.Title,
		Body:          o.Body,
		Tags:          o.Tags,
		SourceWikiIDs: pgstore.FormatUUIDList(o.SourceIds),
		ShowAsSource:  o.ShowAsSource,
		Excerpt:       o.Excerpt,
		Published:     o.Published,
		CreatedAt:     o.CreatedAt.Time,
		UpdatedAt:     o.UpdatedAt.Time,
		Integrations:  connector.NewIntegrations(),
	}
	if o.ParentID.Valid {
		s := pgstore.FormatUUID(o.ParentID)
		in.ParentID = &s
	}
	return entity.NewOutput(&in)
}
