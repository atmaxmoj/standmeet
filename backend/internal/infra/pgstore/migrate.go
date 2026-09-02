// migrate.go — applies the schema changes a release brings, into the DB, at deploy time.
//
// **Why the backend has to do this itself at startup**: `schema.sql` only runs once,
// and only on a **brand-new pg volume** (infra/db/Dockerfile's comment says so). An
// already-running instance's upgrade doesn't go through that path — and before this file
// existed, **nothing** ran the files under `backend/db/migrations/`: that meant a
// self-hosted owner pulling a new image and restarting would have code that wants a new
// column, no column in the DB, and a backend that won't start. Making the owner hand-type
// SQL himself is pushing the system's defect onto his own discipline.
//
// **Why go:embed instead of reading off disk**: this way the migrations and the code are
// **the same artifact**. Reading off disk lets them drift apart independently — and the
// shape that drift takes is "new code against old schema," which is exactly the shape of
// a backend that won't start. Once embedded, "this version got deployed" and "this
// version's schema changes got applied" are the same event, with no second step anyone
// has to remember.
//
// **Fail means don't serve**: an instance with a half-applied schema is harder to
// diagnose than one that won't boot — it blows up on some specific query later, and the
// error points at that query, not at this file.
//
// # Ledger
//
// `schema_migrations` records which ones ran; anything unrecorded gets applied,
// **assuming nothing**.
//
// Warning: this used to have a "baseline" branch — the first time it saw a DB (the ledger
// table didn't exist yet), it marked every current migration as already applied without
// running them, on the reasoning that "a new volume is built by schema.sql, an old
// instance was hand-patched before, both already contain their migrations' results."
// The first run on dev disproved that: that instance had no ledger, **and it genuinely
// was missing one migration** — so that migration got permanently marked as applied, the
// column still didn't exist, and nothing reported it. And that's exactly the branch every
// old instance hits on its first startup — the one branch that should never rely on an
// assumption.
//
// There's no such branch now: every migration is written to be reentrant (`IF NOT
// EXISTS` / `DO $$` guards), so running one against a DB already in the new shape is a
// no-op, and running it against a DB missing something fills the gap. The one migration
// that backfills data (`2026-08-16-cover-hue-never-chosen.sql`) is also safe to rerun —
// the state it cleans up can't be produced by the product (covers only exist on writing,
// and its WHERE clause is `genre <> 'writing'`).

package pgstore

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/db"
)

// migrationsFS — the copy embedded into the binary, declared next to the migration files
// (`go:embed` can't reach outside its own package dir, see backend/db/embed.go).
var migrationsFS = db.Migrations

const ledgerDDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
	name        text        PRIMARY KEY,
	applied_at  timestamptz NOT NULL DEFAULT now()
)`

// Migrate — applies every not-yet-run migration in filename order. Called at startup,
// **before serving begins**.
func Migrate(ctx context.Context, pool *Pool, log *slog.Logger) error {
	files, err := migrationNames()
	if err != nil {
		return err
	}
	if _, eerr := pool.Exec(ctx, ledgerDDL); eerr != nil {
		return fmt.Errorf("create migration ledger: %w", eerr)
	}
	return applyPending(ctx, pool, log, files)
}

// migrationNames — sorted by filename. Filenames start with an ISO date, so lexical
// order is chronological order; two on the same day are distinguished by suffix, and
// that's also the order they were written in.
func migrationNames() ([]string, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			out = append(out, e.Name())
		}
	}
	slices.Sort(out)
	return out, nil
}

// applyPending — runs only the ones missing from the ledger, one transaction per migration.
func applyPending(ctx context.Context, pool *Pool, log *slog.Logger, files []string) error {
	done, err := appliedSet(ctx, pool)
	if err != nil {
		return err
	}
	for _, name := range files {
		if done[name] {
			continue
		}
		if aerr := applyOne(ctx, pool, name); aerr != nil {
			return aerr
		}
		log.Info("schema migration applied", "name", name)
	}
	return nil
}

func appliedSet(ctx context.Context, pool *Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT name FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read migration ledger: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if serr := rows.Scan(&name); serr != nil {
			return nil, fmt.Errorf("scan migration ledger: %w", serr)
		}
		out[name] = true
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate migration ledger: %w", rerr)
	}
	return out, nil
}

// applyOne — one transaction per migration: **the SQL and its ledger row commit together**.
// Committing them separately would let a mid-way crash leave "ran but not recorded" or
// "recorded but not run," and either one leaves a human guessing.
func applyOne(ctx context.Context, pool *Pool, name string) error {
	body, err := migrationsFS.ReadFile("migrations/" + name)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", name, err)
	}
	tx, terr := pool.Begin(ctx)
	if terr != nil {
		return fmt.Errorf("begin migration %s: %w", name, terr)
	}
	// Rollback's error has nowhere useful to go: on a successful commit it's bound to
	// return ErrTxClosed, and on the failure path the error actually worth reporting is
	// the **one below**, not the rollback itself.
	defer func() { _ = tx.Rollback(ctx) }() //nolint:errcheck // see above
	if rerr := runInTx(ctx, tx, name, body); rerr != nil {
		return rerr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit migration %s: %w", name, cerr)
	}
	return nil
}

// runInTx — the two statements inside the transaction: the migration body + its ledger row.
func runInTx(ctx context.Context, tx pgx.Tx, name string, body []byte) error {
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		return fmt.Errorf("apply migration %s: %w", name, err)
	}
	const record = `INSERT INTO schema_migrations (name) VALUES ($1)`
	if _, err := tx.Exec(ctx, record, name); err != nil {
		return fmt.Errorf("record migration %s: %w", name, err)
	}
	return nil
}
