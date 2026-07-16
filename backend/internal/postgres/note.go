// note.go —— NoteRepo：genre-参数化的通用 corpus_notes 仓储。一个实例绑定一个 genre（构造时传入），
// 复用统一的 dbq.Note* query。subjectivity 直接用它（零重复);wiki/output 现有独立 repo 之后可收敛到这里。
//
// 只暴露 tree-note 通用面(建/读/meta/子/搜/改父/删),不含 genre 专属字段（source_ids、covers…）——
// 那些留给各自 genre 的薄封装。地址仍纯树派生（parent 链）。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ErrNoteNotFound —— genre-通用的未命中。
var ErrNoteNotFound = errors.New("note not found")

// NoteRepo —— 绑定单个 genre 的通用笔记仓储。
type NoteRepo struct {
	pool  *Pool
	genre string
}

// NewNoteRepo 构造绑定给定 genre 的 NoteRepo。
func NewNoteRepo(pool *Pool, genre string) *NoteRepo { return &NoteRepo{pool: pool, genre: genre} }

// Genre 返回本 repo 绑定的 genre。
func (r *NoteRepo) Genre() string { return r.genre }

// Note —— 一条笔记的通用视图（无 genre 专属字段）。ShowAsSource 决定是否进 visitor cited
// footer（subjectivity 默认 false = 私有；wiki/output 默认 true）。
type Note struct {
	ParentID     *string
	ID           string
	OwnerID      string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
}

// NoteMeta —— 无 body 的轻量 meta（树导航 / 搜索 / 算 path 用）。Snippet 仅搜索结果有值。
type NoteMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	Published   bool
	HasChildren bool
}

// CreateNoteInput —— 建一条笔记。ShowAsSource：是否进 visitor cited footer。subjectivity
// 建笔记默认传 false（私有）；调用方显式给。
type CreateNoteInput struct {
	OwnerID      string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// Create 写一条新笔记（本 repo 的 genre）。
func (r *NoteRepo) Create(ctx context.Context, in *CreateNoteInput) (Note, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return Note{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return Note{}, fmt.Errorf("parse parent id: %w", err)
	}
	row, err := dbq.New(r.pool).CreateNote(ctx, dbq.CreateNoteParams{
		OwnerID: ownerUUID, Genre: r.genre, ParentID: parent,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		CssClasses: nilSafeTags(in.CSSClasses), ShowAsSource: in.ShowAsSource,
		// tree-note genres (subjectivity) carry no upstream source ids; empty (non-nil) → '{}'.
		SourceIds: []pgtype.UUID{},
	})
	if err != nil {
		return Note{}, fmt.Errorf("create note: %w", err)
	}
	return noteFromRow(&row), nil
}

// UpdateBody 改一条笔记的 title/body/tags/parent（同 wiki 的 edit 入口）。
func (r *NoteRepo) UpdateBody(ctx context.Context, in *UpdateNoteInput) (Note, error) {
	ids, perr := parseSrcAndOwner(in.ID, in.OwnerID)
	if perr != nil {
		return Note{}, perr
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return Note{}, fmt.Errorf("parse parent id: %w", err)
	}
	row, qerr := dbq.New(r.pool).UpdateNoteBody(ctx, dbq.UpdateNoteBodyParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: nilSafeTags(in.CSSClasses),
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Note{}, ErrNoteNotFound
		}
		return Note{}, fmt.Errorf("update note: %w", qerr)
	}
	return noteFromRow(&row), nil
}

// UpdateNoteInput —— 改一条笔记。ShowAsSource：opt-in/out visitor cited footer（toggle 走这里）。
type UpdateNoteInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// GetByID 拿本 genre 的某条笔记；不命中 → ErrNoteNotFound。
func (r *NoteRepo) GetByID(ctx context.Context, ownerID, id string) (Note, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return Note{}, perr
	}
	row, err := dbq.New(r.pool).GetNoteByID(ctx, dbq.GetNoteByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Note{}, ErrNoteNotFound
		}
		return Note{}, fmt.Errorf("get note: %w", err)
	}
	return noteFromRow(&row), nil
}

// GetMetaByID —— meta（无 body）：算 path / 判 ACL 用。不命中 → ErrNoteNotFound。
func (r *NoteRepo) GetMetaByID(ctx context.Context, ownerID, id string) (NoteMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return NoteMeta{}, perr
	}
	row, err := dbq.New(r.pool).GetNoteMetaByID(ctx, dbq.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return NoteMeta{}, ErrNoteNotFound
		}
		return NoteMeta{}, fmt.Errorf("get note meta: %w", err)
	}
	return NoteMeta{
		ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// ListByOwner 返回 owner 本 genre 的笔记（最新 N 条）—— 满足 lister 接口。
func (r *NoteRepo) ListByOwner(ctx context.Context, ownerID string, limit int32) ([]Note, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListNotesByOwner(ctx, dbq.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: r.genre, Limit: limit,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list notes: %w", qerr)
	}
	out := make([]Note, 0, len(rows))
	for i := range rows {
		out = append(out, noteFromRow(&rows[i]))
	}
	return out, nil
}

// ListChildren —— 某节点直接子（meta，无 body）;parentID nil = 根层;翻页。
func (r *NoteRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]NoteMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]dbq.ListNoteChildrenRow, error) {
			return dbq.New(r.pool).ListNoteChildren(ctx, dbq.ListNoteChildrenParams{
				OwnerID: o, Genre: r.genre, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row dbq.ListNoteChildrenRow) NoteMeta {
			return NoteMeta{
				ID: formatUUID(row.ID), ParentID: optUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// Search —— 全量 DB 端关键词搜（full-text），返 meta + snippet;翻页。
func (r *NoteRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]NoteMeta, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).SearchNotes(ctx, dbq.SearchNotesParams{
		OwnerID: ownerUUID, Genre: r.genre, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search notes: %w", qerr)
	}
	out := make([]NoteMeta, 0, len(rows))
	for i := range rows {
		out = append(out, NoteMeta{
			ID: formatUUID(rows[i].ID), ParentID: optUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, Published: rows[i].Published, Snippet: rows[i].Snippet,
		})
	}
	return out, nil
}

// Delete 硬删一条笔记（子孙经 FK 级联）。
func (r *NoteRepo) Delete(ctx context.Context, ownerID, id string) error {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return perr
	}
	if derr := dbq.New(r.pool).DeleteNote(ctx, dbq.DeleteNoteParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	}); derr != nil {
		return fmt.Errorf("delete note: %w", derr)
	}
	return nil
}

func noteFromRow(n *dbq.CorpusNote) Note {
	out := Note{
		ID: formatUUID(n.ID), OwnerID: formatUUID(n.OwnerID),
		Title: n.Title, Body: n.Body, Tags: n.Tags, ShowAsSource: n.ShowAsSource,
	}
	if n.ParentID.Valid {
		s := formatUUID(n.ParentID)
		out.ParentID = &s
	}
	return out
}
