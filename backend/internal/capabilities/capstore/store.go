// store.go —— DB operations for per-plugin isolated document storage. One dedicated schema
// per (kind,id), one generic `records(id, collection, doc jsonb, created_at)` table. What's
// stored is an opaque JSONB document — capstore **knows nothing** about business concepts
// (no "booking"). Consumers query by collection + a JSONB field filter.
//
// ⚠️ Schema names are always derived + validated through schemaName((kind,id)) (see
// schema.go); in DDL a schema name can only be interpolated (never $1-parameterized), so the
// name must be locked down by droppableRe before it's safe to splice into SQL. See Drop's
// three hard rules.

package capstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store —— per-plugin document storage sitting on the shared Postgres.
type Store struct {
	pool *pgxpool.Pool
}

// New —— the composition root injects the shared connection pool.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Provision —— when a connector/mcp is installed, create its isolated schema plus the
// records/claims tables (idempotent). An invalid name → error, nothing gets built.
//
// claims is a **single-winner claim**: for one key, only one caller holds it at a time. It's
// a separate table from records because it needs the hard guarantee of a primary-key
// conflict — whereas records stores opaque documents and has, and should have, no unique
// constraint. Who needs it: any "peek then act" flow — a second caller can squeeze into the
// window in between and both sides see the same "empty" slot (F-B-15: two booking requests
// arrive concurrently, each checks the busy slot and both see it free, so the real calendar
// ends up with two meetings side by side).
func (s *Store) Provision(ctx context.Context, kind Kind, id string) error {
	schema, err := schemaName(kind, id)
	if err != nil {
		return err
	}
	q := schema // already passed droppableRe: ^(connector|mcp)_[a-z0-9_]+$, safe to interpolate
	ddl := fmt.Sprintf(
		`CREATE SCHEMA IF NOT EXISTS %[1]s;
		 CREATE TABLE IF NOT EXISTS %[1]s.records (
		   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		   collection text NOT NULL,
		   doc jsonb NOT NULL,
		   created_at timestamptz NOT NULL DEFAULT now()
		 );
		 CREATE INDEX IF NOT EXISTS records_collection_idx ON %[1]s.records (collection);
		 CREATE INDEX IF NOT EXISTS records_doc_gin_idx ON %[1]s.records USING gin (doc);
		 CREATE TABLE IF NOT EXISTS %[1]s.claims (
		   collection text NOT NULL,
		   key text NOT NULL,
		   expires_at timestamptz NOT NULL,
		   PRIMARY KEY (collection, key)
		 );`,
		q,
	)
	if _, eerr := s.pool.Exec(ctx, ddl); eerr != nil {
		return fmt.Errorf("capstore provision %q: %w", schema, eerr)
	}
	return nil
}

// Drop —— when a connector/mcp is uninstalled, delete its entire schema (CASCADE, data
// included).
//
// ⚠️ A database-level delete operation. Three hard rules:
//  1. The schema name is derived from the host-trusted (kind,id), never taken from a plugin
//     request (this function's signature doesn't even accept a raw name).
//  2. The derived name is checked by assertDroppable first: no reserved prefix / empty /
//     core schema all get refused, never DROPped.
//  3. This is the **only** place that runs `DROP SCHEMA`; nowhere else may DROP a schema.
func (s *Store) Drop(ctx context.Context, kind Kind, id string) error {
	schema, err := schemaName(kind, id) // rule 1+2: derive + assertDroppable is called inside
	if err != nil {
		return err
	}
	if aerr := assertDroppable(schema); aerr != nil {
		return aerr // belt-and-suspenders: re-guard core before delete even if schemaName changes
	}
	dropSQL := fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)
	if _, eerr := s.pool.Exec(ctx, dropSQL); eerr != nil {
		return fmt.Errorf("capstore drop %q: %w", schema, eerr)
	}
	return nil
}

// Insert —— push one JSONB document into the (kind,id)'s collection, return the record id.
func (s *Store) Insert(
	ctx context.Context, kind Kind, id, collection string, doc json.RawMessage,
) (string, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return "", err
	}
	var recID string
	sql := fmt.Sprintf(
		"INSERT INTO %s.records (collection, doc) VALUES ($1, $2) RETURNING id", schema,
	)
	if qerr := s.pool.QueryRow(ctx, sql, collection, doc).Scan(&recID); qerr != nil {
		return "", fmt.Errorf("capstore insert %q/%s: %w", schema, collection, qerr)
	}
	return recID, nil
}

