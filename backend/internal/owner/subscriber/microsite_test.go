package subscriber_test

// What follows a settled build: the home page goes live on its first built build, and a page's
// asset references follow its latest built source. Both handlers run twice (at-least-once
// delivery) and end in the same state.

import (
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

type settledFixture struct {
	pool  *pgxpool.Pool
	deps  *subscriber.BuildSettledDeps
	refs  map[string]map[string]string // page id → the sources its references were rebuilt from
	owner string
}

func settledSetup(t *testing.T) *settledFixture {
	t.Helper()
	pool := scratchDB(t)
	var owner string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('s@example.com', 'x', 's', 'S')
		RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	bus, err := events.New(pool, usecase.OwnerEventTypes(), nil)
	if err != nil {
		t.Fatal(err)
	}
	f := &settledFixture{pool: pool, owner: owner, refs: map[string]map[string]string{}}
	f.deps = &subscriber.BuildSettledDeps{
		Pages: repo.NewMicrositeRepo(pool), Builds: repo.NewMicrositeBuildRepo(pool),
		Log: slog.New(slog.DiscardHandler), Events: bus.Recorder(),
		// Replaces the page's references, as the corpus-side rebuild does.
		RebuildAssetRefs: func(_ context.Context, _, page string, src map[string]string) error {
			f.refs[page] = maps.Clone(src)
			return nil
		},
	}
	return f
}

func (f *settledFixture) page(t *testing.T, slug string) string {
	t.Helper()
	p, err := f.deps.Pages.Create(context.Background(), f.owner, slug, slug)
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

// built —— a build of page from source, settled built; its event.
func (f *settledFixture) built(t *testing.T, page, source string) (string, events.Event) {
	t.Helper()
	ctx := context.Background()
	b, err := f.deps.Builds.Create(ctx, page, map[string]string{"App.tsx": source})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.deps.Builds.MarkBuilt(ctx, b.ID, "out/"+b.ID); err != nil {
		t.Fatal(err)
	}
	return b.ID, settledEvent(f.owner, b.ID, usecase.BuildBuilt)
}

func settledEvent(owner, build, status string) events.Event {
	data := json.RawMessage(`{"build_id":"` + build + `","status":"` + status + `"}`)
	return events.Event{
		ID: "ev-" + build, OwnerID: owner, Type: usecase.MicrositeBuildSettled, Data: data,
	}
}

func settledSub(t *testing.T, d *subscriber.BuildSettledDeps, name string) events.Subscription {
	t.Helper()
	for _, s := range subscriber.BuildSettledSubscriptions(d) {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("no subscription %s", name)
	return events.Subscription{}
}

func handleTwice(t *testing.T, s *events.Subscription, ev *events.Event) {
	t.Helper()
	for i := range 2 {
		if err := s.Handle(context.Background(), *ev); err != nil {
			t.Fatalf("%s, run %d: %v", s.Name, i+1, err)
		}
	}
}

func (f *settledFixture) live(t *testing.T, page string) string {
	t.Helper()
	p, err := f.deps.Pages.GetByID(context.Background(), page)
	if err != nil {
		t.Fatal(err)
	}
	if p.LiveBuildID == nil {
		return ""
	}
	return *p.LiveBuildID
}

// TestHomepagePublish — the home page's built build goes live (twice = once); another page's does
// not, and neither does a failed build.
func TestHomepagePublish(t *testing.T) {
	t.Parallel()
	f := settledSetup(t)
	sub := settledSub(t, f.deps, subscriber.HomepagePublishSubscriber)
	home, other := f.page(t, usecase.HomepageSlug), f.page(t, "press-kit")

	failed, err := f.deps.Builds.Create(context.Background(), home, map[string]string{})
	if err == nil {
		_, err = f.deps.Builds.MarkFailed(context.Background(), failed.ID, "vite: boom")
	}
	if err != nil {
		t.Fatal(err)
	}
	failedEv := settledEvent(f.owner, failed.ID, usecase.BuildFailed)
	handleTwice(t, &sub, &failedEv)
	homeBuild, ev := f.built(t, home, "v1")
	handleTwice(t, &sub, &ev)
	_, otherEv := f.built(t, other, "p1")
	handleTwice(t, &sub, &otherEv)

	if got := f.live(t, home); got != homeBuild {
		t.Errorf("home: want %s live, got %q", homeBuild, got)
	}
	if got := f.live(t, other); got != "" {
		t.Errorf("another page is never auto-published, got %q live", got)
	}
}

// TestAssetRefs — the references follow the page's LATEST built source, even when an older
// build's event arrives (again) after it.
func TestAssetRefs(t *testing.T) {
	t.Parallel()
	f := settledSetup(t)
	sub := settledSub(t, f.deps, subscriber.AssetRefsSubscriber)
	page := f.page(t, "gallery")
	_, older := f.built(t, page, "uses asset one")
	_, newer := f.built(t, page, "uses asset two")

	handleTwice(t, &sub, &newer)
	handleTwice(t, &sub, &older)

	if got := f.refs[page]["App.tsx"]; got != "uses asset two" {
		t.Fatalf("references must follow the latest built source, got %q", got)
	}
}
