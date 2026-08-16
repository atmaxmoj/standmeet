// corpus.go —— RawRepo + Wiki/Output 共享 helper (loadByPath / UUID utils
// / formatUUIDList)。WikiRepo 在 wiki.go，OutputRepo 在 output.go。
// raw 已折进 corpus_notes(genre='raw'，#151);RawRepo 是它在 inbox 语义上的 CRUD 视图。

package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

const (
	maxPathDepth   = 32 // 防 parent 环路或异常深 tree
	rawTitleMaxLen = 60 // raw 从 body 派生 title 的截断长度(单位:字符)
)

// RawRepo —— corpus_notes(genre='raw')的 inbox CRUD。
type RawRepo struct {
	pool *pgstore.Pool
}

// NewRawRepo 构造 RawRepo。
func NewRawRepo(pool *pgstore.Pool) *RawRepo { return &RawRepo{pool: pool} }

// CreateRawInput 是 Create 入参（避免直接暴露 sqlc params）。
type CreateRawInput struct {
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
}

// Create 写一条新 raw(corpus_notes genre='raw')。pointer 接收避免 hugeParam。
// corpus_notes.title NOT NULL,故从 body 派生一个 title(首非空行截断)。
func (r *RawRepo) Create(ctx context.Context, in *CreateRawInput) (entity.Raw, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	row, err := q.CreateRawEntry(ctx, db.CreateRawEntryParams{
		OwnerID:        ownerUUID,
		Title:          rawTitleFromBody(in.Body),
		Body:           in.Body,
		InboxSource:    in.Source,
		InboxMeta:      []byte(`{}`),
		Tags:           nilSafeTags(in.Tags),
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return entity.Raw{}, fmt.Errorf("create raw: %w", err)
	}
	return toDomainRaw(&row), nil
}

// rawTitleFromBody —— raw 无独立 title,从 body 派生:首非空行 trim 到 <=60 个**字符**,
// 空则 "untitled"。
//
// 按字符切,不是按字节:`line[:60]` 会把第 60 字节处的多字节字符劈开,postgres 收到半个
// 字符就整条拒掉(invalid byte sequence for encoding "UTF8"),而报错里一个字都没提标题。
// 中文一行 21 个字就到 63 字节 —— 对中文 vault 这是常态,不是边角。
func rawTitleFromBody(body string) string {
	for line := range strings.SplitSeq(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return strings.TrimSpace(textcut.RunesMark(line, rawTitleMaxLen))
	}
	return "untitled"
}

// nilSafeTags —— postgres text[] NOT NULL 列拒 NULL；这里把 nil slice 转
// 空 slice（pgx 序列化成 '{}'）。MCP caller 没传 tags 时不该爆。
func nilSafeTags(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// ListByOwner 返回 owner 未 archive 的 raw（最新 N 条）。
func (r *RawRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]entity.Raw, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListRawByOwner(ctx, db.ListRawByOwnerParams{OwnerID: ownerUUID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	out := make([]entity.Raw, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainRaw(&rows[i]))
	}
	return out, nil
}

// Search —— raw 的全文搜（title + body），返 meta + 命中片段;翻页。
//
// wiki / output / subjectivity 早就有这一条,raw **没有** —— 而 raw 恰恰是条数最多、
// 标题多半是自动生成的那一类（这个实例里 450 条）。owner 想找回自己扔进去的某段话时,
// 最需要搜的就是它（F-L-39/41）。底下的 `SearchNotes` 本来就按 genre 参数化,缺的只是这一层。
func (r *RawRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]NoteMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: genreRaw, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search raw: %w", qerr)
	}
	out := make([]NoteMeta, 0, len(rows))
	for i := range rows {
		out = append(out, NoteMeta{
			ID: pgstore.FormatUUID(rows[i].ID), ParentID: pgstore.OptUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, Published: rows[i].Published,
			Snippet: string(rows[i].Snippet), UpdatedAt: rows[i].UpdatedAt.Time.Unix(),
		})
	}
	return out, nil
}

// GetByID 拿 owner 的某条 raw；不命中返回 ErrRawNotFound。
func (r *RawRepo) GetByID(ctx context.Context, ownerID, id string) (entity.Raw, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Raw{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetRawByID(ctx, db.GetRawByIDParams{ID: rawUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Raw{}, entity.ErrRawNotFound
		}
		return entity.Raw{}, fmt.Errorf("get raw: %w", err)
	}
	return toDomainRaw(&row), nil
}

// MarkPromoted 写 corpus_notes(genre='raw').promoted_to。
func (r *RawRepo) MarkPromoted(ctx context.Context, ownerID, rawID, wikiID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(rawID)
	if err != nil {
		return fmt.Errorf("parse raw id: %w", err)
	}
	wikiUUID, err := pgstore.ParseUUID(wikiID)
	if err != nil {
		return fmt.Errorf("parse wiki id: %w", err)
	}
	q := db.New(r.pool)
	if perr := q.MarkRawPromoted(ctx, db.MarkRawPromotedParams{
		ID: rawUUID, OwnerID: ownerUUID, PromotedTo: wikiUUID,
	}); perr != nil {
		return fmt.Errorf("mark raw promoted: %w", perr)
	}
	return nil
}

// path-string lookup(byPathQuery/loadByPath)退役了:地址树派生,不再按 path
// 列反查 entry;cite/寻址走 id(GetByID),公开 landing 走 usecases load 全树算地址。

// toDomainRaw —— corpus_notes(genre='raw')行 → Raw。inbox_source→Source。
func toDomainRaw(r *db.CorpusNote) entity.Raw {
	in := entity.RawInit{
		ID:             pgstore.FormatUUID(r.ID),
		OwnerID:        pgstore.FormatUUID(r.OwnerID),
		Title:          r.Title,
		Body:           r.Body,
		Source:         r.InboxSource,
		Tags:           r.Tags,
		FlaggedPrivate: r.FlaggedPrivate,
		Archived:       r.Archived,
		CreatedAt:      r.CreatedAt.Time,
		Integrations:   connector.NewIntegrations(),
	}
	if r.PromotedTo.Valid {
		s := pgstore.FormatUUID(r.PromotedTo)
		in.PromotedTo = &s
	}
	if r.ParentID.Valid {
		s := pgstore.FormatUUID(r.ParentID)
		in.ParentID = &s
	}
	return entity.NewRaw(&in)
}
