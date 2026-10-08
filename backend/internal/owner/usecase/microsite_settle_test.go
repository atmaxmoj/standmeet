package usecase_test

// A build settles: the microsite.build.settled event exists if and only if the settle committed,
// and the NOTIFY it sends wakes the preview waiters of that build's owner only.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	// settleWake —— how long a woken waiter may take to answer; the waiters hold far longer.
	settleWake = 5 * time.Second
	// registerGrace —— time for a just-started waiter goroutine to register.
	registerGrace = 300 * time.Millisecond
	// maxTestWaiters —— the listener's waiter cap; two are used.
	maxTestWaiters = 8
	// goneBuild —— a build id no row has.
	goneBuild = "00000000-0000-0000-0000-000000000001"
)

type settleFixture struct {
	pool   *pgxpool.Pool
	pages  *repo.MicrositeRepo
	builds *repo.MicrositeBuildRepo
	rec    events.Recorder
}

func settleSetup(t *testing.T) *settleFixture {
	t.Helper()
	pool := scratchDB(t)
	bus, err := events.New(pool, usecase.MicrositeEventTypes(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return &settleFixture{
		pool: pool, pages: repo.NewMicrositeRepo(pool), builds: repo.NewMicrositeBuildRepo(pool),
		rec: bus.Recorder(),
	}
}

func (f *settleFixture) deps(rec events.Recorder) usecase.BuildSettleDeps {
	return usecase.BuildSettleDeps{Builds: f.builds, Pages: f.pages, Events: rec}
}

// seeded —— an owner, and one pending build of a page of theirs.
type seeded struct{ owner, build string }

// pendingBuild —— a new owner with page slug and one pending build of it.
func (f *settleFixture) pendingBuild(t *testing.T, handle, slug string) seeded {
	t.Helper()
	ctx := context.Background()
	var s seeded
	if err := f.pool.QueryRow(ctx, `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ($1, 'x', $2, 'O') RETURNING id`, handle+"@example.com", handle,
	).Scan(&s.owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	page, err := f.pages.Create(ctx, s.owner, slug, slug)
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.builds.Create(ctx, page.ID, map[string]string{"App.tsx": "x"})
	if err != nil {
		t.Fatal(err)
	}
	s.build = b.ID
	return s
}

type settledData struct {
	BuildID string `json:"build_id"`
	Status  string `json:"status"`
}

type settledRow struct {
	Subject string
	Data    settledData
}

func (f *settleFixture) settledEvents(t *testing.T) []settledRow {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT subject, data FROM events
		WHERE type = $1 ORDER BY seq`, usecase.MicrositeBuildSettled)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []settledRow{}
	for rows.Next() {
		var (
			r   settledRow
			raw []byte
		)
		if err = rows.Scan(&r.Subject, &raw); err == nil {
			err = json.Unmarshal(raw, &r.Data)
		}
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// failingRecorder —— an outbox that refuses the write.
type failingRecorder struct{}

var errOutboxDown = errors.New("outbox down")

func (r failingRecorder) With(pgstore.Tx) events.Recorder { return r }

func (failingRecorder) Record(context.Context, string, string, string, pgstore.JSONB) error {
	return errOutboxDown
}

// TestSettleBuild_noEventNoSettle — when the event cannot be written the build stays unsettled.
func TestSettleBuild_noEventNoSettle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	f := settleSetup(t)
	build := f.pendingBuild(t, "refused", "press-kit").build
	rep := usecase.BuildReport{ID: build, Status: usecase.BuildBuilt, OutputPath: "out/1"}
	err := usecase.SettleBuild(ctx, f.deps(failingRecorder{}), &rep)
	if !errors.Is(err, errOutboxDown) {
		t.Fatalf("a refused event must fail the settle, got %v", err)
	}
	b, err := f.builds.GetByID(ctx, build)
	if err != nil || b.Status != "pending" {
		t.Fatalf("no event → no settle: want pending, got %q (%v)", b.Status, err)
	}
}

// TestSettleBuild_oneEventPerSettle — a settle records exactly one thin event; a settle of a
// build that is gone records nothing.
func TestSettleBuild_oneEventPerSettle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	f := settleSetup(t)
	build := f.pendingBuild(t, "settler", "press-kit").build
	rep := usecase.BuildReport{ID: build, Status: usecase.BuildBuilt, OutputPath: "out/1"}
	if err := usecase.SettleBuild(ctx, f.deps(f.rec), &rep); err != nil {
		t.Fatal(err)
	}
	gone := usecase.BuildReport{ID: goneBuild, Status: usecase.BuildFailed}
	err := usecase.SettleBuild(ctx, f.deps(f.rec), &gone)
	if !errors.Is(err, entity.ErrMicrositeBuildNotFound) {
		t.Fatalf("a gone build: want ErrMicrositeBuildNotFound, got %v", err)
	}
	want := []settledRow{{
		Subject: "microsite/press-kit",
		Data:    settledData{BuildID: build, Status: usecase.BuildBuilt},
	}}
	if got := f.settledEvents(t); len(got) != 1 || got[0] != want[0] {
		t.Fatalf("want %+v, got %+v", want, got)
	}
}

// TestAwaitBuildSettled_wakesOnlyItsOwner — two owners wait; A's build settles and only A answers;
// B answers only after B's own build settles. Falsifiable: key the NOTIFY by anything shared and B
// answers at A's settle, before B's.
func TestAwaitBuildSettled_wakesOnlyItsOwner(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	f := settleSetup(t)
	sa := f.pendingBuild(t, "alpha", "a-page")
	sb := f.pendingBuild(t, "bravo", "b-page")
	l := pgstore.NewListener(f.pool, usecase.BuildSettledChannel, maxTestWaiters, nil)
	go l.Run(ctx)
	awaitListening(t, l)
	wd := usecase.BuildWaitDeps{Builds: f.builds, Settled: l}
	a, b := wait(ctx, wd, sa.owner), wait(ctx, wd, sb.owner)
	// Both waiters register first thing; give their goroutines time to get there, or a waiter
	// that registers after A's NOTIFY would not be tested at all.
	time.Sleep(registerGrace)

	f.settle(t, sa.build)
	if got := answerWithin(t, a, "A"); got.version <= 0 {
		t.Fatalf("A must answer a version past 0, got %d", got.version)
	}
	settledB := time.Now()
	f.settle(t, sb.build)
	got := answerWithin(t, b, "B")
	if got.at.Before(settledB) || got.version <= 0 {
		t.Fatalf("B answered at %v with %d; its build settled at %v: A's settle woke it",
			got.at, got.version, settledB)
	}
}

type answer struct {
	at      time.Time
	err     error
	version int64
}

// wait —— one preview long-poll for owner, since 0, held well past the test's own bounds.
func wait(ctx context.Context, wd usecase.BuildWaitDeps, owner string) <-chan answer {
	out := make(chan answer, 1)
	go func() {
		v, err := usecase.AwaitBuildSettled(ctx, wd, owner, 0, time.Minute)
		out <- answer{at: time.Now(), version: v, err: err}
	}()
	return out
}

func (f *settleFixture) settle(t *testing.T, build string) {
	t.Helper()
	rep := usecase.BuildReport{ID: build, Status: usecase.BuildBuilt, OutputPath: "out"}
	if err := usecase.SettleBuild(context.Background(), f.deps(f.rec), &rep); err != nil {
		t.Fatal(err)
	}
}

func answerWithin(t *testing.T, ch <-chan answer, who string) answer {
	t.Helper()
	select {
	case a := <-ch:
		if a.err != nil {
			t.Fatalf("%s's wait: %v", who, a.err)
		}
		return a
	case <-time.After(settleWake):
		t.Fatalf("%s's waiter was not woken by its own settle", who)
		return answer{}
	}
}

// awaitListening —— until the listener is live: LISTEN is active AND its catch-up wake-all has
// gone out. Watching LISTEN in pg_stat_activity was not enough: the wake-all lands just after
// it, and on a slow box it woke waiters registered in between — B answered at A's settle (CI).
func awaitListening(t *testing.T, l *pgstore.Listener) {
	t.Helper()
	deadline := time.Now().Add(settleWake)
	for time.Now().Before(deadline) {
		if l.Live() {
			return
		}
		time.Sleep(registerGrace / 10)
	}
	t.Fatal("the listener never started listening")
}
