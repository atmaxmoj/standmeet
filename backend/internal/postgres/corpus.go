// corpus.go —— Raw + Wiki repository。Media（admin upload）后续再加。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

const (
	maxPathDepth          = 32 // 防 parent 环路或异常深 tree
	errParseOwnerIDPrefix = "parse owner id: %w"
)

// RawRepo —— raw_entries CRUD。
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

// Create 写一条新 raw。pointer 接收避免 hugeParam。
func (r *RawRepo) Create(ctx context.Context, in *CreateRawInput) (domain.RawEntry, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.RawEntry{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateRawEntry(ctx, dbq.CreateRawEntryParams{
		OwnerID:        ownerUUID,
		Body:           in.Body,
		Source:         in.Source,
		SourceMeta:     []byte(`{}`),
		Tags:           nilSafeTags(in.Tags),
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return domain.RawEntry{}, fmt.Errorf("create raw: %w", err)
	}
	return toDomainRaw(&row), nil
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
) ([]domain.RawEntry, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListRawByOwner(ctx, dbq.ListRawByOwnerParams{OwnerID: ownerUUID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	out := make([]domain.RawEntry, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainRaw(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 raw；不命中返回 ErrRawNotFound。
func (r *RawRepo) GetByID(ctx context.Context, ownerID, id string) (domain.RawEntry, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.RawEntry{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rawUUID, err := parseUUID(id)
	if err != nil {
		return domain.RawEntry{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetRawByID(ctx, dbq.GetRawByIDParams{ID: rawUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.RawEntry{}, domain.ErrRawNotFound
		}
		return domain.RawEntry{}, fmt.Errorf("get raw: %w", err)
	}
	return toDomainRaw(&row), nil
}

// MarkPromoted 写 raw_entries.promoted_to。
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
func (r *WikiRepo) Create(ctx context.Context, in *CreateWikiInput) (domain.WikiEntry, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceRaws, err := parseUUIDArray(in.SourceRawIDs)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf("parse source raw ids: %w", err)
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
		return domain.WikiEntry{}, fmt.Errorf("create wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// ListByOwner 返回 owner 的 wiki（最新 N 条）。
func (r *WikiRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]domain.WikiEntry, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListWikiByOwner(ctx, dbq.ListWikiByOwnerParams{OwnerID: ownerUUID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	out := make([]domain.WikiEntry, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainWiki(&rows[i]))
	}
	return out, nil
}

// GetByID 拿 owner 的某条 wiki；不命中返回 ErrWikiNotFound。
func (r *WikiRepo) GetByID(ctx context.Context, ownerID, id string) (domain.WikiEntry, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	wikiUUID, err := parseUUID(id)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf("parse wiki id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetWikiByID(ctx, dbq.GetWikiByIDParams{ID: wikiUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.WikiEntry{}, domain.ErrWikiNotFound
		}
		return domain.WikiEntry{}, fmt.Errorf("get wiki: %w", err)
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
		titles = append([]string{w.Title}, titles...)
		if w.ParentID == nil {
			return titles, nil
		}
		current = *w.ParentID
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

func toDomainRaw(r *dbq.RawEntry) domain.RawEntry {
	e := domain.RawEntry{
		ID:             formatUUID(r.ID),
		OwnerID:        formatUUID(r.OwnerID),
		Body:           r.Body,
		Source:         r.Source,
		Tags:           r.Tags,
		FlaggedPrivate: r.FlaggedPrivate,
		Archived:       r.Archived,
		CreatedAt:      r.CreatedAt.Time,
	}
	if r.PromotedTo.Valid {
		s := formatUUID(r.PromotedTo)
		e.PromotedTo = &s
	}
	return e
}

func toDomainWiki(w *dbq.WikiEntry) domain.WikiEntry {
	e := domain.WikiEntry{
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
	}
	if w.ParentID.Valid {
		s := formatUUID(w.ParentID)
		e.ParentID = &s
	}
	if w.Path != nil {
		e.Path = w.Path
	}
	return e
}

func formatUUIDList(uu []pgtype.UUID) []string {
	out := make([]string, 0, len(uu))
	for _, u := range uu {
		out = append(out, formatUUID(u))
	}
	return out
}
