// wiki_cards.go —— repo side of the page-pin join: fetch pinned entries' card content
// (title / excerpt / published) by id set. Order is re-sorted by the usecase per the pin list.

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WikiCard —— one pinned entry's card content. Published is a fallback filter input on the
// render side (the invariant pinned ⊆ published is maintained by the write side).
//
// Body is here because the card's blurb **is derived from the body when the owner didn't write
// one** (F-L-47): all 1047 notes in the real vault have an empty excerpt; sync doesn't produce
// one. Derivation lives at the usecase layer (the repo doesn't decide what to display) — here we
// just carry the raw material along.
type WikiCard struct {
	ID        string
	Title     string
	Excerpt   string
	Body      string
	Published bool
}

// ListCardsByIDs —— id set → card content map (unordered; caller reads it in pin order).
// An id with no match isn't in the map (entry was deleted → caller skips it).
func (r *WikiRepo) ListCardsByIDs(
	ctx context.Context, ownerID string, ids []string,
) (map[string]WikiCard, error) {
	if len(ids) == 0 {
		return map[string]WikiCard{}, nil
	}
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	uuids, err := parsePinIDs(ids)
	if err != nil {
		return nil, err
	}
	rows, err := db.New(r.pool).ListNoteCardsByIDs(ctx, db.ListNoteCardsByIDsParams{
		OwnerID: ownerUUID, Column2: uuids,
	})
	if err != nil {
		return nil, fmt.Errorf("list note cards: %w", err)
	}
	return cardsFromRows(rows), nil
}

func cardsFromRows(rows []db.ListNoteCardsByIDsRow) map[string]WikiCard {
	out := make(map[string]WikiCard, len(rows))
	for i := range rows {
		id := pgstore.FormatUUID(rows[i].ID)
		out[id] = WikiCard{
			ID: id, Title: rows[i].Title, Excerpt: rows[i].Excerpt,
			Body: rows[i].Body, Published: rows[i].Published,
		}
	}
	return out
}

func parsePinIDs(ids []string) ([]pgtype.UUID, error) {
	uuids := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		u, err := pgstore.ParseUUID(id)
		if err != nil {
			return nil, fmt.Errorf("parse pin id %q: %w", id, err)
		}
		uuids = append(uuids, u)
	}
	return uuids, nil
}
