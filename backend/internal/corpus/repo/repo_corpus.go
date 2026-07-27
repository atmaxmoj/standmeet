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
)

const (
	maxPathDepth   = 32 // 防 parent 环路或异常深 tree
	rawTitleMaxLen = 60 // raw 从 body 派生 title 的截断长度
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

// rawTitleFromBody —— raw 无独立 title,从 body 派生:首非空行 trim 到 <=60 char,空则 "untitled"。
func rawTitleFromBody(body string) string {
	for line := range strings.SplitSeq(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if len(line) > rawTitleMaxLen {
			return strings.TrimSpace(line[:rawTitleMaxLen])
		}
		return line
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
