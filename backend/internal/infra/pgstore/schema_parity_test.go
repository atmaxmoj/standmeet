package pgstore_test

// schema.sql builds a fresh volume; the migrations upgrade an old one. Both must end in the same
// shape. Every migration is reentrant, so running them all against a schema.sql database may only
// fill gaps — and a gap is exactly the defect: a migration that creates something schema.sql
// never got (visit_event and visit_viewer lived only in their migration until 2026-09-26).

import (
	"context"
	"log/slog"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// catalog — every table.column and every index in the public schema, sorted.
func catalog(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT 'col ' || table_name || '.' || column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
		UNION ALL
		SELECT 'idx ' || indexname FROM pg_indexes WHERE schemaname = 'public'
		   AND tablename <> 'schema_migrations'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if serr := rows.Scan(&s); serr != nil {
			t.Fatal(serr)
		}
		out = append(out, s)
	}
	slices.Sort(out)
	return out
}

func TestMigrationsAddNothingToASchemaSQLDatabase(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	before := catalog(t, pool)
	quiet := slog.New(slog.DiscardHandler)
	if err := pgstore.Migrate(context.Background(), pool, quiet); err != nil {
		t.Fatalf("migrations failed on a schema.sql database: %v", err)
	}
	after := catalog(t, pool)
	var added []string
	for _, s := range after {
		if _, found := slices.BinarySearch(before, s); !found {
			added = append(added, s)
		}
	}
	if len(added) > 0 {
		t.Fatalf("migrations created what schema.sql lacks — add it to schema.sql: %v", added)
	}
}
