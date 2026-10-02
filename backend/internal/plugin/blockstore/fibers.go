// fibers.go —— the two operations that look across one block's per-fiber schemas: which of a
// set of schemas exist, and moving records from one schema to another (the upgrade that gave a
// block one schema per fiber moves the old single schema's rows to the owner's root fiber).

package blockstore

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Existing —— the ids among `ids` whose schema exists, in the order given. A fan-out read asks
// this first, so it reads the fibers that hold data instead of creating an empty schema for every
// fiber it might visit.
func (s *Store) Existing(ctx context.Context, kind Kind, ids []string) ([]string, error) {
	names, err := schemaNames(kind, ids)
	if err != nil {
		return nil, err
	}
	rows, qerr := s.pool.Query(ctx,
		`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1)`, names)
	if qerr != nil {
		return nil, fmt.Errorf("blockstore existing: %w", qerr)
	}
	found, ferr := collectNames(rows)
	if ferr != nil {
		return nil, ferr
	}
	return keepFound(ids, names, found), nil
}

// keepFound —— the ids whose schema name was found, in order.
func keepFound(ids, names []string, found map[string]bool) []string {
	out := make([]string, 0, len(found))
	for i, n := range names {
		if found[n] {
			out = append(out, ids[i])
		}
	}
	return out
}

// schemaNames —— schemaName for each id, in order.
func schemaNames(kind Kind, ids []string) ([]string, error) {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		name, err := schemaName(kind, id)
		if err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, nil
}

func collectNames(rows pgx.Rows) (map[string]bool, error) {
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("blockstore existing scan: %w", err)
		}
		found[n] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("blockstore existing rows: %w", err)
	}
	return found, nil
}

// MoveRecords —— move every record of fromID whose collection does not start with keepPrefix into
// toID, keeping ids and timestamps. toID is provisioned only when there is something to move. One
// statement, so atomic: a crash leaves the rows where they were, never in both places. Returns how
// many moved.
func (s *Store) MoveRecords(
	ctx context.Context, kind Kind, fromID, toID, keepPrefix string,
) (int64, error) {
	names, err := schemaNames(kind, []string{fromID, toID})
	if err != nil {
		return 0, err
	}
	pending, cerr := s.movable(ctx, names[0], keepPrefix)
	if cerr != nil || pending == 0 {
		return 0, cerr
	}
	if perr := s.EnsureProvisioned(ctx, kind, toID); perr != nil {
		return 0, perr
	}
	return s.move(ctx, names[0], names[1], keepPrefix)
}

// move —— the one statement that moves the records. Both names passed schemaName's droppableRe,
// so they are safe to interpolate.
func (s *Store) move(ctx context.Context, from, to, keepPrefix string) (int64, error) {
	tag, xerr := s.pool.Exec(ctx, fmt.Sprintf(
		`WITH moved AS (DELETE FROM %s.records WHERE collection NOT LIKE $1 || '%%' RETURNING *)
		 INSERT INTO %s.records (id, collection, doc, created_at)
		 SELECT id, collection, doc, created_at FROM moved`, from, to), keepPrefix)
	if xerr != nil {
		return 0, fmt.Errorf("blockstore move %s → %s: %w", from, to, xerr)
	}
	return tag.RowsAffected(), nil
}

// movable —— how many records of schema MoveRecords would move.
func (s *Store) movable(ctx context.Context, schema, keepPrefix string) (int64, error) {
	var n int64
	if err := s.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT count(*) FROM %s.records WHERE collection NOT LIKE $1 || '%%'`, schema),
		keepPrefix).Scan(&n); err != nil {
		return 0, fmt.Errorf("blockstore move count %s: %w", schema, err)
	}
	return n, nil
}
