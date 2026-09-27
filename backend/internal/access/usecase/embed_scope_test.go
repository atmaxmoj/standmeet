package usecase_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
)

// embedFixture — one owner; a role granting wiki://projects/**; a code on that role that takes
// back wiki://projects/secret/**; an embed exposing the code.
type embedFixture struct {
	deps               usecase.EmbedScopeDeps
	owner, code, embed string
}

func seedEmbed(t *testing.T, pool *pgxpool.Pool) embedFixture {
	t.Helper()
	ctx := context.Background()
	var f embedFixture
	var role string
	must := func(what string, err error) {
		if err != nil {
			t.Fatalf("seed %s: %v", what, err)
		}
	}
	must("owner", pool.QueryRow(ctx, `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id`).Scan(&f.owner))
	must("role", pool.QueryRow(ctx, `INSERT INTO roles (owner_id, name) VALUES ($1, 'partner')
		RETURNING id`, f.owner).Scan(&role))
	_, err := pool.Exec(ctx, `INSERT INTO role_corpus_uris (role_id, uri_pattern)
		VALUES ($1, 'wiki://projects/**')`, role)
	must("role globs", err)
	must("code", pool.QueryRow(ctx, `INSERT INTO access_codes
		(owner_id, code, label, slug, assumed_role_id) VALUES ($1, 'EMB-1', 'e', 'emb-1', $2)
		RETURNING id`, f.owner, role).Scan(&f.code))
	_, err = pool.Exec(ctx, `INSERT INTO code_corpus_denials (code_id, uri_pattern)
		VALUES ($1, 'wiki://projects/secret/**')`, f.code)
	must("code denials", err)
	must("embed", pool.QueryRow(ctx, `INSERT INTO embeds (owner_id, code_id) VALUES ($1, $2)
		RETURNING id`, f.owner, f.code).Scan(&f.embed))
	f.deps = usecase.EmbedScopeDeps{
		Embeds: repo.NewEmbedRepo(pool), Codes: repo.NewCodeRepo(pool),
		Denials: repo.NewCodeDenialRepo(pool), Roles: repo.NewRoleRepo(pool),
	}
	return f
}

func admits(t *testing.T, f *embedFixture, uri string, published bool) bool {
	t.Helper()
	ok, err := usecase.EmbedAdmits(context.Background(), f.deps, f.owner, f.embed,
		entity.CorpusEntryRef{URI: uri, Published: published})
	if err != nil {
		t.Fatalf("embed admits %s: %v", uri, err)
	}
	return ok
}

func TestAnEmbedsScopeIsItsCodesRoleGlobsMinusItsDenials(t *testing.T) {
	t.Parallel()
	f := seedEmbed(t, scratchDB(t))
	cases := []struct {
		uri       string
		published bool
		want      bool
	}{
		{uri: "wiki://projects/a", want: true},
		{uri: "wiki://projects/a", published: true, want: true},
		{uri: "wiki://elsewhere/a", published: true, want: false},
		{uri: "wiki://projects/secret/a", published: true, want: false},
		{uri: "raw://projects/a", published: true, want: false},
	}
	for _, c := range cases {
		if got := admits(t, &f, c.uri, c.published); got != c.want {
			t.Errorf("%s (published %v): admitted %v, want %v", c.uri, c.published, got, c.want)
		}
	}
}

const inScope = "wiki://projects/a"

func TestARevokedCodeAdmitsNothing(t *testing.T) {
	t.Parallel()
	f := seedEmbed(t, scratchDB(t))
	if !admits(t, &f, inScope, false) {
		t.Fatal("precondition: the live code must admit an in-scope entry")
	}
	if err := f.deps.Codes.Revoke(context.Background(), f.owner, f.code); err != nil {
		t.Fatal(err)
	}
	if admits(t, &f, inScope, false) {
		t.Error("a revoked code must admit nothing")
	}
}

func TestADeletedEmbedAdmitsNothing(t *testing.T) {
	t.Parallel()
	f := seedEmbed(t, scratchDB(t))
	if !admits(t, &f, inScope, false) {
		t.Fatal("precondition: the live code must admit an in-scope entry")
	}
	if err := f.deps.Embeds.Delete(context.Background(), f.owner, f.embed); err != nil {
		t.Fatal(err)
	}
	if admits(t, &f, inScope, false) {
		t.Error("a deleted embed must admit nothing")
	}
}