// Query —— fetch every doc in the collection matching filter (JSONB containment `@>`).
// An empty filter means fetch everything.
func (s *Store) Query(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return nil, err
	}
	sql := fmt.Sprintf(
		"SELECT doc FROM %s.records WHERE collection = $1 AND doc @> $2 ORDER BY created_at",
		schema,
	)
	rows, qerr := s.pool.Query(ctx, sql, collection, containment(filter))
	if qerr != nil {
		return nil, fmt.Errorf("capstore query %q/%s: %w", schema, collection, qerr)
	}
	defer rows.Close()
	return scanDocs(rows)
}

// Count —— count docs in the collection matching filter (used by the quota gate).
func (s *Store) Count(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) (int64, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf(
		"SELECT count(*) FROM %s.records WHERE collection = $1 AND doc @> $2", schema,
	)
	var n int64
	if cerr := s.pool.QueryRow(ctx, sql, collection, containment(filter)).Scan(&n); cerr != nil {
		return 0, fmt.Errorf("capstore count %q/%s: %w", schema, collection, cerr)
	}
	return n, nil
}

// Delete —— delete records in the collection matching filter, return the row count deleted.
// **Only deletes rows within this cap's own schema** (the schema name is validated through
// schemaName); this is never a DROP schema — a different operation entirely from Drop's
// database-level delete. An empty filter → refused (clearing an entire collection outright
// is not allowed, to guard against a slip); to actually clear it, pass `{}` explicitly? No —
// here empty always means refused.
func (s *Store) Delete(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) (int64, error) {
	if len(filter) == 0 {
		return 0, fmt.Errorf("capstore delete %s/%s: empty filter refused", kind, collection)
	}
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf("DELETE FROM %s.records WHERE collection = $1 AND doc @> $2", schema)
	tag, derr := s.pool.Exec(ctx, sql, collection, filter)
	if derr != nil {
		return 0, fmt.Errorf("capstore delete %q/%s: %w", schema, collection, derr)
	}
	return tag.RowsAffected(), nil
}

// containment —— normalize an empty filter to `{}` (matches all); otherwise pass through
// unchanged (the caller guarantees it's a JSON object).
func containment(filter json.RawMessage) json.RawMessage {
	if len(filter) == 0 {
		return json.RawMessage(`{}`)
	}
	return filter
}

func scanDocs(rows pgx.Rows) ([]json.RawMessage, error) {
	var out []json.RawMessage
	for rows.Next() {
		var doc json.RawMessage
		if serr := rows.Scan(&doc); serr != nil {
			return nil, fmt.Errorf("capstore scan doc: %w", serr)
		}
		out = append(out, doc)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("capstore rows: %w", rerr)
	}
	return out, nil
}

// Record —— a stored doc paired with its uuid record id. Host-side only: the record id is NOT part
// of the sandbox reach-back vocabulary (which is docs-only), so a plugin can't address rows by id.
// The composition root uses this to give host features (admin list / cancel-by-id) a stable handle.
type Record struct {
	ID  string
	Doc json.RawMessage
}

// QueryWithIDs —— like Query but returns each record's uuid id alongside its doc. Host-only.
func (s *Store) QueryWithIDs(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) ([]Record, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return nil, err
	}
	sql := fmt.Sprintf(
		"SELECT id, doc FROM %s.records WHERE collection = $1 AND doc @> $2 ORDER BY created_at",
		schema,
	)
	rows, qerr := s.pool.Query(ctx, sql, collection, containment(filter))
	if qerr != nil {
		return nil, fmt.Errorf("capstore query-with-ids %q/%s: %w", schema, collection, qerr)
	}
	defer rows.Close()
	return scanRecords(rows)
}

// DeleteByID —— delete one record by its uuid id within a collection. Host-only (cancel-by-id).
func (s *Store) DeleteByID(
	ctx context.Context, kind Kind, id, collection, recordID string,
) (int64, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf("DELETE FROM %s.records WHERE collection = $1 AND id = $2", schema)
	tag, derr := s.pool.Exec(ctx, sql, collection, recordID)
	if derr != nil {
		return 0, fmt.Errorf("capstore delete-by-id %q/%s: %w", schema, collection, derr)
	}
	return tag.RowsAffected(), nil
}

func scanRecords(rows pgx.Rows) ([]Record, error) {
	var out []Record
	for rows.Next() {
		var r Record
		if serr := rows.Scan(&r.ID, &r.Doc); serr != nil {
			return nil, fmt.Errorf("capstore scan record: %w", serr)
		}
		out = append(out, r)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("capstore records rows: %w", rerr)
	}
	return out, nil
}
