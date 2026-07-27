// wiki.go —— WikiRepo：统一 corpus_notes 表上 genre='wiki' 的 CRUD + path induce。
// 与 OutputRepo 同构（都绑定各自 genre 调用同一套 db.Note* 方法）；path-string lookup
// 共用 corpus.go 里的 loadByPath helper。

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

// WikiRepo —— corpus_notes(genre='wiki') CRUD + path induce。
type WikiRepo struct {
	pool *pgstore.Pool
}

// NewWikiRepo 构造 WikiRepo。
func NewWikiRepo(pool *pgstore.Pool) *WikiRepo { return &WikiRepo{pool: pool} }

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
func (r *WikiRepo) Create(ctx context.Context, in *CreateWikiInput) (entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceRaws, err := pgstore.ParseUUIDArray(in.SourceRawIDs)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse source raw ids: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.CreateNote(ctx, db.CreateNoteParams{
		OwnerID:    ownerUUID,
		Genre:      genreWiki,
		ParentID:   parent,
		Title:      in.Title,
		Body:       in.Body,
		Tags:       nilSafeTags(in.Tags),
		SourceIds:  sourceRaws,
		CssClasses: []string{}, // wiki create 不带 cssclasses(列 NOT NULL,须非 nil)
		// wiki 建出来即是可引用的 source;藏(meta/persona)是之后 UpdateWiki 的
		// 例外路径(applyShowAsSourceIfHidden)。不显式 true 会写零值 false → 被
		// readCollector gate 误当隐藏条,citation 全丢。
		ShowAsSource: true,
	})
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("create wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// ListByOwner 返回 owner 的 wiki（最新 N 条）。
func (r *WikiRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListNotesByOwner(ctx, db.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: genreWiki, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	out := make([]entity.Wiki, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainWiki(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 wiki；不命中返回 ErrWikiNotFound。
func (r *WikiRepo) GetByID(ctx context.Context, ownerID, id string) (entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse wiki id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetNoteByID(ctx, db.GetNoteByIDParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("get wiki: %w", err)
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
	Published   bool
	HasChildren bool
}

// ListChildren —— 某节点的直接子(meta,无 body);parentID nil = 根层;limit/offset 翻页。
func (r *WikiRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]WikiMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenRow, error) {
			return db.New(r.pool).ListNoteChildren(ctx, db.ListNoteChildrenParams{
				OwnerID: o, Genre: genreWiki, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row db.ListNoteChildrenRow) WikiMeta {
			return WikiMeta{
				ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// GetMetaByID —— 一条 wiki 的 meta(无 body):上溯算 path / 判 ACL 用。不命中 → ErrWikiNotFound。
func (r *WikiRepo) GetMetaByID(ctx context.Context, ownerID, id string) (WikiMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return WikiMeta{}, perr
	}
	row, err := db.New(r.pool).GetNoteMetaByID(ctx, db.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: genreWiki,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WikiMeta{}, entity.ErrWikiNotFound
		}
		return WikiMeta{}, fmt.Errorf("get wiki meta: %w", err)
	}
	return WikiMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// Search —— 全量 DB 端关键词搜(full-text);返 meta + snippet(无完整 body);翻页。
func (r *WikiRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]WikiMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: genreWiki, PlaintoTsquery: query, Limit: limit, Offset: offset,
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

func wikiSearchRowMeta(row *db.SearchNotesRow) WikiMeta {
	return WikiMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published, Snippet: row.Snippet,
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
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return WikiStats{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).CountNoteStats(ctx, db.CountNoteStatsParams{
		OwnerID: ownerUUID, Genre: genreWiki,
	})
	if qerr != nil {
		return WikiStats{}, fmt.Errorf("count wiki stats: %w", qerr)
	}
	return WikiStats{Entries: int(row.Entries), Roots: int(row.Roots), Gated: int(row.Gated)}, nil
}

// ListAllMeta —— 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed + landing
// 的 [[X]] title→path 索引用。不带 newest-N cap。
func (r *WikiRepo) ListAllMeta(ctx context.Context, ownerID string) ([]WikiMeta, error) {
	mk := func(row *db.ListAllNoteMetaRow) WikiMeta {
		return WikiMeta{
			ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
			Title: row.Title, Published: row.Published,
			UpdatedAt: row.UpdatedAt.Time.Unix(),
		}
	}
	return listNoteMetaBy(ctx, r.pool, ownerID, genreWiki, mk)
}

func toDomainWiki(w *db.CorpusNote) entity.Wiki {
	in := entity.WikiInit{
		ID:           pgstore.FormatUUID(w.ID),
		OwnerID:      pgstore.FormatUUID(w.OwnerID),
		Title:        w.Title,
		Body:         w.Body,
		Tags:         w.Tags,
		CSSClasses:   w.CssClasses,
		SourceRawIDs: pgstore.FormatUUIDList(w.SourceIds),
		ShowAsSource: w.ShowAsSource,
		Excerpt:      w.Excerpt,
		Published:    w.Published,
		CreatedAt:    w.CreatedAt.Time,
		UpdatedAt:    w.UpdatedAt.Time,
		Integrations: connector.NewIntegrations(),
	}
	if w.ParentID.Valid {
		s := pgstore.FormatUUID(w.ParentID)
		in.ParentID = &s
	}
	return entity.NewWiki(&in)
}
