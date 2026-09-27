package pgstore

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// PageAfter — a paging cursor as the two sqlc params every paged query takes
// (after_at, after_id). A nil cursor is the first page: both NULL.
type PageAfter struct {
	At pgtype.Timestamptz
	ID pgtype.UUID
}

// CursorArgs — convert a decoded cursor for a query. A cursor id that is not a uuid did not
// come from this server: bad cursor.
func CursorArgs(c *paging.Cursor) (PageAfter, error) {
	if c == nil {
		return PageAfter{}, nil
	}
	id, err := ParseUUID(c.ID)
	if err != nil {
		return PageAfter{}, fmt.Errorf("%w: %w", paging.ErrBadCursor, err)
	}
	return PageAfter{At: pgtype.Timestamptz{Time: c.At, Valid: true}, ID: id}, nil
}
