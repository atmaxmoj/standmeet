package river_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// scratchNameBytes — random bytes in a scratch database's name.
const scratchNameBytes = 6

// scratchDB — a private copy of the schema.sql database for one test (see `make ut-db`).
// It fails, never skips: a skipped DB suite reads as green.
func scratchDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	admin := os.Getenv("STANDMEET_TEST_PG")
	if admin == "" {
		t.Fatal("STANDMEET_TEST_PG is unset: run the DB-backed tests through `make backend-test`")
	}
	ctx := context.Background()
	buf := make([]byte, scratchNameBytes)
	_, _ = rand.Read(buf)
	name := "t_" + hex.EncodeToString(buf)
	cloneTemplate(ctx, t, admin, name)
	pool, err := pgxpool.New(ctx, scratchURL(t, admin, name))
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close) // runs before the drop: cleanups run last-in first-out
	return pool
}

// cloneTemplate — creates database name from the template and drops it when the test ends.
func cloneTemplate(ctx context.Context, t *testing.T, admin, name string) {
	t.Helper()
	ap, err := pgxpool.New(ctx, admin)
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	if _, err = ap.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE standmeet"); err != nil {
		ap.Close()
		t.Fatalf("clone template: %v", err)
	}
	t.Cleanup(func() {
		drop := "DROP DATABASE IF EXISTS " + name + " WITH (FORCE)"
		if _, derr := ap.Exec(ctx, drop); derr != nil {
			t.Errorf("drop scratch database: %v", derr)
		}
		ap.Close()
	})
}

// scratchURL — the admin URL pointed at database name.
func scratchURL(t *testing.T, admin, name string) string {
	t.Helper()
	u, err := url.Parse(admin)
	if err != nil {
		t.Fatalf("parse STANDMEET_TEST_PG: %v", err)
	}
	u.Path = "/" + name
	q := u.Query()
	q.Set("pool_max_conns", "40")
	u.RawQuery = q.Encode()
	return u.String()
}
