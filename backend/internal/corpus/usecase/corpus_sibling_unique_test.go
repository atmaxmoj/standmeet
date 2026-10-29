package usecase_test

// A wiki created directly (the owner AI's corpus.create → CreateWiki) must refuse a title that
// slugs to the same segment as an existing sibling, exactly as promote and update already do.
// Without this, two "software" roots could coexist and the tree address stopped being 1:1 — the
// 2026-10-28 duplicate-node bug. Same slug under a DIFFERENT parent is fine (a different folder).

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// sibEnv —— a scratch DB with one owner and the minimal Deps CreateWiki needs.
type sibEnv struct {
	deps  usecase.Deps
	owner string
}

func newSibEnv(t *testing.T) *sibEnv {
	t.Helper()
	pool := scratchDB(t)
	var owner string
	err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&owner)
	if err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return &sibEnv{
		deps:  usecase.Deps{Wiki: repo.NewWikiRepo(pool), NoteRefs: repo.NewNoteRefRepo(pool)},
		owner: owner,
	}
}

func (e *sibEnv) create(ctx context.Context, title string, parent *string) error {
	_, err := usecase.CreateWiki(ctx, e.deps, &usecase.CreateWikiReq{
		OwnerID: e.owner, ParentID: parent, Title: title, Body: "body",
	})
	return err
}

func (e *sibEnv) mustCreate(
	ctx context.Context, t *testing.T, title string, parent *string,
) string {
	t.Helper()
	w, err := usecase.CreateWiki(ctx, e.deps, &usecase.CreateWikiReq{
		OwnerID: e.owner, ParentID: parent, Title: title, Body: "body",
	})
	if err != nil {
		t.Fatalf("create %q: %v", title, err)
	}
	return w.ID()
}

func TestCreateWikiRejectsSiblingSlugCollision(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	e := newSibEnv(t)
	e.mustCreate(ctx, t, "Software", nil)
	// Second root "software" slugs to the same segment → rejected (the bug).
	err := e.create(ctx, "software", nil)
	if !errors.Is(err, entity.ErrSiblingSlugTaken) {
		t.Fatalf("want ErrSiblingSlugTaken for duplicate root, got %v", err)
	}
	// A distinct title is allowed.
	e.mustCreate(ctx, t, "Hardware", nil)
}

func TestCreateWikiAllowsSameSlugUnderDifferentParent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	e := newSibEnv(t)
	e.mustCreate(ctx, t, "software", nil)
	pid := e.mustCreate(ctx, t, "Docs", nil)
	// Same slug, different parent = a different folder → allowed.
	e.mustCreate(ctx, t, "software", &pid)
}
