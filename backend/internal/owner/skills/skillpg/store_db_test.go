// store_db_test.go —— the Postgres store's SQL against a real scratch database (the mem store in
// the domain package can't catch a wrong $n, a broken version bump, or a missing FK cascade). Flow:
// insert → get current → new version → old version still readable → list → delete.

package skillpg_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/owner/skills"
	"github.com/atmaxmoj/standmeet/internal/owner/skills/skillpg"
)

const noteSlug = "note-taking"

const scratchNameBytes = 6

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
	t.Cleanup(pool.Close)
	return pool
}

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
		if _, derr := ap.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); derr != nil {
			t.Errorf("drop scratch database: %v", derr)
		}
		ap.Close()
	})
}

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

func anOwner(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("insert owner: %v", err)
	}
	return id
}

func noteInput(slug, body string) *skills.NewInput {
	return &skills.NewInput{Slug: slug, Name: "Note", Body: body, Source: skills.SourceOwner}
}

func TestStoreKeepsEveryVersion(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := scratchDB(t)
	owner := anOwner(t, pool)
	svc := skills.NewService(skillpg.New(pool), nil)

	_, err := svc.New(ctx, owner, noteInput(noteSlug, "v1 body"))
	require.NoError(t, err)
	// a second create with the same slug is the unique violation, mapped to ErrSlugTaken.
	_, dup := svc.New(ctx, owner, noteInput(noteSlug, "again"))
	require.ErrorIs(t, dup, skills.ErrSlugTaken)

	ed, err := svc.Edit(ctx, owner, noteSlug, "v2 body")
	require.NoError(t, err)
	require.Equal(t, 2, ed.Version)
	require.Equal(t, "v2 body", ed.Body)

	cur, err := svc.Get(ctx, owner, noteSlug)
	require.NoError(t, err)
	require.Equal(t, "v2 body", cur.Body)

	old, err := svc.GetVersion(ctx, owner, noteSlug, 1)
	require.NoError(t, err)
	require.Equal(t, "v1 body", old.Body)
}

func TestStoreCascadesWithOwner(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := scratchDB(t)
	owner := anOwner(t, pool)
	svc := skills.NewService(skillpg.New(pool), nil)
	_, err := svc.New(ctx, owner, noteInput(noteSlug, "body"))
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `DELETE FROM owners WHERE id=$1`, owner)
	require.NoError(t, err)
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM agent_skill_versions`).Scan(&n))
	require.Zero(t, n, "versions should cascade with the owner")
}

func TestBundledSeedIsIdempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := scratchDB(t)
	owner := anOwner(t, pool)
	svc := skills.NewService(skillpg.New(pool), nil)

	require.NoError(t, skills.SeedBundled(ctx, svc, owner))
	require.NoError(t, skills.SeedBundled(ctx, svc, owner))

	list, err := svc.List(ctx, owner)
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, "interview-loop", list[0].Slug)
	require.Equal(t, skills.SourceBundled, list[0].Source)
}
