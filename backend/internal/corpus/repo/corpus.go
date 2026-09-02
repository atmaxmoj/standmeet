// corpus.go — RawRepo + shared Wiki/Output helpers (loadByPath / UUID utils
// / formatUUIDList). WikiRepo lives in wiki.go, OutputRepo in output.go.
// raw is folded into corpus_notes (genre='raw', #151); RawRepo is its CRUD view
// under inbox semantics.

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
	maxPathDepth   = 32 // guard against parent cycles or abnormally deep trees
	rawTitleMaxLen = 60 // truncation length for the title derived from raw body (in characters)
)

// RawRepo — inbox CRUD over corpus_notes(genre='raw').
type RawRepo struct {
	pool *pgstore.Pool
}

// NewRawRepo constructs a RawRepo.
func NewRawRepo(pool *pgstore.Pool) *RawRepo { return &RawRepo{pool: pool} }

// CreateRawInput is the input to Create (avoids exposing sqlc params directly).
type CreateRawInput struct {
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
}

// Create writes a new raw entry (corpus_notes genre='raw'). Pointer receiver avoids hugeParam.
// corpus_notes.title is NOT NULL, so a title is derived from body (first non-empty
// line, truncated).
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

// rawTitleFromBody — raw has no independent title, so it's derived from body: the first
// non-empty line, trimmed to <=60 **characters**; falls back to "untitled" if empty.
//
// Cut by character, not by byte: `line[:60]` would split a multi-byte character at byte
// 60, and postgres rejects the whole row on a half character (invalid byte sequence for
// encoding "UTF8"), with an error that never mentions the title. A Chinese line hits 63
// bytes at just 21 characters — for a Chinese vault that's the common case, not an edge case.
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

// nilSafeTags — the postgres text[] NOT NULL column rejects NULL; this converts a nil
// slice to an empty slice (pgx serializes it as '{}'). An MCP caller that omits tags
// shouldn't blow up.
func nilSafeTags(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// ListByOwner returns the owner's non-archived raw entries (newest N).
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

// Search — full-text search over raw (title + body); returns meta + matched snippet;
// paginated.
//
// wiki / output / subjectivity already had this, raw **did not** — yet raw is exactly
// the genre with the most entries and mostly auto-generated titles (450 entries in this
// instance). When the owner wants to find some passage they dumped in, this is the one
// they most need to search (F-L-39/41). The underlying `SearchNotes` was already
// parameterized by genre; only this layer was missing.
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

// GetByID fetches a raw entry belonging to owner; returns ErrRawNotFound on a miss.
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

// MarkPromoted writes corpus_notes(genre='raw').promoted_to.
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

// path-string lookup (byPathQuery/loadByPath) is retired: the address is derived from
// the tree, no longer looked up by a path column; cite/addressing goes through id
// (GetByID), and the public landing page has usecases load the whole tree to compute
// addresses.

// toDomainRaw — converts a corpus_notes(genre='raw') row → Raw. inbox_source → Source.
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
