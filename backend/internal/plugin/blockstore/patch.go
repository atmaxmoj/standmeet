// patch.go —— change one document in place by merging top-level keys into it (`doc || patch`).
// The store stays opaque: the caller decides which keys, blockstore only merges.

package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
)

// RecordPatch —— which record of a collection, and the keys to merge into it.
type RecordPatch struct {
	Collection string
	RecordID   string
	Patch      json.RawMessage
}

// Patch —— merge p's keys into one record (on the caller's tx when set by WithTx). Returns how many
// records changed: 0 means no such record.
func (s *Store) Patch(ctx context.Context, kind Kind, id string, p RecordPatch) (int64, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf(
		"UPDATE %s.records SET doc = doc || $3::jsonb WHERE collection = $1 AND id = $2", schema)
	exec := s.pool.Exec
	if s.tx != nil {
		exec = s.tx.Exec
	}
	tag, xerr := exec(ctx, sql, p.Collection, p.RecordID, p.Patch)
	if xerr != nil {
		return 0, fmt.Errorf("blockstore patch %q/%s: %w", schema, p.Collection, xerr)
	}
	return tag.RowsAffected(), nil
}
