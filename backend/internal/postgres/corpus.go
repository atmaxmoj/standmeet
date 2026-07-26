// corpus.go —— RawRepo + Wiki/Output 共享 helper (loadByPath / UUID utils
// / formatUUIDList)。WikiRepo 在 wiki.go，OutputRepo 在 output.go。
// raw 已折进 corpus_notes(genre='raw'，#151);RawRepo 是它在 inbox 语义上的 CRUD 视图。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

const (
	maxPathDepth          = 32 // 防 parent 环路或异常深 tree
	errParseOwnerIDPrefix = "parse owner id: %w"
	rawTitleMaxLen        = 60 // raw 从 body 派生 title 的截断长度
)

// RawRepo —— corpus_notes(genre='raw')的 inbox CRUD。
type RawRepo struct {
	pool *Pool
}

// NewRawRepo 构造 RawRepo。
func NewRawRepo(pool *Pool) *RawRepo { return &RawRepo{pool: pool} }

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
func (r *RawRepo) Create(ctx context.Context, in *CreateRawInput) (corpus.Raw, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return corpus.Raw{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateRawEntry(ctx, dbq.CreateRawEntryParams{
		OwnerID:        ownerUUID,
		Title:          rawTitleFromBody(in.Body),
		Body:           in.Body,
		InboxSource:    in.Source,
		InboxMeta:      []byte(`{}`),
		Tags:           nilSafeTags(in.Tags),
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return corpus.Raw{}, fmt.Errorf("create raw: %w", err)
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
) ([]corpus.Raw, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListRawByOwner(ctx, dbq.ListRawByOwnerParams{OwnerID: ownerUUID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	out := make([]corpus.Raw, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainRaw(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 raw；不命中返回 ErrRawNotFound。
func (r *RawRepo) GetByID(ctx context.Context, ownerID, id string) (corpus.Raw, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return corpus.Raw{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rawUUID, err := parseUUID(id)
	if err != nil {
		return corpus.Raw{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetRawByID(ctx, dbq.GetRawByIDParams{ID: rawUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpus.Raw{}, corpus.ErrRawNotFound
		}
		return corpus.Raw{}, fmt.Errorf("get raw: %w", err)
	}
	return toDomainRaw(&row), nil
}

// MarkPromoted 写 corpus_notes(genre='raw').promoted_to。
func (r *RawRepo) MarkPromoted(ctx context.Context, ownerID, rawID, wikiID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rawUUID, err := parseUUID(rawID)
	if err != nil {
		return fmt.Errorf("parse raw id: %w", err)
	}
	wikiUUID, err := parseUUID(wikiID)
	if err != nil {
		return fmt.Errorf("parse wiki id: %w", err)
	}
	q := dbq.New(r.pool)
	if perr := q.MarkRawPromoted(ctx, dbq.MarkRawPromotedParams{
		ID: rawUUID, OwnerID: ownerUUID, PromotedTo: wikiUUID,
	}); perr != nil {
		return fmt.Errorf("mark raw promoted: %w", perr)
	}
	return nil
}

// path-string lookup(byPathQuery/loadByPath)退役了:地址树派生,不再按 path
// 列反查 entry;cite/寻址走 id(GetByID),公开 landing 走 usecases load 全树算地址。

func parseOptionalUUID(s *string) (pgtype.UUID, error) {
	if s == nil || *s == "" {
		return pgtype.UUID{}, nil
	}
	return parseUUID(*s)
}

func parseUUIDArray(ids []string) ([]pgtype.UUID, error) {
	out := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		u, err := parseUUID(id)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}

// toDomainRaw —— corpus_notes(genre='raw')行 → corpus.Raw。inbox_source→Source。
func toDomainRaw(r *dbq.CorpusNote) corpus.Raw {
	in := corpus.RawInit{
		ID:             formatUUID(r.ID),
		OwnerID:        formatUUID(r.OwnerID),
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
		s := formatUUID(r.PromotedTo)
		in.PromotedTo = &s
	}
	if r.ParentID.Valid {
		s := formatUUID(r.ParentID)
		in.ParentID = &s
	}
	return corpus.NewRaw(&in)
}

func formatUUIDList(uu []pgtype.UUID) []string {
	out := make([]string, 0, len(uu))
	for _, u := range uu {
		out = append(out, formatUUID(u))
	}
	return out
}
