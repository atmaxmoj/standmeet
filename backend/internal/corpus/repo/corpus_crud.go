// corpus_crud.go —— admin edit / delete / promote-aux operations for raw + wiki + output,
// split out of the corpus.go / output.go bodies to stay under the 350-line max-lines cap.
//
// Naming follows the sqlc-generated queries: RawRepo.UpdateBody / Archive;
// WikiRepo.Update / Delete; OutputRepo.Update / Delete.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ─── raw ────────────────────────────────────────────────────

// UpdateRawInput —— admin "edit raw" input.
type UpdateRawInput struct {
	OwnerID        string
	ID             string
	Body           string
	Tags           []string
	FlaggedPrivate bool
}

// UpdateBody changes a raw's (corpus_notes genre='raw') body + tags + flagged_private
// (inbox_source is left unchanged).
func (r *RawRepo) UpdateBody(
	ctx context.Context, in *UpdateRawInput,
) (entity.Raw, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateRawBody(ctx, db.UpdateRawBodyParams{
		ID: rawUUID, OwnerID: ownerUUID,
		Body: in.Body, Tags: nilSafeTags(in.Tags), FlaggedPrivate: in.FlaggedPrivate,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Raw{}, entity.ErrRawNotFound
		}
		return entity.Raw{}, fmt.Errorf("update raw: %w", qerr)
	}
	return toDomainRaw(&row), nil
}

// Delete removes one raw. Goes through the same DeleteNote as wiki / output — underneath
// it's already the same corpus_notes table, genre is just a column.
//
// This used to be Archive: set archived=true and keep the row, with a comment claiming
// "soft-delete keeps it visible for retention / audit". **That "still visible" never
// existed** — ListRawByOwner always filters archived=false, there was no second reader,
// and no path to restore it. One explanatory comment made this design look intentional,
// for a long time.
func (r *RawRepo) Delete(ctx context.Context, ownerID, rawID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(rawID)
	if err != nil {
		return fmt.Errorf("parse raw id: %w", err)
	}
	q := db.New(r.pool)
	derr := q.DeleteNote(ctx, db.DeleteNoteParams{
		ID: rawUUID, OwnerID: ownerUUID, Genre: genreRaw,
	})
	if derr != nil {
		return fmt.Errorf("delete raw: %w", derr)
	}
	return nil
}

// ─── wiki ───────────────────────────────────────────────────

// UpdateWikiInput —— admin "edit wiki" input.
type UpdateWikiInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// Update changes the main fields of a wiki note (corpus_notes genre='wiki'); SEO is
// written separately through SetSEO.
func (r *WikiRepo) Update(
	ctx context.Context, in *UpdateWikiInput,
) (entity.Wiki, error) {
	params, err := buildWikiUpdateParams(in)
	if err != nil {
		return entity.Wiki{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("update wiki: %w", qerr)
	}
	return toDomainWiki(&row), nil
}

func buildWikiUpdateParams(in *UpdateWikiInput) (db.UpdateNoteBodyParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse wiki id: %w", err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return db.UpdateNoteBodyParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: nilSafeTags(in.CSSClasses),
	}, nil
}

// Delete hard-deletes one wiki. Assets **don't follow via foreign key** — they're attached
// by holder_id with no FK, so deleting an entry is done by the caller deleting assets
// first, then the entry (see dropEntryAssets in ops/corpus_write_media.go).
// output.source_wiki_ids is a uuid[], so it's unaffected by cascade (a leftover wiki id
// there isn't fatal).
func (r *WikiRepo) Delete(ctx context.Context, ownerID, wikiID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(wikiID)
	if err != nil {
		return fmt.Errorf("parse wiki id: %w", err)
	}
	q := db.New(r.pool)
	derr := q.DeleteNote(ctx, db.DeleteNoteParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
	})
	if derr != nil {
		return fmt.Errorf("delete wiki: %w", derr)
	}
	return nil
}

// The batch cited-id → title+path lookup (GetTitlesByIDs) is retired: transcript hydration
// now loads the whole tree in conversation.GetConversationTranscript and computes the
// address with WikiTreePaths (the address is derived purely from the tree, not read from
// the retired path column).

// ─── output ─────────────────────────────────────────────────

// UpdateOutputInput —— admin "edit output" input.
type UpdateOutputInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
}

// Update changes the main fields of an output note (corpus_notes genre='output').
func (r *OutputRepo) Update(
	ctx context.Context, in *UpdateOutputInput,
) (entity.Output, error) {
	params, err := buildOutputUpdateParams(in)
	if err != nil {
		return entity.Output{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Output{}, entity.ErrOutputNotFound
		}
		return entity.Output{}, fmt.Errorf("update output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputUpdateParams(in *UpdateOutputInput) (db.UpdateNoteBodyParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse output id: %w", err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return db.UpdateNoteBodyParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: []string{},
	}, nil
}

// Delete hard-deletes one output.
func (r *OutputRepo) Delete(ctx context.Context, ownerID, outputID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(outputID)
	if err != nil {
		return fmt.Errorf("parse output id: %w", err)
	}
	q := db.New(r.pool)
	derr := q.DeleteNote(ctx, db.DeleteNoteParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
	})
	if derr != nil {
		return fmt.Errorf("delete output: %w", derr)
	}
	return nil
}
