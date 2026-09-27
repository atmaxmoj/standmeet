// records_page.go —— the host-side paged read over a (kind,id)'s schema: every collection,
// newest first (docs/design/paging.md). Split out of store.go to keep that file to the
// per-namespace document operations.

package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// CollectedRecord —— a stored doc with its record id, its collection and when it was written.
// Host-side only; the admin management view lists a namespace's rows with a per-row delete handle.
type CollectedRecord struct {
	CreatedAt  time.Time
	ID         string
	Collection string
	Doc        json.RawMessage
}

// RecordsAfter —— the keyset position of a records page: the last row of the previous page.
// A zero value (empty ID) is the first page.
type RecordsAfter struct {
	At time.Time
	ID string
}

// RecordsPage —— up to `limit` records of the (kind,id)'s schema across collections, newest first,
// after `after` (docs/design/paging.md). Host-only.
func (s *Store) RecordsPage(
	ctx context.Context, kind Kind, id string, after RecordsAfter, limit int32,
) ([]CollectedRecord, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return nil, err
	}
	sql := fmt.Sprintf(
		"SELECT id, collection, doc, created_at FROM %s.records "+
			"WHERE $1::text = '' "+
			"OR (created_at, id) < ($2::timestamptz, NULLIF($1::text, '')::uuid) "+
			"ORDER BY created_at DESC, id DESC LIMIT $3", schema,
	)
	rows, qerr := s.pool.Query(ctx, sql, after.ID, after.At, limit)
	if qerr != nil {
		return nil, fmt.Errorf("blockstore records page %q: %w", schema, qerr)
	}
	defer rows.Close()
	return scanCollected(rows)
}

func scanCollected(rows pgx.Rows) ([]CollectedRecord, error) {
	out := []CollectedRecord{}
	for rows.Next() {
		var r CollectedRecord
		if serr := rows.Scan(&r.ID, &r.Collection, &r.Doc, &r.CreatedAt); serr != nil {
			return nil, fmt.Errorf("blockstore scan collected record: %w", serr)
		}
		out = append(out, r)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("blockstore records rows: %w", rerr)
	}
	return out, nil
}
